export interface StreamMirrorNode {
  serverName: string;
  manifestUrl: string;
}

export interface MediaEpisodePayload {
  episodeNumber: number;
  episodeTitle: string;
  skipTimestamps?: {
    introStart: number;
    introEnd: number;
    outroStart: number;
    outroEnd: number;
  };
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

/**
 * Client-safe projection of an episode.
 *
 * `mirrors` is deliberately absent: manifest URLs can point at private,
 * credentialed, or otherwise non-public origins, and the project's guidance is
 * to keep them out of client-visible payloads. Only the count is exposed so the
 * UI can still tell "no source configured" from "sources available".
 */
export interface PublicEpisodePayload {
  episodeNumber: number;
  episodeTitle: string;
  skipTimestamps?: MediaEpisodePayload['skipTimestamps'];
  mirrorCount: number;
}

/** Client-safe projection of a catalog record. */
export interface PublicCatalogRecord {
  id: string;
  title: string;
  synopsis: string;
  coverPoster: string;
  previewUrl?: string;
  genre: string;
  year: number;
  format: string;
  episodes: PublicEpisodePayload[];
}

export interface PlaybackSnapshot {
  peerId: string;
  sequence: number;
  positionMs: number;
  playing: boolean;
  sentAt: number;
}
