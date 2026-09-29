/**
 * Normalized catalog shapes.
 *
 * Every upstream source (AniList, Jikan/MyAnimeList, the bundled offline
 * sample) is mapped into these types so the UI never has to know which
 * provider answered a request.
 */

export type AnimeSourceId = 'anilist' | 'jikan' | 'offline';

export type CatalogMode =
  | 'trending'
  | 'popular'
  | 'top'
  | 'seasonal'
  | 'upcoming'
  | 'search';

export interface AnimeTitles {
  romaji: string;
  english: string | null;
  native: string | null;
}

export interface AnimeTrailer {
  site: string;
  id: string;
  url: string;
  thumbnail: string | null;
}

export interface AnimeSummary {
  /** Stable composite id, e.g. `anilist:21`. */
  id: string;
  anilistId: number | null;
  malId: number | null;
  slug: string;
  title: string;
  titles: AnimeTitles;
  synopsis: string;
  coverImage: string;
  bannerImage: string | null;
  /** Optional same-origin `/previews/<slug>.webm` hover loop. */
  previewUrl?: string;
  accentColor: string | null;
  genres: string[];
  year: number | null;
  season: string | null;
  /** TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL, MUSIC. */
  format: string;
  status: string;
  episodeCount: number | null;
  durationMinutes: number | null;
  averageScore: number | null;
  popularity: number | null;
  studios: string[];
  isAdult: boolean;
  trailer: AnimeTrailer | null;
  source: AnimeSourceId;
}

export interface AnimeEpisode {
  number: number;
  title: string;
  thumbnail: string | null;
  /** Official, licensed watch page (Crunchyroll, Netflix, …) when published. */
  officialUrl: string | null;
  officialSite: string | null;
  aired: boolean;
}

export interface AnimeRelation {
  id: string;
  anilistId: number | null;
  title: string;
  coverImage: string;
  format: string;
  relationType: string;
}

export interface AnimeDetail extends AnimeSummary {
  synonyms: string[];
  tags: string[];
  countryOfOrigin: string | null;
  startDate: string | null;
  endDate: string | null;
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  episodes: AnimeEpisode[];
  relations: AnimeRelation[];
}

export interface CatalogPageInfo {
  page: number;
  perPage: number;
  total: number;
  lastPage: number;
  hasNextPage: boolean;
}

export interface CatalogPage {
  items: AnimeSummary[];
  pageInfo: CatalogPageInfo;
  source: AnimeSourceId;
  /** True when every live upstream failed and a local fallback answered. */
  degraded: boolean;
  notice: string | null;
}

export interface CatalogQuery {
  mode: CatalogMode;
  search: string;
  genre: string;
  season: string;
  year: number | null;
  format: string;
  page: number;
  perPage: number;
}

export const ANIME_GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Horror',
  'Mahou Shoujo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
] as const;

export const ANIME_FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'] as const;

export const ANIME_SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const;

export const CATALOG_MODES: readonly CatalogMode[] = [
  'trending',
  'popular',
  'top',
  'seasonal',
  'upcoming',
  'search',
];
