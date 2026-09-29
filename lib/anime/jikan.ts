/**
 * Jikan (unofficial MyAnimeList REST API) — secondary catalog source.
 *
 * Used when AniList is rate-limited or unreachable so the catalog keeps
 * answering with real data instead of collapsing to the bundled sample.
 *
 * Docs: https://docs.api.jikan.moe/
 */
import type { AnimeDetail, AnimeEpisode, AnimeSummary, CatalogPage, CatalogQuery } from '@/types/anime';
import { requestJson } from './http';
import { slugify, stripHtml } from './text';

export const JIKAN_ENDPOINT = 'https://api.jikan.moe/v4';
export const JIKAN_HOST = 'api.jikan.moe';

interface JikanAnime {
  mal_id: number;
  url?: string | null;
  images?: { jpg?: { large_image_url?: string | null; image_url?: string | null } } | null;
  trailer?: { youtube_id?: string | null; url?: string | null; images?: { maximum_image_url?: string | null } } | null;
  title?: string | null;
  title_english?: string | null;
  title_japanese?: string | null;
  type?: string | null;
  episodes?: number | null;
  status?: string | null;
  duration?: string | null;
  score?: number | null;
  members?: number | null;
  synopsis?: string | null;
  season?: string | null;
  year?: number | null;
  genres?: Array<{ name: string }> | null;
  studios?: Array<{ name: string }> | null;
  rating?: string | null;
}

interface JikanListResponse {
  data?: JikanAnime[] | null;
  pagination?: {
    last_visible_page?: number | null;
    has_next_page?: boolean | null;
    current_page?: number | null;
    items?: { count?: number | null; total?: number | null; per_page?: number | null } | null;
  } | null;
}

interface JikanSingleResponse {
  data?: JikanAnime | null;
}

interface JikanEpisodesResponse {
  data?: Array<{ mal_id: number; title?: string | null; aired?: string | null; url?: string | null }> | null;
  pagination?: { has_next_page?: boolean | null; last_visible_page?: number | null } | null;
}

const PLACEHOLDER_COVER = '/posters/aurora.jpg';

const FORMAT_FROM_JIKAN: Record<string, string> = {
  TV: 'TV',
  Movie: 'MOVIE',
  OVA: 'OVA',
  ONA: 'ONA',
  Special: 'SPECIAL',
  Music: 'MUSIC',
};

function parseDurationMinutes(duration: string | null | undefined): number | null {
  if (!duration) return null;
  const hours = Number.parseInt(duration.match(/(\d+)\s*hr/i)?.[1] ?? '', 10);
  const minutes = Number.parseInt(duration.match(/(\d+)\s*min/i)?.[1] ?? '', 10);
  const total = (Number.isFinite(hours) ? hours * 60 : 0) + (Number.isFinite(minutes) ? minutes : 0);
  return total > 0 ? total : null;
}

export function mapJikanAnime(anime: JikanAnime): AnimeSummary {
  const title = anime.title_english?.trim() || anime.title?.trim() || `MAL #${anime.mal_id}`;
  const youtubeId = anime.trailer?.youtube_id?.trim() || null;
  return {
    id: `mal:${anime.mal_id}`,
    anilistId: null,
    malId: anime.mal_id,
    slug: slugify(anime.title || title),
    title,
    titles: {
      romaji: anime.title?.trim() || title,
      english: anime.title_english?.trim() || null,
      native: anime.title_japanese?.trim() || null,
    },
    synopsis: stripHtml(anime.synopsis) || 'No synopsis has been published for this title yet.',
    coverImage: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || PLACEHOLDER_COVER,
    bannerImage: null,
    accentColor: null,
    genres: (anime.genres ?? []).map((genre) => genre.name).filter(Boolean),
    year: anime.year ?? null,
    season: anime.season ? anime.season.toUpperCase() : null,
    format: FORMAT_FROM_JIKAN[anime.type ?? ''] ?? 'TV',
    status: (anime.status ?? '').toLowerCase().includes('airing') ? 'RELEASING' : 'FINISHED',
    episodeCount: anime.episodes ?? null,
    durationMinutes: parseDurationMinutes(anime.duration),
    averageScore: anime.score != null ? Math.round(anime.score * 10) : null,
    popularity: anime.members ?? null,
    studios: (anime.studios ?? []).map((studio) => studio.name).filter(Boolean),
    isAdult: /rx|hentai/i.test(anime.rating ?? ''),
    trailer: youtubeId
      ? {
          site: 'youtube',
          id: youtubeId,
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`,
          thumbnail: anime.trailer?.images?.maximum_image_url ?? null,
        }
      : null,
    source: 'jikan',
  };
}

function catalogPath(query: CatalogQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(Math.min(25, query.perPage)),
    sfw: 'true',
  });
  if (query.genre) params.set('genres_exclude', '');
  if (query.format) params.set('type', query.format.toLowerCase().replace('tv_short', 'tv'));

  switch (query.mode) {
    case 'search':
      params.set('q', query.search);
      params.set('order_by', 'members');
      params.set('sort', 'desc');
      return `/anime?${params.toString()}`;
    case 'top':
      params.set('order_by', 'score');
      params.set('sort', 'desc');
      return `/anime?${params.toString()}`;
    case 'upcoming':
      params.set('status', 'upcoming');
      params.set('order_by', 'members');
      params.set('sort', 'desc');
      return `/anime?${params.toString()}`;
    case 'seasonal':
      return query.season && query.year
        ? `/seasons/${query.year}/${query.season.toLowerCase()}?${params.toString()}`
        : `/seasons/now?${params.toString()}`;
    case 'popular':
    case 'trending':
    default:
      params.set('order_by', query.mode === 'trending' ? 'popularity' : 'members');
      params.set('sort', query.mode === 'trending' ? 'asc' : 'desc');
      return `/anime?${params.toString()}`;
  }
}

export async function fetchJikanCatalog(query: CatalogQuery, signal?: AbortSignal): Promise<CatalogPage> {
  const payload = await requestJson<JikanListResponse>(
    `${JIKAN_ENDPOINT}${catalogPath(query)}`,
    { headers: { Accept: 'application/json' }, cache: 'no-store' },
    { signal, timeoutMs: 9_000, retries: 1 },
  );

  const data = (payload.data ?? []).filter(Boolean);
  const genreFilter = query.genre.toLowerCase();
  const items = data
    .map(mapJikanAnime)
    .filter((item) => !item.isAdult)
    .filter((item) => !genreFilter || item.genres.some((genre) => genre.toLowerCase() === genreFilter));

  return {
    items,
    pageInfo: {
      page: payload.pagination?.current_page ?? query.page,
      perPage: payload.pagination?.items?.per_page ?? query.perPage,
      total: payload.pagination?.items?.total ?? items.length,
      lastPage: payload.pagination?.last_visible_page ?? query.page,
      hasNextPage: Boolean(payload.pagination?.has_next_page),
    },
    source: 'jikan',
    degraded: false,
    notice: 'Served by the MyAnimeList (Jikan) mirror because AniList did not answer.',
  };
}

export async function fetchJikanDetail(malId: number, signal?: AbortSignal): Promise<AnimeDetail | null> {
  const payload = await requestJson<JikanSingleResponse>(
    `${JIKAN_ENDPOINT}/anime/${malId}/full`,
    { headers: { Accept: 'application/json' }, cache: 'no-store' },
    { signal, timeoutMs: 9_000, retries: 1 },
  );
  if (!payload.data) return null;

  const summary = mapJikanAnime(payload.data);
  let episodes: AnimeEpisode[] = [];
  try {
    const episodePayload = await requestJson<JikanEpisodesResponse>(
      `${JIKAN_ENDPOINT}/anime/${malId}/episodes`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' },
      { signal, timeoutMs: 9_000, retries: 0 },
    );
    episodes = (episodePayload.data ?? []).map((entry, index) => ({
      number: entry.mal_id || index + 1,
      title: entry.title?.trim() || `Episode ${entry.mal_id || index + 1}`,
      thumbnail: null,
      officialUrl: null,
      officialSite: null,
      aired: true,
    }));
  } catch {
    episodes = [];
  }

  if (episodes.length === 0 && summary.episodeCount) {
    episodes = Array.from({ length: Math.min(summary.episodeCount, 2000) }, (_, index) => ({
      number: index + 1,
      title: summary.format === 'MOVIE' ? 'Feature' : `Episode ${index + 1}`,
      thumbnail: null,
      officialUrl: null,
      officialSite: null,
      aired: true,
    }));
  }

  return {
    ...summary,
    synonyms: [],
    tags: [],
    countryOfOrigin: null,
    startDate: null,
    endDate: null,
    nextAiringEpisode: null,
    episodes,
    relations: [],
  };
}
