import type { CatalogPage, MediaCatalogRecord, MediaEpisodePayload } from '@/types/media';
import type { CatalogQuery } from './query';
import { formatLine } from './text';
import { OFFLINE_SEED } from './offline-seed';

/**
 * Offline provider. Deterministic, dependency-free, and always available, so
 * `/api/catalog` can answer even with no outbound network at all.
 */

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Locally generated cover art — see `app/api/poster/route.ts`. */
function posterFor(title: string, slug: string): string {
  const params = new URLSearchParams({ title, seed: slug });
  return `/api/poster?${params.toString()}`;
}

function buildEpisodes(title: string, format: string, count: number): MediaEpisodePayload[] {
  const total = Math.max(1, count);
  const isFilm = format === 'MOVIE';
  return Array.from({ length: Math.min(total, 2000) }, (_unused, index) => ({
    episodeNumber: index + 1,
    episodeTitle: isFilm && total === 1 ? 'Feature' : `Episode ${index + 1}`,
    durationSeconds: isFilm ? 6600 : 1440,
    mirrors: [],
  }));
}

const RECORDS: MediaCatalogRecord[] = OFFLINE_SEED.map(
  ([title, native, year, format, episodes, genres, studio, score, synopsis]) => {
    const slug = slugify(title);
    return {
      id: `offline:${slug}`,
      title,
      titleNative: native,
      synopsis,
      coverPoster: posterFor(title, slug),
      accentColor: undefined,
      genre: genres[0] ?? 'Anime',
      genres,
      year,
      format: formatLine(format, episodes),
      mediaFormat: format,
      status: 'FINISHED',
      score,
      episodeCount: episodes,
      studios: [studio],
      season: String(year),
      legalStreams: [],
      source: 'offline' as const,
      episodes: buildEpisodes(title, format, episodes),
    };
  },
);

const BY_ID = new Map(RECORDS.map((record) => [record.id, record]));

export function offlineGenres(): string[] {
  return [...new Set(RECORDS.flatMap((record) => record.genres))].sort();
}

function matches(record: MediaCatalogRecord, query: CatalogQuery): boolean {
  // `season` is deliberately ignored: the seed carries a release year but not
  // an airing season, and silently returning nothing would look like a bug.
  // The UI already shows a banner when results come from the offline catalog.
  if (query.genre && !record.genres.some((genre) => genre.toLowerCase() === query.genre.toLowerCase())) return false;
  if (query.year && record.year !== query.year) return false;
  if (query.format && record.mediaFormat !== query.format) return false;
  if (query.search) {
    const needle = query.search.toLowerCase();
    const haystack = `${record.title} ${record.titleNative ?? ''} ${record.synopsis} ${record.genres.join(' ')} ${(record.studios ?? []).join(' ')}`;
    if (!haystack.toLowerCase().includes(needle)) return false;
  }
  return true;
}

function compare(left: MediaCatalogRecord, right: MediaCatalogRecord, query: CatalogQuery): number {
  switch (query.sort) {
    case 'newest':
      return right.year - left.year || left.title.localeCompare(right.title);
    case 'title':
      return left.title.localeCompare(right.title);
    case 'score':
    case 'popular':
    case 'trending':
    default:
      return (right.score ?? 0) - (left.score ?? 0) || left.title.localeCompare(right.title);
  }
}

export function offlineBrowse(query: CatalogQuery): CatalogPage {
  const filtered = RECORDS.filter((record) => matches(record, query)).sort((left, right) => compare(left, right, query));
  const start = (query.page - 1) * query.perPage;
  const items = filtered.slice(start, start + query.perPage);
  return {
    items,
    page: query.page,
    perPage: query.perPage,
    hasNextPage: start + query.perPage < filtered.length,
    total: filtered.length,
    source: 'offline',
  };
}

export function offlineDetail(id: string): MediaCatalogRecord | null {
  return BY_ID.get(id) ?? null;
}

/** Loose title match, used to answer an AniList/MAL id while offline. */
export function offlineFindByTitle(title: string): MediaCatalogRecord | null {
  const needle = title.trim().toLowerCase();
  if (!needle) return null;
  return RECORDS.find((record) => record.title.toLowerCase() === needle) ?? null;
}

export function offlineAll(): readonly MediaCatalogRecord[] {
  return RECORDS;
}
