/**
 * Freely redistributable reference streams used by the `open-cinema` server.
 *
 * These are Creative-Commons open movies (Blender Foundation) published as
 * public HLS test streams. They exist so the whole delivery path — proxy
 * allowlist, manifest rewriting, hls.js attachment, the failover worker, and
 * watch-room sync — can be verified without wiring up any third-party server
 * or shipping anyone else's copyrighted video.
 */
export interface ReferenceStream {
  /** Path appended to the `open-cinema` base (`https://test-streams.mux.dev`). */
  path: string;
  label: string;
  licence: string;
}

export const REFERENCE_STREAMS: readonly ReferenceStream[] = [
  { path: 'x36xhzz/x36xhzz.m3u8', label: 'Big Buck Bunny (multi-bitrate)', licence: 'CC-BY 3.0' },
  { path: 'bbb_30fps/bbb_30fps.m3u8', label: 'Big Buck Bunny 30fps', licence: 'CC-BY 3.0' },
  { path: 'tos_ismc/main.m3u8', label: 'Tears of Steel', licence: 'CC-BY 3.0' },
  { path: 'test_001/stream.m3u8', label: 'Reference ladder 001', licence: 'CC-BY 3.0' },
];

export const REFERENCE_STREAM_HOST = 'test-streams.mux.dev';

/** Stable, non-cryptographic hash so a given title always gets the same clip. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Picks a deterministic reference stream for a media/episode pair, then
 * rotates by `offset` so a single title can expose several distinct mirrors
 * for the failover worker to walk through.
 */
export function pickReferenceStream(mediaId: string, episodeNumber: number, offset = 0): ReferenceStream {
  const index = (hashString(`${mediaId}#${episodeNumber}`) + offset) % REFERENCE_STREAMS.length;
  return REFERENCE_STREAMS[index];
}

/**
 * Reference streams are on by default outside production so a fresh clone
 * plays immediately. In production they must be opted into, because a real
 * deployment should be serving its own licensed catalog.
 */
export function isReferenceStreamsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.ANIVERSE_ENABLE_REFERENCE_STREAMS?.trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return env.NODE_ENV !== 'production';
}
