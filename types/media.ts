export interface StreamMirrorNode {
  serverName: string;
  manifestUrl: string;
  /**
   * Tier hint from the trusted catalog source: `true` means the mirror must be
   * served through the same-origin `/api/proxy` allowlist, `false` means it can
   * be addressed directly. Omitting it defaults to `true` (always proxy).
   */
  requiresProxy?: boolean;
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

export interface PlaybackSnapshot {
  peerId: string;
  sequence: number;
  positionMs: number;
  playing: boolean;
  sentAt: number;
}
