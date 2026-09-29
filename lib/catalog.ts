import type {
  MediaCatalogRecord,
  MediaEpisodePayload,
  PublicCatalogRecord,
  PublicEpisodePayload,
} from '@/types/media';

export const catalog: MediaCatalogRecord[] = [
  {
    id: 'clouds-rest',
    title: 'Where the Clouds Rest',
    synopsis: 'A quiet cartographer follows a ribbon of light across islands that only appear at dawn.',
    coverPoster: '/posters/aurora.jpg',
    genre: 'Fantasy',
    year: 2025,
    format: 'Series · 12 episodes',
    episodes: [{ episodeNumber: 1, episodeTitle: 'The First Map', mirrors: [] }],
  },
  {
    id: 'tideglass',
    title: 'Tideglass',
    synopsis: 'On the edge of a rose-coloured sea, two siblings learn to read the weather in the water.',
    coverPoster: '/posters/tideglass.jpg',
    genre: 'Coming of age',
    year: 2024,
    format: 'Film · 1h 48m',
    episodes: [{ episodeNumber: 1, episodeTitle: 'Feature', mirrors: [] }],
  },
  {
    id: 'sky-archive',
    title: 'The Sky Archive',
    synopsis: 'A young keeper catalogs the changing colours of a city at the foot of an old mountain.',
    coverPoster: '/posters/skyarchive.jpg',
    genre: 'Slice of life',
    year: 2025,
    format: 'Series · 8 episodes',
    episodes: [{ episodeNumber: 1, episodeTitle: 'Evening Index', mirrors: [] }],
  },
  {
    id: 'mist-isles',
    title: 'Isles Between Worlds',
    synopsis: 'A drifting garden, a hand-written invitation, and a journey with no fixed destination.',
    coverPoster: '/posters/mist-isles.jpg',
    genre: 'Adventure',
    year: 2023,
    format: 'Series · 10 episodes',
    episodes: [{ episodeNumber: 1, episodeTitle: 'A Green Horizon', mirrors: [] }],
  },
  {
    id: 'moon-tide',
    title: 'A Moon Above the Quiet Sea',
    synopsis: 'A lighthouse apprentice discovers that the moon has been keeping a second tide.',
    coverPoster: '/posters/moon-tide.jpg',
    genre: 'Science fantasy',
    year: 2024,
    format: 'Film · 1h 36m',
    episodes: [{ episodeNumber: 1, episodeTitle: 'Feature', mirrors: [] }],
  },
];

/**
 * Build the client-safe view of an episode.
 *
 * This is an explicit allowlist rather than an `Omit`-style denylist: any field
 * added to `MediaEpisodePayload` later stays private until it is named here,
 * so a future private field cannot leak through this endpoint by default.
 */
function toPublicEpisode(episode: MediaEpisodePayload): PublicEpisodePayload {
  const publicEpisode: PublicEpisodePayload = {
    episodeNumber: episode.episodeNumber,
    episodeTitle: episode.episodeTitle,
    mirrorCount: episode.mirrors.length,
  };
  if (episode.skipTimestamps) publicEpisode.skipTimestamps = episode.skipTimestamps;
  return publicEpisode;
}

/** Build the client-safe view of a catalog record (allowlisted fields only). */
export function toPublicCatalogRecord(record: MediaCatalogRecord): PublicCatalogRecord {
  const publicRecord: PublicCatalogRecord = {
    id: record.id,
    title: record.title,
    synopsis: record.synopsis,
    coverPoster: record.coverPoster,
    genre: record.genre,
    year: record.year,
    format: record.format,
    episodes: record.episodes.map(toPublicEpisode),
  };
  if (record.previewUrl) publicRecord.previewUrl = record.previewUrl;
  return publicRecord;
}

/** The whole catalog, projected for public/API consumption. */
export function getPublicCatalog(): PublicCatalogRecord[] {
  return catalog.map(toPublicCatalogRecord);
}
