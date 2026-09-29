import type { CatalogPage, MediaCatalogRecord } from '@/types/media';
import { anilistBrowse, anilistDetail, anilistGenres } from './anilist';
import { jikanBrowse, jikanDetail, jikanGenres } from './jikan';
import { offlineBrowse, offlineDetail, offlineGenres } from './offline';
import type { CatalogQuery } from './query';

/**
 * Provider chain: AniList → Jikan → bundled offline seed.
 *
 * Every step is best-effort. A failure never propagates to the route handler;
 * it downgrades to the next provider and records why in `degraded`, which the
 * UI surfaces as a small banner instead of an error page.
 */

export type ProviderName = 'anilist' | 'jikan' | 'offline';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Grid cards never read the episode list, and a long-running series would
 * otherwise dominate the response: One Piece alone is >1100 episode objects,
 * repeated for every card on the page. `episodeCount` carries the number the
 * UI actually displays; `/api/catalog/<id>` returns the real list.
 */
function stripEpisodes(page: CatalogPage): CatalogPage {
  return { ...page, items: page.items.map((item) => ({ ...item, episodes: [] })) };
}

export async function browseCatalog(query: CatalogQuery): Promise<CatalogPage> {
  const problems: string[] = [];

  try {
    const page = await anilistBrowse(query);
    if (page.items.length > 0 || query.page > 1) return stripEpisodes(page);
    problems.push('AniList returned no results.');
  } catch (error) {
    problems.push(`AniList: ${describe(error)}`);
  }

  try {
    const page = await jikanBrowse(query);
    if (page.items.length > 0 || query.page > 1) {
      return stripEpisodes({ ...page, degraded: problems.join(' ') || undefined });
    }
    problems.push('Jikan returned no results.');
  } catch (error) {
    problems.push(`Jikan: ${describe(error)}`);
  }

  const page = offlineBrowse(query);
  return stripEpisodes({ ...page, degraded: problems.join(' ') || undefined });
}

/**
 * Resolves a namespaced catalog id (`anilist:16498`, `mal:5114`,
 * `offline:cowboy-bebop`) to a full record with an episode list.
 */
export async function getCatalogRecord(id: string): Promise<{ record: MediaCatalogRecord; degraded?: string } | null> {
  const separator = id.indexOf(':');
  if (separator < 1) return null;
  const namespace = id.slice(0, separator);
  const value = id.slice(separator + 1);
  const problems: string[] = [];

  if (namespace === 'offline') {
    const record = offlineDetail(id);
    return record ? { record } : null;
  }

  if (namespace === 'anilist') {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
    try {
      return { record: await anilistDetail(numeric) };
    } catch (error) {
      problems.push(`AniList: ${describe(error)}`);
    }
  }

  if (namespace === 'mal') {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
    try {
      return { record: await jikanDetail(numeric), degraded: problems.join(' ') || undefined };
    } catch (error) {
      problems.push(`Jikan: ${describe(error)}`);
    }
  }

  return null;
}

/**
 * Resolves several catalog ids at once, for shelves built from stored ids
 * (watchlist, playback history). Episodes are stripped: these render as cards.
 *
 * Bounded to 24 ids and resolved with limited concurrency so one shelf cannot
 * fan out into an unbounded burst of provider requests. Individual failures
 * are dropped rather than failing the whole shelf.
 */
export async function getCatalogRecords(ids: readonly string[]): Promise<MediaCatalogRecord[]> {
  const unique = [...new Set(ids)].slice(0, 24);
  const found = new Map<string, MediaCatalogRecord>();
  const CONCURRENCY = 4;

  for (let offset = 0; offset < unique.length; offset += CONCURRENCY) {
    const slice = unique.slice(offset, offset + CONCURRENCY);
    const settled = await Promise.all(
      slice.map((id) => getCatalogRecord(id).catch(() => null)),
    );
    settled.forEach((result, index) => {
      if (result) found.set(slice[index], { ...result.record, episodes: [] });
    });
  }

  // Preserve the caller's ordering (history is most-recent-first).
  return unique.map((id) => found.get(id)).filter((record): record is MediaCatalogRecord => Boolean(record));
}

export async function listGenres(): Promise<{ genres: string[]; source: ProviderName }> {
  try {
    const genres = await anilistGenres();
    if (genres.length) return { genres, source: 'anilist' };
  } catch {
    // fall through
  }
  try {
    const genres = await jikanGenres();
    if (genres.length) return { genres, source: 'jikan' };
  } catch {
    // fall through
  }
  return { genres: offlineGenres(), source: 'offline' };
}

export { parseCatalogQuery, catalogCacheKey, CATALOG_SORTS, SEASONS } from './query';
export type { CatalogQuery, CatalogSort, AnimeSeason } from './query';
