/**
 * Catalog facade.
 *
 * Source chain: AniList (complete public anime database) → Jikan/MyAnimeList
 * mirror → bundled offline sample. Every step is cached with a TTL and
 * in-flight coalescing, and no step is allowed to throw: the catalog always
 * answers with something the UI can render.
 */
import type {
  AnimeDetail,
  AnimeSummary,
  CatalogMode,
  CatalogPage,
  CatalogQuery,
} from '@/types/anime';
import { ANIME_FORMATS, ANIME_SEASONS, CATALOG_MODES } from '@/types/anime';
import { fetchAniListCatalog, fetchAniListDetail, currentAnimeSeason } from './anilist';
import { fetchJikanCatalog, fetchJikanDetail } from './jikan';
import { offlineCatalogPage, offlineDetail, OFFLINE_NOTICE } from './offline';
import { TtlCache } from './cache';
import { UpstreamError } from './http';

export const MAX_PER_PAGE = 50;
export const DEFAULT_PER_PAGE = 24;

const CATALOG_TTL_MS = 5 * 60 * 1000;
const DETAIL_TTL_MS = 30 * 60 * 1000;
const DEGRADED_TTL_MS = 30 * 1000;

const catalogCache = new TtlCache<CatalogPage>(CATALOG_TTL_MS, 400);
const detailCache = new TtlCache<AnimeDetail | null>(DETAIL_TTL_MS, 500);

export interface MediaReference {
  kind: 'anilist' | 'mal' | 'offline';
  anilistId: number | null;
  malId: number | null;
  raw: string;
}

/** Accepts `anilist:21`, `mal:21`, `21`, or an offline sample id. */
export function parseMediaId(raw: string): MediaReference | null {
  const value = decodeURIComponent(String(raw ?? '')).trim().toLowerCase();
  if (!value || value.length > 120) return null;

  const prefixed = value.match(/^(anilist|mal|myanimelist|offline):([a-z0-9-]+)$/);
  if (prefixed) {
    const [, scheme, identifier] = prefixed;
    if (scheme === 'offline') return { kind: 'offline', anilistId: null, malId: null, raw: value };
    const numeric = Number.parseInt(identifier, 10);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
    return scheme === 'anilist'
      ? { kind: 'anilist', anilistId: numeric, malId: null, raw: value }
      : { kind: 'mal', anilistId: null, malId: numeric, raw: value };
  }

  if (/^\d+$/.test(value)) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
    return { kind: 'anilist', anilistId: numeric, malId: null, raw: `anilist:${numeric}` };
  }

  return { kind: 'offline', anilistId: null, malId: null, raw: value };
}

function clampPage(value: unknown): number {
  const page = Number.parseInt(String(value ?? '1'), 10);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(page, 500);
}

function clampPerPage(value: unknown): number {
  const perPage = Number.parseInt(String(value ?? DEFAULT_PER_PAGE), 10);
  if (!Number.isFinite(perPage) || perPage < 1) return DEFAULT_PER_PAGE;
  return Math.min(perPage, MAX_PER_PAGE);
}

function sanitizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Normalizes untrusted query input (URL params) into a safe CatalogQuery. */
export function normalizeCatalogQuery(input: Record<string, unknown>): CatalogQuery {
  const requestedMode = sanitizeText(input.mode, 20).toLowerCase() as CatalogMode;
  const search = sanitizeText(input.q ?? input.search, 100);
  const mode: CatalogMode = CATALOG_MODES.includes(requestedMode)
    ? requestedMode
    : search
      ? 'search'
      : 'trending';

  const genreInput = sanitizeText(input.genre, 40);
  const formatInput = sanitizeText(input.format, 20).toUpperCase();
  const seasonInput = sanitizeText(input.season, 10).toUpperCase();
  const yearInput = Number.parseInt(sanitizeText(input.year, 8), 10);

  return {
    mode: search && mode === 'trending' ? 'search' : mode,
    search,
    genre: /^[a-z0-9 '\-()+&.]{0,40}$/i.test(genreInput) ? genreInput : '',
    format: (ANIME_FORMATS as readonly string[]).includes(formatInput) ? formatInput : '',
    season: (ANIME_SEASONS as readonly string[]).includes(seasonInput) ? seasonInput : '',
    year: Number.isFinite(yearInput) && yearInput >= 1940 && yearInput <= 2100 ? yearInput : null,
    page: clampPage(input.page),
    perPage: clampPerPage(input.perPage),
  };
}

export function catalogCacheKey(query: CatalogQuery): string {
  return [
    query.mode,
    query.search,
    query.genre,
    query.format,
    query.season,
    query.year ?? '',
    query.page,
    query.perPage,
  ].join('|');
}

export interface CatalogFetchResult extends CatalogPage {
  /** Per-source diagnostics, useful in the API response and in tests. */
  attempts: Array<{ source: string; ok: boolean; error?: string }>;
}

export async function getCatalogPage(
  query: CatalogQuery,
  options: { signal?: AbortSignal; skipCache?: boolean } = {},
): Promise<CatalogFetchResult> {
  // A search with no term is just "popular".
  const effective: CatalogQuery = query.mode === 'search' && !query.search ? { ...query, mode: 'popular' } : query;
  const key = catalogCacheKey(effective);

  if (!options.skipCache) {
    const cached = catalogCache.get(key);
    if (cached) return { ...cached, attempts: [{ source: `${cached.source} (cache)`, ok: true }] };
  }

  const attempts: CatalogFetchResult['attempts'] = [];

  try {
    const page = await fetchAniListCatalog(effective, options.signal);
    attempts.push({ source: 'anilist', ok: true });
    catalogCache.set(key, page, CATALOG_TTL_MS);
    return { ...page, attempts };
  } catch (error) {
    attempts.push({ source: 'anilist', ok: false, error: describeError(error) });
  }

  try {
    const page = await fetchJikanCatalog(effective, options.signal);
    attempts.push({ source: 'jikan', ok: true });
    catalogCache.set(key, page, CATALOG_TTL_MS);
    return { ...page, attempts };
  } catch (error) {
    attempts.push({ source: 'jikan', ok: false, error: describeError(error) });
  }

  const fallback = offlineCatalogPage(effective);
  attempts.push({ source: 'offline', ok: true });
  // Cache the degraded answer only briefly so recovery is quick.
  catalogCache.set(key, fallback, DEGRADED_TTL_MS);
  return { ...fallback, attempts };
}

export async function getAnimeDetail(
  reference: MediaReference,
  options: { signal?: AbortSignal } = {},
): Promise<AnimeDetail | null> {
  const cached = detailCache.get(reference.raw);
  if (cached !== undefined) return cached;

  const detail = await detailCache.resolve(reference.raw, async () => {
    if (reference.kind !== 'offline') {
      try {
        const live = await fetchAniListDetail(
          { anilistId: reference.anilistId, malId: reference.malId },
          options.signal,
        );
        if (live) return live;
      } catch {
        // fall through to the MyAnimeList mirror
      }

      if (reference.malId) {
        try {
          const live = await fetchJikanDetail(reference.malId, options.signal);
          if (live) return live;
        } catch {
          // fall through to the offline sample
        }
      }
    }
    return offlineDetail(reference.raw);
  });

  // A miss usually means the upstream was unreachable, not that the title does
  // not exist. Caching that for the full TTL would freeze the outage in place.
  if (detail === null) detailCache.delete(reference.raw);
  return detail;
}

function describeError(error: unknown): string {
  if (error instanceof UpstreamError) return `${error.status || 'network'}: ${error.message}`;
  return error instanceof Error ? error.message : 'Unknown error';
}

export function clearCatalogCaches(): void {
  catalogCache.clear();
  detailCache.clear();
}

export { currentAnimeSeason, OFFLINE_NOTICE };
export type { AnimeSummary, AnimeDetail, CatalogPage, CatalogQuery };
