/**
 * Shared media / streaming contracts.
 *
 * The catalog layer (`lib/anime/*`) normalises AniList, Jikan, and the bundled
 * offline seed into `MediaCatalogRecord`. The server layer (`lib/servers/*`)
 * turns an operator source map into `StreamMirrorNode`s that the player can
 * actually attach to.
 */

/** Delivery mechanism a server uses for a resolved episode. */
export type ServerKind =
  /** HLS manifest (`.m3u8`) played by hls.js / native HLS. */
  | 'hls'
  /** Progressive file (`.mp4`/`.webm`) played directly by the `<video>` element. */
  | 'progressive'
  /** Third-party player page mounted in a sandboxed iframe. */
  | 'embed';

/** Editorial grouping used to order the server rail. */
export type ServerTier = 'premium' | 'scaled' | 'legacy' | 'open';

/** Why a mirror is or is not playable right now. */
export type MirrorStatus =
  /** Fully resolved and attachable. */
  | 'ready'
  /** Server is known but this episode has no entry in the source map. */
  | 'unmapped'
  /** Server has no base URL / credentials configured by the operator. */
  | 'unconfigured'
  /** Operator switched the server off via `ANIVERSE_SERVERS_DISABLED`. */
  | 'disabled'
  /** Resolved, but its host is missing from `ANIVERSE_MEDIA_ALLOWED_HOSTS`. */
  | 'blocked';

export interface StreamMirrorNode {
  /** Stable registry slug, e.g. `filemoon`. */
  serverId: string;
  /** Human-readable label shown in the server rail. */
  serverName: string;
  tier: ServerTier;
  kind: ServerKind;
  /**
   * Playable URL for `hls` / `progressive` mirrors. Empty string when the
   * mirror is not `ready`, so the UI can render the slot without attaching it.
   */
  manifestUrl: string;
  /** Iframe URL for `kind: 'embed'` mirrors. Empty unless `ready`. */
  embedUrl?: string;
  /**
   * `true` means the mirror must be fetched through the same-origin
   * `/api/proxy` allowlist; `false` means it may be addressed directly.
   * Always `false` for `embed` mirrors, which are not proxied.
   */
  requiresProxy: boolean;
  status: MirrorStatus;
  /** Short operator-facing explanation when `status !== 'ready'`. */
  statusDetail?: string;
  /** Optional quality hint from the source map, e.g. `1080p`. */
  quality?: string;
  /** Audio track hint from the source map. */
  audio?: 'sub' | 'dub' | 'raw';
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
  /** Episode still, when the metadata source provides one. */
  thumbnail?: string;
  /** Runtime in seconds, when known. */
  durationSeconds?: number;
  /** ISO-8601 air date, when known. */
  airedAt?: string;
  skipTimestamps?: SkipTimestamps;
  mirrors: StreamMirrorNode[];
}

/** Official, licensed place to watch a title (AniList `externalLinks`). */
export interface LegalStreamLink {
  site: string;
  url: string;
  language?: string;
  icon?: string;
  color?: string;
}

export type CatalogSource = 'anilist' | 'jikan' | 'offline';

export interface MediaCatalogRecord {
  /** Namespaced id, e.g. `anilist:16498`. Safe for URLs and cache keys. */
  id: string;
  title: string;
  titleEnglish?: string;
  titleNative?: string;
  synopsis: string;
  coverPoster: string;
  bannerImage?: string;
  /** Accent colour extracted by the metadata provider, e.g. `#e4a15d`. */
  accentColor?: string;
  previewUrl?: string;
  /** Primary genre, kept for backwards compatibility with the filter rail. */
  genre: string;
  genres: string[];
  year: number;
  /** Display string, e.g. `TV · 24 episodes`. */
  format: string;
  /** Raw format from the provider, e.g. `TV`, `MOVIE`, `OVA`. */
  mediaFormat?: string;
  status?: 'RELEASING' | 'FINISHED' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';
  /** 0-100 weighted score. */
  score?: number;
  episodeCount: number;
  studios?: string[];
  season?: string;
  /** YouTube/Dailymotion trailer id + site. */
  trailer?: { id: string; site: string; thumbnail?: string };
  /** Licensed services that legitimately carry this title. */
  legalStreams?: LegalStreamLink[];
  /** Which provider produced this record. */
  source: CatalogSource;
  episodes: MediaEpisodePayload[];
}

export interface CatalogPage {
  items: MediaCatalogRecord[];
  page: number;
  perPage: number;
  hasNextPage: boolean;
  total: number;
  source: CatalogSource;
  /** Set when the primary provider failed and a fallback answered. */
  degraded?: string;
}

export interface PlaybackSnapshot {
  peerId: string;
  sequence: number;
  positionMs: number;
  playing: boolean;
  sentAt: number;
}
