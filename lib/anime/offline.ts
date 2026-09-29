/**
 * Offline sample library.
 *
 * This is the last link in the source chain. It only answers when every live
 * catalog source (AniList, then Jikan) fails — an air-gapped build, an outage,
 * or a rate-limit storm. The records are original demo titles shipped with the
 * repository's own poster art, never scraped metadata, and every response made
 * from them is flagged `degraded: true` so the UI can say so plainly.
 */
import type { AnimeSummary, CatalogPage, CatalogQuery, AnimeDetail } from '@/types/anime';

function sample(record: Omit<AnimeSummary, 'source' | 'id' | 'titles' | 'isAdult' | 'popularity'> & {
  id: string;
}): AnimeSummary {
  return {
    ...record,
    titles: { romaji: record.title, english: record.title, native: null },
    isAdult: false,
    popularity: null,
    source: 'offline',
  };
}

export const offlineLibrary: AnimeSummary[] = [
  sample({
    id: 'offline:clouds-rest',
    anilistId: null,
    malId: null,
    slug: 'where-the-clouds-rest',
    title: 'Where the Clouds Rest',
    synopsis:
      'A quiet cartographer follows a ribbon of light across islands that only appear at dawn. Each map she finishes redraws a little more of her own memory.',
    coverImage: '/posters/aurora.jpg',
    bannerImage: null,
    accentColor: '#8b7fd4',
    genres: ['Fantasy', 'Adventure'],
    year: 2025,
    season: 'SPRING',
    format: 'TV',
    status: 'FINISHED',
    episodeCount: 12,
    durationMinutes: 24,
    averageScore: 81,
    studios: ['Aniverse Sample Studio'],
    trailer: null,
  }),
  sample({
    id: 'offline:tideglass',
    anilistId: null,
    malId: null,
    slug: 'tideglass',
    title: 'Tideglass',
    synopsis:
      'On the edge of a rose-coloured sea, two siblings learn to read the weather in the water — and discover that the tide has been reading them back.',
    coverImage: '/posters/tideglass.jpg',
    bannerImage: null,
    accentColor: '#d98fa4',
    genres: ['Drama', 'Slice of Life'],
    year: 2024,
    season: 'SUMMER',
    format: 'MOVIE',
    status: 'FINISHED',
    episodeCount: 1,
    durationMinutes: 108,
    averageScore: 84,
    studios: ['Aniverse Sample Studio'],
    trailer: null,
  }),
  sample({
    id: 'offline:sky-archive',
    anilistId: null,
    malId: null,
    slug: 'the-sky-archive',
    title: 'The Sky Archive',
    synopsis:
      'A young keeper catalogs the changing colours of a city at the foot of an old mountain, one evening index at a time.',
    coverImage: '/posters/skyarchive.jpg',
    bannerImage: null,
    accentColor: '#7fa8d4',
    genres: ['Slice of Life', 'Drama'],
    year: 2025,
    season: 'FALL',
    format: 'TV',
    status: 'RELEASING',
    episodeCount: 8,
    durationMinutes: 23,
    averageScore: 78,
    studios: ['Aniverse Sample Studio'],
    trailer: null,
  }),
  sample({
    id: 'offline:mist-isles',
    anilistId: null,
    malId: null,
    slug: 'isles-between-worlds',
    title: 'Isles Between Worlds',
    synopsis:
      'A drifting garden, a hand-written invitation, and a journey with no fixed destination. The passengers only learn where they are going once they stop asking.',
    coverImage: '/posters/mist-isles.jpg',
    bannerImage: null,
    accentColor: '#7fc4a8',
    genres: ['Adventure', 'Fantasy'],
    year: 2023,
    season: 'WINTER',
    format: 'TV',
    status: 'FINISHED',
    episodeCount: 10,
    durationMinutes: 24,
    averageScore: 76,
    studios: ['Aniverse Sample Studio'],
    trailer: null,
  }),
  sample({
    id: 'offline:moon-tide',
    anilistId: null,
    malId: null,
    slug: 'a-moon-above-the-quiet-sea',
    title: 'A Moon Above the Quiet Sea',
    synopsis:
      'A lighthouse apprentice discovers that the moon has been keeping a second tide, and that someone on the far shore has been answering it.',
    coverImage: '/posters/moon-tide.jpg',
    bannerImage: null,
    accentColor: '#6f7fbf',
    genres: ['Sci-Fi', 'Fantasy'],
    year: 2024,
    season: 'FALL',
    format: 'MOVIE',
    status: 'FINISHED',
    episodeCount: 1,
    durationMinutes: 96,
    averageScore: 83,
    studios: ['Aniverse Sample Studio'],
    trailer: null,
  }),
  sample({
    id: 'offline:hollow-tide',
    anilistId: null,
    malId: null,
    slug: 'hollow-tide',
    title: 'Hollow Tide',
    synopsis:
      'A thousand-year truce breaks in a single night. A reluctant blade-bearer is dragged into a war fought across two overlapping cities.',
    coverImage: '/posters/bleach-tybw.jpg',
    bannerImage: null,
    accentColor: '#c08a5a',
    genres: ['Action', 'Supernatural'],
    year: 2022,
    season: 'FALL',
    format: 'TV',
    status: 'FINISHED',
    episodeCount: 13,
    durationMinutes: 24,
    averageScore: 88,
    studios: ['Aniverse Sample Studio'],
    trailer: null,
  }),
];

export const OFFLINE_NOTICE =
  'Live anime sources are unreachable from the server right now, so this is the bundled offline sample. ' +
  'Browsing continues in your browser against AniList when it is reachable from there.';

function matchesQuery(item: AnimeSummary, query: CatalogQuery): boolean {
  if (query.genre && !item.genres.some((genre) => genre.toLowerCase() === query.genre.toLowerCase())) return false;
  if (query.format && item.format !== query.format) return false;
  if (query.year && item.year !== query.year) return false;
  if (query.season && item.season !== query.season) return false;
  if (query.search) {
    const needle = query.search.trim().toLocaleLowerCase();
    const haystack = `${item.title} ${item.synopsis} ${item.genres.join(' ')} ${item.studios.join(' ')}`.toLocaleLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function sortFor(mode: CatalogQuery['mode']): (left: AnimeSummary, right: AnimeSummary) => number {
  if (mode === 'top') return (left, right) => (right.averageScore ?? 0) - (left.averageScore ?? 0);
  if (mode === 'upcoming') return (left, right) => (right.year ?? 0) - (left.year ?? 0);
  return (left, right) => (right.year ?? 0) - (left.year ?? 0) || left.title.localeCompare(right.title);
}

export function offlineCatalogPage(query: CatalogQuery): CatalogPage {
  const matches = offlineLibrary.filter((item) => matchesQuery(item, query)).sort(sortFor(query.mode));
  const start = (query.page - 1) * query.perPage;
  const items = matches.slice(start, start + query.perPage);
  const lastPage = Math.max(1, Math.ceil(matches.length / query.perPage));
  return {
    items,
    pageInfo: {
      page: query.page,
      perPage: query.perPage,
      total: matches.length,
      lastPage,
      hasNextPage: query.page < lastPage,
    },
    source: 'offline',
    degraded: true,
    notice: OFFLINE_NOTICE,
  };
}

export function offlineDetail(id: string): AnimeDetail | null {
  const item = offlineLibrary.find((entry) => entry.id === id || entry.slug === id);
  if (!item) return null;
  const total = Math.max(1, item.episodeCount ?? 1);
  return {
    ...item,
    synonyms: [],
    tags: item.genres,
    countryOfOrigin: 'JP',
    startDate: item.year ? `${item.year}-01-01` : null,
    endDate: null,
    nextAiringEpisode: null,
    relations: [],
    episodes: Array.from({ length: total }, (_, index) => ({
      number: index + 1,
      title: item.format === 'MOVIE' ? 'Feature' : `Episode ${index + 1}`,
      thumbnail: null,
      officialUrl: null,
      officialSite: null,
      aired: true,
    })),
  };
}
