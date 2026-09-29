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

export interface PlaybackSnapshot {
  peerId: string;
  sequence: number;
  positionMs: number;
  playing: boolean;
  sentAt: number;
}
