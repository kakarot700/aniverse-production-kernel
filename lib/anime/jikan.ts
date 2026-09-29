import type { CatalogPage, LegalStreamLink, MediaCatalogRecord, MediaEpisodePayload } from '@/types/media';
import { TtlCache, fetchWithTimeout } from './cache';
import { catalogCacheKey, type CatalogQuery } from './query';
import { formatLine, humanizeSeason, toPlainText } from './text';

/**
 * Jikan (unofficial MyAnimeList API) fallback provider.
 *
 * Used when AniList errors, rate-limits, or times out. Jikan itself is rate
 * limited (~3 requests/second), so every call is cached and the client
 * serialises requests through a small spacing gate.
 */
const JIKAN_BASE = 'https://api.jikan.moe/v4';
const MIN_REQUEST_SPACING_MS = 400;

let lastRequestAt = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + MIN_REQUEST_SPACING_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

interface JikanImage {
  image_url?: string | null;
  large_image_url?: string | null;
}

interface JikanNamed {
  name?: string | null;
}

interface JikanAnime {
  mal_id: number;
  url?: string | null;
  images?: { jpg?: JikanImage | null; webp?: JikanImage | null } | null;
  trailer?: { youtube_id?: string | null; images?: { maximum_image_url?: string | null } | null } | null;
  title?: string | null;
  title_english?: string | null;
  title_japanese?: string | null;
  type?: string | null;
  episodes?: number | null;
  status?: string | null;
  aired?: { prop?: { from?: { year?: number | null } | null } | null } | null;
  duration?: string | null;
  score?: number | null;
  synopsis?: string | null;
  season?: string | null;
  year?: number | null;
  studios?: (JikanNamed | null)[] | null;
  genres?: (JikanNamed | null)[] | null;
  themes?: (JikanNamed | null)[] | null;
  demographics?: (JikanNamed | null)[] | null;
  streaming?: ({ name?: string | null; url?: string | null } | null)[] | null;
}

interface JikanEpisode {
  mal_id?: number | null;
  title?: string | null;
  aired?: string | null;
  filler?: boolean | null;
  recap?: boolean | null;
}

const browseCache = new TtlCache<CatalogPage>(5 * 60_000, 200);
const detailCache = new TtlCache<MediaCatalogRecord>(15 * 60_000, 200);
const genreIdCache = new TtlCache<Record<string, number>>(6 * 60 * 60_000, 2);

async function jikanGet<T>(path: string): Promise<T> {
  await pace();
  const response = await fetchWithTimeout(`${JIKAN_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    timeoutMs: 9000,
  });
  if (response.status === 429) throw new Error('Jikan rate limit reached.');
  if (!response.ok) throw new Error(`Jikan responded ${response.status}.`);
  return (await response.json()) as T;
}

function names(list: (JikanNamed | null)[] | null | undefined): string[] {
  return (list ?? []).map((entry) => entry?.name).filter((name): name is string => Boolean(name));
}

/** `24 min per ep` → 1440 seconds. */
function parseDurationSeconds(duration: string | null | undefined): number | undefined {
  if (!duration) return undefined;
  const hours = /(\d+)\s*hr/i.exec(duration);
  const minutes = /(\d+)\s*min/i.exec(duration);
  const total = (hours ? Number.parseInt(hours[1], 10) * 3600 : 0) + (minutes ? Number.parseInt(minutes[1], 10) * 60 : 0);
  return total > 0 ? total : undefined;
}

function mapStatus(status: string | null | undefined): MediaCatalogRecord['status'] {
  switch ((status ?? '').toLowerCase()) {
    case 'currently airing':
      return 'RELEASING';
    case 'finished airing':
      return 'FINISHED';
    case 'not yet aired':
      return 'NOT_YET_RELEASED';
    default:
      return undefined;
  }
}

function mapFormat(type: string | null | undefined): string | undefined {
  const normalized = (type ?? '').toUpperCase();
  return normalized === 'TV SPECIAL' ? 'SPECIAL' : normalized || undefined;
}

function legalStreams(anime: JikanAnime): LegalStreamLink[] {
  return (anime.streaming ?? [])
    .filter((entry): entry is { name: string; url: string } => Boolean(entry?.name && entry?.url))
    .map((entry) => ({ site: entry.name, url: entry.url }));
}

export function mapJikanAnime(anime: JikanAnime, episodes: JikanEpisode[] = []): MediaCatalogRecord {
  const genres = [...new Set([...names(anime.genres), ...names(anime.themes), ...names(anime.demographics)])];
  const year = anime.year ?? anime.aired?.prop?.from?.year ?? 0;
  const declared = anime.episodes && anime.episodes > 0 ? anime.episodes : 0;
  const durationSeconds = parseDurationSeconds(anime.duration);
  const format = mapFormat(anime.type);

  const episodeList: MediaEpisodePayload[] = episodes.length
    ? episodes.map((episode, index) => ({
        episodeNumber: episode.mal_id ?? index + 1,
        episodeTitle: toPlainText(episode.title, 140) || `Episode ${episode.mal_id ?? index + 1}`,
        airedAt: episode.aired ?? undefined,
        durationSeconds,
        mirrors: [],
      }))
    : Array.from({ length: Math.min(declared || 1, 2000) }, (_unused, index) => ({
        episodeNumber: index + 1,
        episodeTitle: format === 'MOVIE' && (declared || 1) === 1 ? 'Feature' : `Episode ${index + 1}`,
        durationSeconds,
        mirrors: [],
      }));

  return {
    id: `mal:${anime.mal_id}`,
    title: anime.title_english || anime.title || `MyAnimeList #${anime.mal_id}`,
    titleEnglish: anime.title_english ?? undefined,
    titleNative: anime.title_japanese ?? undefined,
    synopsis: toPlainText(anime.synopsis) || 'No synopsis has been published for this title yet.',
    coverPoster: anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '',
    bannerImage: anime.trailer?.images?.maximum_image_url ?? undefined,
    genre: genres[0] ?? 'Anime',
    genres,
    year,
    format: formatLine(format, anime.episodes),
    mediaFormat: format,
    status: mapStatus(anime.status),
    score: typeof anime.score === 'number' ? Math.round(anime.score * 10) : undefined,
    episodeCount: declared || (format === 'MOVIE' ? 1 : 0),
    studios: names(anime.studios),
    season: humanizeSeason(anime.season ? anime.season.toUpperCase() : null, year || null),
    trailer: anime.trailer?.youtube_id
      ? { id: anime.trailer.youtube_id, site: 'YouTube', thumbnail: anime.trailer.images?.maximum_image_url ?? undefined }
      : undefined,
    legalStreams: legalStreams(anime),
    source: 'jikan',
    episodes: episodeList,
  };
}

async function genreIds(): Promise<Record<string, number>> {
  const cached = genreIdCache.get('all');
  if (cached) return cached;
  const payload = await jikanGet<{ data?: { mal_id?: number; name?: string }[] }>('/genres/anime');
  const map: Record<string, number> = {};
  for (const entry of payload.data ?? []) {
    if (entry?.name && typeof entry.mal_id === 'number') map[entry.name.toLowerCase()] = entry.mal_id;
  }
  genreIdCache.set('all', map);
  return map;
}

function orderParams(query: CatalogQuery): string {
  if (query.search) return '';
  switch (query.sort) {
    case 'score':
      return '&order_by=score&sort=desc';
    case 'newest':
      return '&order_by=start_date&sort=desc';
    case 'title':
      return '&order_by=title&sort=asc';
    case 'popular':
    case 'trending':
    default:
      return '&order_by=members&sort=desc';
  }
}

export async function jikanBrowse(query: CatalogQuery): Promise<CatalogPage> {
  const key = catalogCacheKey(query);
  const cached = browseCache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(Math.min(query.perPage, 25)),
    sfw: 'true',
  });
  if (query.search) params.set('q', query.search);
  if (query.format) params.set('type', query.format.toLowerCase());
  if (query.year) {
    params.set('start_date', `${query.year}-01-01`);
    params.set('end_date', `${query.year}-12-31`);
  }
  if (query.genre) {
    const ids = await genreIds().catch(() => ({}) as Record<string, number>);
    const id = ids[query.genre.toLowerCase()];
    if (id) params.set('genres', String(id));
  }

  const payload = await jikanGet<{
    data?: JikanAnime[];
    pagination?: { last_visible_page?: number; has_next_page?: boolean; items?: { total?: number } };
  }>(`/anime?${params.toString()}${orderParams(query)}`);

  const page: CatalogPage = {
    items: (payload.data ?? []).map((anime) => mapJikanAnime(anime)).filter((item) => item.coverPoster !== ''),
    page: query.page,
    perPage: query.perPage,
    hasNextPage: Boolean(payload.pagination?.has_next_page),
    total: payload.pagination?.items?.total ?? 0,
    source: 'jikan',
  };

  browseCache.set(key, page);
  return page;
}

export async function jikanDetail(malId: number): Promise<MediaCatalogRecord> {
  const key = String(malId);
  const cached = detailCache.get(key);
  if (cached) return cached;

  const full = await jikanGet<{ data?: JikanAnime }>(`/anime/${malId}/full`);
  if (!full.data) throw new Error(`Jikan has no anime with id ${malId}.`);

  // The episode endpoint is optional; a missing/failed page still yields a
  // usable record with a generated 1..n list.
  const episodes = await jikanGet<{ data?: JikanEpisode[] }>(`/anime/${malId}/episodes`)
    .then((payload) => payload.data ?? [])
    .catch(() => [] as JikanEpisode[]);

  const record = mapJikanAnime(full.data, episodes);
  detailCache.set(key, record);
  return record;
}

export async function jikanGenres(): Promise<string[]> {
  const ids = await genreIds();
  return Object.keys(ids)
    .map((name) => name.replace(/\b\w/g, (character) => character.toUpperCase()))
    .sort();
}

export function clearJikanCaches(): void {
  browseCache.clear();
  detailCache.clear();
  genreIdCache.clear();
}
