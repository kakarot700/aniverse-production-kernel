/**
 * Normalised, validated catalog query shared by every provider and by
 * `GET /api/catalog`. Keeping parsing in one place means AniList, Jikan, and
 * the offline seed all agree on what `?page=2&sort=trending` means.
 */
export type CatalogSort = 'trending' | 'popular' | 'score' | 'newest' | 'title';

export const CATALOG_SORTS: readonly CatalogSort[] = ['trending', 'popular', 'score', 'newest', 'title'];

export const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const;
export type AnimeSeason = (typeof SEASONS)[number];

export interface CatalogQuery {
  search: string;
  genre: string;
  season: AnimeSeason | '';
  year: number | null;
  format: string;
  sort: CatalogSort;
  page: number;
  perPage: number;
}

const MAX_PAGE = 200;
const MAX_PER_PAGE = 50;

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseCatalogQuery(params: URLSearchParams): CatalogQuery {
  const rawSort = (params.get('sort') ?? 'trending').toLowerCase();
  const sort = (CATALOG_SORTS as readonly string[]).includes(rawSort) ? (rawSort as CatalogSort) : 'trending';

  const rawSeason = (params.get('season') ?? '').toUpperCase();
  const season = (SEASONS as readonly string[]).includes(rawSeason) ? (rawSeason as AnimeSeason) : '';

  const rawYear = Number.parseInt(params.get('year') ?? '', 10);
  const year = Number.isFinite(rawYear) && rawYear >= 1900 && rawYear <= 2100 ? rawYear : null;

  return {
    // Bound the search term: it is forwarded to third-party APIs.
    search: (params.get('q') ?? '').trim().slice(0, 120),
    genre: (params.get('genre') ?? '').trim().slice(0, 40),
    season,
    year,
    format: (params.get('format') ?? '').trim().toUpperCase().slice(0, 16),
    sort,
    page: clampInt(params.get('page'), 1, 1, MAX_PAGE),
    perPage: clampInt(params.get('perPage'), 24, 1, MAX_PER_PAGE),
  };
}

export function catalogCacheKey(query: CatalogQuery): string {
  return [
    query.search.toLowerCase(),
    query.genre.toLowerCase(),
    query.season,
    query.year ?? '',
    query.format,
    query.sort,
    query.page,
    query.perPage,
  ].join('|');
}
