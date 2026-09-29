import type { StreamMirrorNode } from '@/types/media';

export const MEDIA_PROXY_ENDPOINT = '/api/proxy';

interface ProxyDecision {
  manifestUrl: string;
  requiresProxy?: boolean;
}

/** Same-origin URL the player should load for a mirror. */
export function playbackUrlFor(mirror: ProxyDecision): string {
  if (mirror.requiresProxy === false) return mirror.manifestUrl;
  return `${MEDIA_PROXY_ENDPOINT}?url=${encodeURIComponent(mirror.manifestUrl)}`;
}

/** Only same-origin proxy URLs can be verified without tripping CORS. */
export function isProbeable(mirror: ProxyDecision): boolean {
  return mirror.requiresProxy !== false;
}

/** Stable identity for a mirror list, used to avoid needless player restarts. */
export function mirrorsSignature(mirrors: readonly StreamMirrorNode[]): string {
  return mirrors.map((mirror) => `${mirror.id}@${mirror.manifestUrl}`).join('|');
}
