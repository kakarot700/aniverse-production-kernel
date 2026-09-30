import type { StreamMirrorNode } from '@/types/media';

export const MEDIA_PROXY_ENDPOINT = '/api/proxy';

interface ProxyDecision {
  manifestUrl: string;
  requiresProxy?: boolean;
  /** Attribution for the control plane; omitted for direct (unproxied) loads. */
  id?: string;
}

/**
 * Same-origin URL the player should load for a mirror.
 *
 * The `mirror` parameter is attribution, not routing: it tells the proxy which
 * pathway served an object so CMCD reports on that request can be credited to
 * the right mirror. CMCD itself has no reserved key for this, and without it
 * every viewer's telemetry would be unattributable.
 */
export function playbackUrlFor(mirror: ProxyDecision): string {
  if (mirror.requiresProxy === false) return mirror.manifestUrl;
  const base = `${MEDIA_PROXY_ENDPOINT}?url=${encodeURIComponent(mirror.manifestUrl)}`;
  return mirror.id ? `${base}&mirror=${encodeURIComponent(mirror.id)}` : base;
}

/** Only same-origin proxy URLs can be verified without tripping CORS. */
export function isProbeable(mirror: ProxyDecision): boolean {
  return mirror.requiresProxy !== false;
}

/** Stable identity for a mirror list, used to avoid needless player restarts. */
export function mirrorsSignature(mirrors: readonly StreamMirrorNode[]): string {
  return mirrors.map((mirror) => `${mirror.id}@${mirror.manifestUrl}`).join('|');
}
