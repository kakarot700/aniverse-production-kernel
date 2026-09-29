export type StreamKind = 'hls' | 'mp4';
export type StreamLanguage = 'sub' | 'dub' | 'raw' | 'mixed';

/**
 * One playable endpoint for one episode, produced by the stream-server
 * registry. The player walks this list in order and fails over on error.
 */
export interface StreamMirrorNode {
  /** Stable per-server id, e.g. `reference-mux-hls`. */
  id: string;
  serverName: string;
  /** UI grouping: `Licensed`, `Self-hosted`, `Reference`, … */
  group: string;
  language: StreamLanguage;
  kind: StreamKind;
  manifestUrl: string;
  /**
   * `true` means the mirror must be served through the same-origin
   * `/api/proxy` allowlist; `false` means the browser may address it
   * directly (the host must then send permissive CORS headers).
   * Omitting it defaults to `true` (always proxy).
   */
  requiresProxy?: boolean;
  /** Lower sorts first. */
  priority: number;
  quality?: string;
  note?: string;
  /** Set when the endpoint is a public demo/reference stream, not real content. */
  isReference?: boolean;
}

export interface SkipTimestamps {
  introStart: number;
  introEnd: number;
  outroStart: number;
  outroEnd: number;
}

export interface MediaEpisodePayload {
  episodeNumber: number;
  episodeTitle: string;
  thumbnail?: string | null;
  officialUrl?: string | null;
  officialSite?: string | null;
  skipTimestamps?: SkipTimestamps;
  mirrors: StreamMirrorNode[];
}

export interface MediaCatalogRecord {
  id: string;
  title: string;
  synopsis: string;
  coverPoster: string;
  previewUrl?: string;
  genre: string;
  year: number;
  format: string;
  episodes: MediaEpisodePayload[];
}

export interface PlaybackSnapshot {
  peerId: string;
  sequence: number;
  positionMs: number;
  playing: boolean;
  sentAt: number;
}

/** Shape returned by `GET /api/watch/[id]/[episode]`. */
export interface WatchPayload {
  animeId: string;
  title: string;
  poster: string;
  episode: {
    number: number;
    title: string;
    thumbnail: string | null;
    officialUrl: string | null;
    officialSite: string | null;
    aired: boolean;
  };
  episodeCount: number;
  mirrors: StreamMirrorNode[];
  /** True when the only mirrors available are public reference streams. */
  referenceOnly: boolean;
  notice: string | null;
}
