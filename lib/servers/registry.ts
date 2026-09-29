import type { ServerKind, ServerTier } from '@/types/media';

/**
 * Static description of every streaming server this build knows about.
 *
 * Nothing here is a stream by itself. A registry entry is a *slot*: an id, a
 * display name, a canonical host, and the URL shape that host uses. Slots are
 * filled at request time by `lib/servers/resolve.ts` using the operator source
 * map (`ANIVERSE_SOURCE_MAP_URL` / `ANIVERSE_SOURCE_MAP_INLINE`).
 *
 * This replaces the previous hardcoded list where every `manifestUrl` was a
 * provider *homepage* (`https://vidplay.online`). Those could never play:
 * `/api/proxy` requires the body to start with `#EXTM3U`, so all eleven
 * entries failed their probe on every request.
 */
export interface ServerDefinition {
  /** Stable slug used in config, the source map, and the UI. */
  id: string;
  /** Display name shown in the server rail. */
  name: string;
  tier: ServerTier;
  kind: ServerKind;
  /**
   * Canonical hostname. Used for the `ANIVERSE_MEDIA_ALLOWED_HOSTS` reminder in
   * `/api/servers` and to validate resolved URLs.
   */
  host: string;
  /**
   * URL shape for this provider. `{id}` is replaced with the file id from the
   * source map, `{base}` with the configured base origin.
   *
   * For `kind: 'hls'` servers the source map normally supplies a full manifest
   * URL instead, and the template is only a fallback.
   */
  template: string;
  /** `true` for `hls`/`progressive` servers that must go through `/api/proxy`. */
  requiresProxy: boolean;
  /** Operator-facing note rendered in the server rail tooltip. */
  note: string;
}

/**
 * Tier ordering used for failover priority. Lower sorts first.
 */
export const TIER_ORDER: Record<ServerTier, number> = {
  open: 0,
  premium: 1,
  scaled: 2,
  legacy: 3,
};

export const SERVER_REGISTRY: readonly ServerDefinition[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // Open tier — resolve with zero configuration. These carry freely
  // redistributable content (Creative Commons / public-domain reference
  // streams) plus the operator's own origin, so the player, proxy, failover
  // worker, and watch-room can be verified end to end before any third-party
  // server is wired up.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'aniverse-origin',
    name: 'Aniverse Origin',
    tier: 'open',
    kind: 'hls',
    host: 'origin.invalid',
    template: '{base}/{id}/master.m3u8',
    requiresProxy: true,
    note: 'Your own licensed HLS origin. Set ANIVERSE_SERVER_ANIVERSE_ORIGIN to its https base URL.',
  },
  {
    id: 'open-cinema',
    name: 'Open Cinema (CC-BY)',
    tier: 'open',
    kind: 'hls',
    host: 'test-streams.mux.dev',
    template: 'https://test-streams.mux.dev/{id}',
    requiresProxy: true,
    note: 'Creative-Commons reference streams. Always available, used to verify playback and failover.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Premium tier — high-throughput providers.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'vidplay',
    name: 'Vidstream / Vidplay',
    tier: 'premium',
    kind: 'embed',
    host: 'vidplay.online',
    template: '{base}/e/{id}',
    requiresProxy: false,
    note: 'Embed player. Supply file ids through the source map; the page mounts in a sandboxed iframe.',
  },
  {
    id: 'mcloud',
    name: 'MyCloud (MCloud)',
    tier: 'premium',
    kind: 'embed',
    host: 'mcloud.to',
    template: '{base}/embed/{id}',
    requiresProxy: false,
    note: 'Embed player. Supply file ids through the source map; the page mounts in a sandboxed iframe.',
  },
  {
    id: 'filemoon',
    name: 'Filemoon',
    tier: 'premium',
    kind: 'embed',
    host: 'filemoon.sx',
    template: '{base}/e/{id}',
    requiresProxy: false,
    note: 'Embed player. Supply file ids through the source map; the page mounts in a sandboxed iframe.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Scaled tier — high-storage PPV infrastructure nodes.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'doodstream',
    name: 'DoodStream Node',
    tier: 'scaled',
    kind: 'embed',
    host: 'doodstream.com',
    template: '{base}/e/{id}',
    requiresProxy: false,
    note: 'Embed player. Supply file ids through the source map; the page mounts in a sandboxed iframe.',
  },
  {
    id: 'streamtape',
    name: 'Streamtape Mirror',
    tier: 'scaled',
    kind: 'embed',
    host: 'streamtape.com',
    template: '{base}/e/{id}',
    requiresProxy: false,
    note: 'Embed player. Supply file ids through the source map; the page mounts in a sandboxed iframe.',
  },
  {
    id: 'voe',
    name: 'Voe.sx Cluster',
    tier: 'scaled',
    kind: 'embed',
    host: 'voe.sx',
    template: '{base}/e/{id}',
    requiresProxy: false,
    note: 'Embed player. Supply file ids through the source map; the page mounts in a sandboxed iframe.',
  },
  {
    id: 'streamwish',
    name: 'Streamwish Node',
    tier: 'scaled',
    kind: 'embed',
    host: 'streamwish.to',
    template: '{base}/e/{id}',
    requiresProxy: false,
    note: 'Embed player. Supply file ids through the source map; the page mounts in a sandboxed iframe.',
  },
  {
    id: 'vidhide',
    name: 'Vidhide Secure Node',
    tier: 'scaled',
    kind: 'embed',
    host: 'vidhide.com',
    template: '{base}/embed/{id}',
    requiresProxy: false,
    note: 'Embed player. Supply file ids through the source map; the page mounts in a sandboxed iframe.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy tier — frame-accurate performance nodes kept for compatibility.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'mp4upload',
    name: 'Mp4Upload High-Bitrate',
    tier: 'legacy',
    kind: 'embed',
    host: 'mp4upload.com',
    template: '{base}/embed-{id}.html',
    requiresProxy: false,
    note: 'Legacy embed player using the embed-<id>.html URL shape.',
  },
  {
    id: 'netu',
    name: 'Netu.tv Resilient Core',
    tier: 'legacy',
    kind: 'embed',
    host: 'netu.io',
    template: '{base}/e/{id}',
    requiresProxy: false,
    note: 'Legacy embed player. Historically token-gated; expect short-lived ids.',
  },
  {
    id: 'mixdrop',
    name: 'Mixdrop Alternative Path',
    tier: 'legacy',
    kind: 'embed',
    host: 'mixdrop.co',
    template: '{base}/e/{id}',
    requiresProxy: false,
    note: 'Legacy embed player used as the last failover hop.',
  },
];

const BY_ID = new Map(SERVER_REGISTRY.map((server) => [server.id, server]));

export function getServerDefinition(id: string): ServerDefinition | undefined {
  return BY_ID.get(id);
}

/** Registry order: tier first, then declaration order inside the tier. */
export function orderedServers(): ServerDefinition[] {
  return [...SERVER_REGISTRY].sort((left, right) => TIER_ORDER[left.tier] - TIER_ORDER[right.tier]);
}
