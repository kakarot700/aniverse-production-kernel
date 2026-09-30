/**
 * AniList GraphQL source.
 *
 * AniList exposes the complete public anime database (every series, film, OVA,
 * ONA and special that MyAnimeList/AniList track) through a free, CORS-enabled
 * GraphQL endpoint. It is the primary catalog source for this app and it works
 * both from the Node route handlers and directly from the browser, which is
 * what lets the client recover when the server itself has no egress.
 *
 * Docs: https://docs.anilist.co/  ·  Endpoint: https://graphql.anilist.co
 */
import type {
  AnimeDetail,
  AnimeEpisode,
  AnimeRelation,
  AnimeSummary,
  CatalogPage,
  CatalogQuery,
} from '@/types/anime';
import { requestJson, UpstreamError } from './http';
import { slugify, stripHtml } from './text';

export const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
export const ANILIST_HOST = 'graphql.anilist.co';

const MEDIA_CORE = `
  id
  idMal
  title { romaji english native }
  description(asHtml: false)
  coverImage { extraLarge large medium color }
  bannerImage
  genres
  seasonYear
  season
  format
  status
  episodes
  duration
  averageScore
  popularity
  isAdult
  studios(isMain: true) { nodes { name } }
  trailer { id site thumbnail }
`;

const CATALOG_QUERY = `
query AniverseCatalog(
  $page: Int, $perPage: Int, $search: String, $genre: String,
  $season: MediaSeason, $seasonYear: Int, $format: MediaFormat,
  $sort: [MediaSort], $status: MediaStatus, $isAdult: Boolean
) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage perPage }
    media(
      type: ANIME, search: $search, genre: $genre, season: $season,
      seasonYear: $seasonYear, format: $format, sort: $sort,
      status: $status, isAdult: $isAdult
    ) {
      ${MEDIA_CORE}
    }
  }
}`;

const DETAIL_QUERY = `
query AniverseDetail($id: Int, $malId: Int) {
  Media(id: $id, idMal: $malId, type: ANIME) {
    ${MEDIA_CORE}
    synonyms
    countryOfOrigin
    startDate { year month day }
    endDate { year month day }
    nextAiringEpisode { episode airingAt }
    tags { name rank isGeneralSpoiler isMediaSpoiler }
    streamingEpisodes { title thumbnail url site }
    relations {
      edges {
        relationType(version: 2)
        node { id type format title { romaji english } coverImage { large } }
      }
    }
  }
}`;

interface AniListImage {
  extraLarge?: string | null;
  large?: string | null;
  medium?: string | null;
  color?: string | null;
}

export interface AniListMedia {
  id: number;
  idMal: number | null;
  title: { romaji: string | null; english: string | null; native: string | null } | null;
  description: string | null;
  coverImage: AniListImage | null;
  bannerImage: string | null;
  genres: string[] | null;
  seasonYear: number | null;
  season: string | null;
  format: string | null;
  status: string | null;
  episodes: number | null;
  duration: number | null;
  averageScore: number | null;
  popularity: number | null;
  isAdult: boolean | null;
  studios: { nodes: Array<{ name: string }> | null } | null;
  trailer: { id: string | null; site: string | null; thumbnail: string | null } | null;
  synonyms?: string[] | null;
  countryOfOrigin?: string | null;
  startDate?: { year: number | null; month: number | null; day: number | null } | null;
  endDate?: { year: number | null; month: number | null; day: number | null } | null;
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
  tags?: Array<{ name: string; rank: number | null; isGeneralSpoiler: boolean; isMediaSpoiler: boolean }> | null;
  streamingEpisodes?: Array<{
    title: string | null;
    thumbnail: string | null;
    url: string | null;
    site: string | null;
  }> | null;
  relations?: {
    edges: Array<{
      relationType: string | null;
      node: {
        id: number;
        type: string | null;
        format: string | null;
        title: { romaji: string | null; english: string | null } | null;
        coverImage: { large: string | null } | null;
      } | null;
    }> | null;
  } | null;
}

interface AniListPageResponse {
  data?: {
    Page?: {
      pageInfo?: {
        total: number | null;
        currentPage: number | null;
        lastPage: number | null;
        hasNextPage: boolean | null;
        perPage: number | null;
      } | null;
      media?: Array<AniListMedia | null> | null;
    } | null;
  } | null;
  errors?: Array<{ message: string }>;
}

interface AniListDetailResponse {
  data?: { Media?: AniListMedia | null } | null;
  errors?: Array<{ message: string }>;
}

const PLACEHOLDER_COVER = '/posters/aurora.jpg';

const SORT_BY_MODE: Record<CatalogQuery['mode'], string[]> = {
  trending: ['TRENDING_DESC', 'POPULARITY_DESC'],
  popular: ['POPULARITY_DESC'],
  top: ['SCORE_DESC', 'POPULARITY_DESC'],
  seasonal: ['POPULARITY_DESC'],
  upcoming: ['POPULARITY_DESC'],
  search: ['SEARCH_MATCH', 'POPULARITY_DESC'],
};

export function currentAnimeSeason(now = new Date()): { season: string; year: number } {
  const month = now.getUTCMonth();
  const season = month <= 1 || month === 11 ? 'WINTER' : month <= 4 ? 'SPRING' : month <= 7 ? 'SUMMER' : 'FALL';
  // December belongs to the following winter season.
  const year = month === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return { season, year };
}

function pickTitle(media: AniListMedia): string {
  return (
    media.title?.english?.trim() ||
    media.title?.romaji?.trim() ||
    media.title?.native?.trim() ||
    `AniList #${media.id}`
  );
}

export function mapAniListMedia(media: AniListMedia): AnimeSummary {
  const title = pickTitle(media);
  const trailerId = media.trailer?.id?.trim();
  const trailerSite = media.trailer?.site?.toLowerCase() ?? '';
  const trailerUrl =
    trailerId && trailerSite === 'youtube'
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailerId)}`
      : trailerId && trailerSite === 'dailymotion'
        ? `https://www.dailymotion.com/video/${encodeURIComponent(trailerId)}`
        : null;

  return {
    id: `anilist:${media.id}`,
    anilistId: media.id,
    malId: media.idMal ?? null,
    slug: slugify(media.title?.romaji || title),
    title,
    titles: {
      romaji: media.title?.romaji?.trim() || title,
      english: media.title?.english?.trim() || null,
      native: media.title?.native?.trim() || null,
    },
    synopsis: stripHtml(media.description) || 'No synopsis has been published for this title yet.',
    coverImage: media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium || PLACEHOLDER_COVER,
    bannerImage: media.bannerImage || null,
    accentColor: media.coverImage?.color || null,
    genres: (media.genres ?? []).filter(Boolean),
    year: media.seasonYear ?? media.startDate?.year ?? null,
    season: media.season ?? null,
    format: media.format || 'TV',
    status: media.status || 'FINISHED',
    episodeCount: media.episodes ?? null,
    durationMinutes: media.duration ?? null,
    averageScore: media.averageScore ?? null,
    popularity: media.popularity ?? null,
    studios: (media.studios?.nodes ?? []).map((studio) => studio.name).filter(Boolean),
    isAdult: Boolean(media.isAdult),
    trailer: trailerUrl && trailerId ? { site: trailerSite, id: trailerId, url: trailerUrl, thumbnail: media.trailer?.thumbnail ?? null } : null,
    source: 'anilist',
  };
}

function buildEpisodeList(media: AniListMedia): AnimeEpisode[] {
  const streaming = (media.streamingEpisodes ?? []).filter((entry) => entry && entry.url);
  const airedCount =
    media.nextAiringEpisode?.episode != null
      ? Math.max(0, media.nextAiringEpisode.episode - 1)
      : (media.episodes ?? 0);
  const total = Math.max(media.episodes ?? 0, streaming.length, airedCount, media.format === 'MOVIE' ? 1 : 0);
  if (total === 0) return [];

  // AniList's streamingEpisodes are ordered but their "Episode N -" prefixes are
  // inconsistent, so match on a parsed number and fall back to positional order.
  const byNumber = new Map<number, (typeof streaming)[number]>();
  streaming.forEach((entry, index) => {
    const parsed = Number.parseInt(entry?.title?.match(/episode\s*(\d+)/i)?.[1] ?? '', 10);
    const number = Number.isFinite(parsed) && parsed > 0 ? parsed : index + 1;
    if (!byNumber.has(number)) byNumber.set(number, entry);
  });

  const episodes: AnimeEpisode[] = [];
  for (let number = 1; number <= Math.min(total, 2000); number += 1) {
    const match = byNumber.get(number);
    const rawTitle = match?.title?.replace(/^episode\s*\d+\s*[-–—:]\s*/i, '').trim();
    episodes.push({
      number,
      title: rawTitle || (media.format === 'MOVIE' ? 'Feature' : `Episode ${number}`),
      thumbnail: match?.thumbnail ?? null,
      officialUrl: match?.url ?? null,
      officialSite: match?.site ?? null,
      aired: airedCount === 0 ? true : number <= airedCount,
    });
  }
  return episodes;
}

function buildRelations(media: AniListMedia): AnimeRelation[] {
  return (media.relations?.edges ?? [])
    .filter((edge) => edge?.node && edge.node.type === 'ANIME')
    .slice(0, 12)
    .map((edge) => ({
      id: `anilist:${edge.node!.id}`,
      anilistId: edge.node!.id,
      title: edge.node!.title?.english?.trim() || edge.node!.title?.romaji?.trim() || `AniList #${edge.node!.id}`,
      coverImage: edge.node!.coverImage?.large || PLACEHOLDER_COVER,
      format: edge.node!.format || 'TV',
      relationType: (edge.relationType || 'RELATED').replace(/_/g, ' ').toLowerCase(),
    }));
}

function formatDate(date: { year: number | null; month: number | null; day: number | null } | null | undefined): string | null {
  if (!date?.year) return null;
  const month = String(date.month ?? 1).padStart(2, '0');
  const day = String(date.day ?? 1).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

export function mapAniListDetail(media: AniListMedia): AnimeDetail {
  return {
    ...mapAniListMedia(media),
    synonyms: (media.synonyms ?? []).filter(Boolean).slice(0, 8),
    tags: (media.tags ?? [])
      .filter((tag) => !tag.isGeneralSpoiler && !tag.isMediaSpoiler && (tag.rank ?? 0) >= 50)
      .slice(0, 10)
      .map((tag) => tag.name),
    countryOfOrigin: media.countryOfOrigin ?? null,
    startDate: formatDate(media.startDate),
    endDate: formatDate(media.endDate),
    nextAiringEpisode: media.nextAiringEpisode ?? null,
    episodes: buildEpisodeList(media),
    relations: buildRelations(media),
  };
}

export function buildCatalogVariables(query: CatalogQuery): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    page: query.page,
    perPage: query.perPage,
    sort: SORT_BY_MODE[query.mode] ?? SORT_BY_MODE.trending,
    isAdult: false,
  };

  if (query.search) variables.search = query.search;
  if (query.genre) variables.genre = query.genre;
  if (query.format) variables.format = query.format;
  if (query.year) variables.seasonYear = query.year;
  if (query.season) variables.season = query.season;

  if (query.mode === 'seasonal' && !query.season && !query.year) {
    const current = currentAnimeSeason();
    variables.season = current.season;
    variables.seasonYear = current.year;
  }
  if (query.mode === 'upcoming') {
    variables.status = 'NOT_YET_RELEASED';
    variables.sort = ['POPULARITY_DESC'];
  }
  if (query.mode === 'top') variables.sort = ['SCORE_DESC'];

  return variables;
}

async function graphql<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(
    ANILIST_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
    },
    { signal, timeoutMs: 9_000, retries: 1 },
  );
}

export async function fetchAniListCatalog(query: CatalogQuery, signal?: AbortSignal): Promise<CatalogPage> {
  const payload = await graphql<AniListPageResponse>(CATALOG_QUERY, buildCatalogVariables(query), signal);
  if (payload.errors?.length) {
    throw new UpstreamError(payload.errors.map((entry) => entry.message).join('; '), 422, false);
  }

  const page = payload.data?.Page;
  const media = (page?.media ?? []).filter((entry): entry is AniListMedia => Boolean(entry));
  return {
    items: media.map(mapAniListMedia),
    pageInfo: {
      page: page?.pageInfo?.currentPage ?? query.page,
      perPage: page?.pageInfo?.perPage ?? query.perPage,
      total: page?.pageInfo?.total ?? media.length,
      lastPage: page?.pageInfo?.lastPage ?? query.page,
      hasNextPage: Boolean(page?.pageInfo?.hasNextPage),
    },
    source: 'anilist',
    degraded: false,
    notice: null,
  };
}

export async function fetchAniListDetail(
  reference: { anilistId?: number | null; malId?: number | null },
  signal?: AbortSignal,
): Promise<AnimeDetail | null> {
  if (!reference.anilistId && !reference.malId) return null;
  const payload = await graphql<AniListDetailResponse>(
    DETAIL_QUERY,
    { id: reference.anilistId ?? null, malId: reference.anilistId ? null : reference.malId },
    signal,
  );
  if (payload.errors?.length) {
    const notFound = payload.errors.some((entry) => /not found/i.test(entry.message));
    if (notFound) return null;
    throw new UpstreamError(payload.errors.map((entry) => entry.message).join('; '), 422, false);
  }
  const media = payload.data?.Media;
  return media ? mapAniListDetail(media) : null;
}
