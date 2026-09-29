import type { CatalogPage, LegalStreamLink, MediaCatalogRecord, MediaEpisodePayload } from '@/types/media';
import { TtlCache, fetchWithTimeout } from './cache';
import { catalogCacheKey, type CatalogQuery } from './query';
import { formatLine, humanizeSeason, toPlainText } from './text';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  description(asHtml: false)
  coverImage { extraLarge large color }
  bannerImage
  genres
  episodes
  duration
  format
  status
  season
  seasonYear
  startDate { year }
  averageScore
  studios(isMain: true) { nodes { name } }
  trailer { id site thumbnail }
  externalLinks { site url type language icon color }
`;

const BROWSE_QUERY = `
  query Browse($page: Int, $perPage: Int, $search: String, $genre: String, $season: MediaSeason, $seasonYear: Int, $format: MediaFormat, $sort: [MediaSort]) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total currentPage lastPage hasNextPage perPage }
      media(type: ANIME, isAdult: false, search: $search, genre: $genre, season: $season, seasonYear: $seasonYear, format: $format, sort: $sort) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const DETAIL_QUERY = `
  query Detail($id: Int) {
    Media(id: $id, type: ANIME) {
      ${MEDIA_FIELDS}
      streamingEpisodes { title thumbnail url site }
    }
  }
`;

const GENRES_QUERY = `query Genres { GenreCollection }`;

interface AniListTitle {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
}

interface AniListExternalLink {
  site?: string | null;
  url?: string | null;
  type?: string | null;
  language?: string | null;
  icon?: string | null;
  color?: string | null;
}

interface AniListStreamingEpisode {
  title?: string | null;
  thumbnail?: string | null;
  url?: string | null;
  site?: string | null;
}

interface AniListMedia {
  id: number;
  idMal?: number | null;
  title?: AniListTitle | null;
  description?: string | null;
  coverImage?: { extraLarge?: string | null; large?: string | null; color?: string | null } | null;
  bannerImage?: string | null;
  genres?: (string | null)[] | null;
  episodes?: number | null;
  duration?: number | null;
  format?: string | null;
  status?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  startDate?: { year?: number | null } | null;
  averageScore?: number | null;
  studios?: { nodes?: ({ name?: string | null } | null)[] | null } | null;
  trailer?: { id?: string | null; site?: string | null; thumbnail?: string | null } | null;
  externalLinks?: (AniListExternalLink | null)[] | null;
  streamingEpisodes?: (AniListStreamingEpisode | null)[] | null;
}

const browseCache = new TtlCache<CatalogPage>(5 * 60_000, 300);
const detailCache = new TtlCache<MediaCatalogRecord>(15 * 60_000, 400);
const genreCache = new TtlCache<string[]>(60 * 60_000, 4);

function sortValues(query: CatalogQuery): string[] {
  if (query.search) return ['SEARCH_MATCH', 'POPULARITY_DESC'];
  switch (query.sort) {
    case 'popular':
      return ['POPULARITY_DESC'];
    case 'score':
      return ['SCORE_DESC'];
    case 'newest':
      return ['START_DATE_DESC'];
    case 'title':
      return ['TITLE_ROMAJI'];
    case 'trending':
    default:
      return ['TRENDING_DESC', 'POPULARITY_DESC'];
  }
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetchWithTimeout(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
    timeoutMs: 8000,
  });

  if (response.status === 429) throw new Error('AniList rate limit reached.');
  if (!response.ok) throw new Error(`AniList responded ${response.status}.`);

  const payload = (await response.json()) as { data?: T; errors?: { message?: string }[] };
  if (payload.errors?.length) throw new Error(payload.errors[0]?.message ?? 'AniList query failed.');
  if (!payload.data) throw new Error('AniList returned no data.');
  return payload.data;
}

function pickLegalStreams(links: (AniListExternalLink | null)[] | null | undefined): LegalStreamLink[] {
  if (!links) return [];
  const seen = new Set<string>();
  const result: LegalStreamLink[] = [];
  for (const link of links) {
    if (!link?.url || !link.site) continue;
    if (link.type !== 'STREAMING') continue;
    let host: string;
    try {
      const parsed = new URL(link.url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
      host = parsed.hostname;
    } catch {
      continue;
    }
    const key = `${link.site}|${host}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      site: link.site,
      url: link.url,
      language: link.language ?? undefined,
      icon: link.icon ?? undefined,
      color: link.color ?? undefined,
    });
  }
  return result;
}

/** Parses the trailing episode number out of AniList's "Episode 12 - Title". */
function parseEpisodeNumber(title: string | null | undefined, fallback: number): number {
  const match = /episode\s+(\d+)/i.exec(title ?? '');
  if (!match) return fallback;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildEpisodes(media: AniListMedia): MediaEpisodePayload[] {
  const streaming = (media.streamingEpisodes ?? []).filter((entry): entry is AniListStreamingEpisode => Boolean(entry));
  const declared = media.episodes && media.episodes > 0 ? media.episodes : 0;
  const durationSeconds = media.duration && media.duration > 0 ? media.duration * 60 : undefined;

  if (streaming.length > 0) {
    const episodes = streaming.map((entry, index) => {
      const number = parseEpisodeNumber(entry.title, index + 1);
      const label = toPlainText(entry.title, 140).replace(/^Episode\s+\d+\s*[-–—]\s*/i, '').trim();
      return {
        episodeNumber: number,
        episodeTitle: label || `Episode ${number}`,
        thumbnail: entry.thumbnail ?? undefined,
        durationSeconds,
        mirrors: [],
      } satisfies MediaEpisodePayload;
    });

    // De-duplicate on episode number (AniList occasionally repeats entries).
    const byNumber = new Map<number, MediaEpisodePayload>();
    for (const episode of episodes) if (!byNumber.has(episode.episodeNumber)) byNumber.set(episode.episodeNumber, episode);

    // Fill any gap up to the declared count so the picker is complete.
    for (let number = 1; number <= declared; number += 1) {
      if (!byNumber.has(number)) {
        byNumber.set(number, { episodeNumber: number, episodeTitle: `Episode ${number}`, durationSeconds, mirrors: [] });
      }
    }
    return [...byNumber.values()].sort((left, right) => left.episodeNumber - right.episodeNumber);
  }

  const total = declared || 1;
  const isFilm = media.format === 'MOVIE';
  return Array.from({ length: Math.min(total, 2000) }, (_unused, index) => ({
    episodeNumber: index + 1,
    episodeTitle: isFilm && total === 1 ? 'Feature' : `Episode ${index + 1}`,
    durationSeconds,
    mirrors: [],
  }));
}

export function mapAniListMedia(media: AniListMedia): MediaCatalogRecord {
  const genres = (media.genres ?? []).filter((genre): genre is string => Boolean(genre));
  const year = media.seasonYear ?? media.startDate?.year ?? 0;
  const studios = (media.studios?.nodes ?? [])
    .map((node) => node?.name)
    .filter((name): name is string => Boolean(name));

  const romaji = media.title?.romaji ?? undefined;
  const english = media.title?.english ?? undefined;

  return {
    id: `anilist:${media.id}`,
    title: english || romaji || media.title?.native || `AniList #${media.id}`,
    titleEnglish: english,
    titleNative: media.title?.native ?? undefined,
    synopsis: toPlainText(media.description) || 'No synopsis has been published for this title yet.',
    coverPoster: media.coverImage?.extraLarge || media.coverImage?.large || '',
    bannerImage: media.bannerImage ?? undefined,
    accentColor: media.coverImage?.color ?? undefined,
    genre: genres[0] ?? 'Anime',
    genres,
    year,
    format: formatLine(media.format, media.episodes),
    mediaFormat: media.format ?? undefined,
    status: (media.status as MediaCatalogRecord['status']) ?? undefined,
    score: media.averageScore ?? undefined,
    episodeCount: media.episodes ?? (media.format === 'MOVIE' ? 1 : 0),
    studios,
    season: humanizeSeason(media.season, year || null),
    trailer:
      media.trailer?.id && media.trailer.site
        ? { id: media.trailer.id, site: media.trailer.site, thumbnail: media.trailer.thumbnail ?? undefined }
        : undefined,
    legalStreams: pickLegalStreams(media.externalLinks),
    source: 'anilist',
    episodes: buildEpisodes(media),
  };
}

export async function anilistBrowse(query: CatalogQuery): Promise<CatalogPage> {
  const key = catalogCacheKey(query);
  const cached = browseCache.get(key);
  if (cached) return cached;

  const data = await graphql<{
    Page: {
      pageInfo: { total: number; currentPage: number; lastPage: number; hasNextPage: boolean; perPage: number };
      media: AniListMedia[];
    };
  }>(BROWSE_QUERY, {
    page: query.page,
    perPage: query.perPage,
    search: query.search || undefined,
    genre: query.genre || undefined,
    season: query.season || undefined,
    seasonYear: query.year ?? undefined,
    format: query.format || undefined,
    sort: sortValues(query),
  });

  const page: CatalogPage = {
    items: (data.Page.media ?? []).map(mapAniListMedia).filter((item) => item.coverPoster !== ''),
    page: data.Page.pageInfo?.currentPage ?? query.page,
    perPage: data.Page.pageInfo?.perPage ?? query.perPage,
    hasNextPage: Boolean(data.Page.pageInfo?.hasNextPage),
    total: data.Page.pageInfo?.total ?? 0,
    source: 'anilist',
  };

  browseCache.set(key, page);
  return page;
}

export async function anilistDetail(anilistId: number): Promise<MediaCatalogRecord> {
  const key = String(anilistId);
  const cached = detailCache.get(key);
  if (cached) return cached;

  const data = await graphql<{ Media: AniListMedia | null }>(DETAIL_QUERY, { id: anilistId });
  if (!data.Media) throw new Error(`AniList has no anime with id ${anilistId}.`);

  const record = mapAniListMedia(data.Media);
  detailCache.set(key, record);
  return record;
}

export async function anilistGenres(): Promise<string[]> {
  const cached = genreCache.get('all');
  if (cached) return cached;

  const data = await graphql<{ GenreCollection: (string | null)[] }>(GENRES_QUERY, {});
  const genres = (data.GenreCollection ?? []).filter((genre): genre is string => Boolean(genre) && genre !== 'Hentai');
  genreCache.set('all', genres);
  return genres;
}

export function clearAniListCaches(): void {
  browseCache.clear();
  detailCache.clear();
  genreCache.clear();
}
