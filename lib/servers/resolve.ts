import type { MirrorStatus, ServerKind, StreamMirrorNode } from '@/types/media';
import { parseAllowedMediaUrl } from '@/lib/media-proxy';
import type { ServerRuntimeConfig } from './config';
import { TIER_ORDER, orderedServers } from './registry';
import { pickReferenceStream } from './reference-streams';
import { lookupSourceMap, type SourceMap, type SourceMapEntry } from './source-map';

export interface ResolveContext {
  servers: ServerRuntimeConfig[];
  sourceMap: SourceMap;
  /** Hosts permitted by `/api/proxy`. Used to pre-flag `blocked` mirrors. */
  allowedHosts: readonly string[];
  /** When true, `open-cinema` synthesises playable CC reference mirrors. */
  referenceStreamsEnabled: boolean;
}

/** Infers the delivery kind from a resolved URL's extension. */
function kindForUrl(url: string, fallback: ServerKind): ServerKind {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (path.endsWith('.m3u8')) return 'hls';
  if (path.endsWith('.mpd')) return 'hls';
  if (/\.(mp4|webm|m4v|mov)$/.test(path)) return 'progressive';
  return fallback;
}

function applyTemplate(template: string, base: string, fileId: string): string {
  return template.replace('{base}', base).replace('{id}', fileId);
}

function makeSlot(
  config: ServerRuntimeConfig,
  status: MirrorStatus,
  statusDetail?: string,
): StreamMirrorNode {
  return {
    serverId: config.definition.id,
    serverName: config.definition.name,
    tier: config.definition.tier,
    kind: config.definition.kind,
    manifestUrl: '',
    requiresProxy: config.definition.requiresProxy,
    status,
    statusDetail,
  };
}

function resolveEntry(config: ServerRuntimeConfig, entry: SourceMapEntry, context: ResolveContext): StreamMirrorNode {
  const { definition } = config;
  const slot = makeSlot(config, 'ready');

  const target = entry.url ?? (entry.fileId ? applyTemplate(definition.template, config.baseUrl, entry.fileId) : '');
  if (!target) return makeSlot(config, 'unmapped', 'Source-map entry had neither `url` nor `fileId`.');

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return makeSlot(config, 'unmapped', 'Source-map entry produced an invalid URL.');
  }
  if (parsed.protocol !== 'https:') {
    return makeSlot(config, 'blocked', 'Only https stream URLs are accepted.');
  }

  slot.quality = entry.quality;
  slot.audio = entry.audio;
  slot.kind = kindForUrl(parsed.toString(), definition.kind);

  if (slot.kind === 'embed') {
    // Embeds are mounted in a sandboxed iframe, never proxied.
    slot.embedUrl = parsed.toString();
    slot.requiresProxy = false;
    return slot;
  }

  slot.manifestUrl = parsed.toString();
  slot.requiresProxy = definition.requiresProxy;

  if (slot.requiresProxy) {
    const allowed = parseAllowedMediaUrl(slot.manifestUrl, context.allowedHosts);
    if (!allowed.ok) {
      const blocked = makeSlot(config, 'blocked', `Add ${parsed.hostname} to ANIVERSE_MEDIA_ALLOWED_HOSTS.`);
      blocked.kind = slot.kind;
      blocked.quality = slot.quality;
      blocked.audio = slot.audio;
      return blocked;
    }
  }

  return slot;
}

/**
 * Builds the full mirror rail for one episode.
 *
 * Every registry server always produces exactly one slot, so the UI can show
 * the complete server list with an honest per-server status instead of
 * silently hiding servers that are not usable yet.
 */
export function resolveEpisodeMirrors(
  mediaId: string,
  episodeNumber: number,
  context: ResolveContext,
): StreamMirrorNode[] {
  const byId = new Map(context.servers.map((entry) => [entry.definition.id, entry]));
  const mapped = lookupSourceMap(context.sourceMap, mediaId, episodeNumber);
  const mirrors: StreamMirrorNode[] = [];

  for (const definition of orderedServers()) {
    const config = byId.get(definition.id);
    if (!config) continue;

    if (config.disabledReason && !config.enabled) {
      const status: MirrorStatus = config.disabledReason.includes('ANIVERSE_SERVERS_DISABLED')
        ? 'disabled'
        : 'unconfigured';
      mirrors.push(makeSlot(config, status, config.disabledReason));
      continue;
    }

    const entries = mapped.filter((entry) => entry.server === definition.id);

    if (entries.length === 0) {
      // The open tier can always synthesise something playable.
      if (definition.id === 'open-cinema' && context.referenceStreamsEnabled) {
        for (let offset = 0; offset < 2; offset += 1) {
          const reference = pickReferenceStream(mediaId, episodeNumber, offset);
          const synthesized = resolveEntry(
            config,
            { server: definition.id, url: `${config.baseUrl}/${reference.path}`, quality: offset === 0 ? 'auto' : '720p' },
            context,
          );
          synthesized.serverName = offset === 0 ? definition.name : `${definition.name} · alt`;
          synthesized.statusDetail = `${reference.label} — ${reference.licence}`;
          mirrors.push(synthesized);
        }
        continue;
      }

      mirrors.push(
        makeSlot(config, 'unmapped', `No source-map entry for ${mediaId} episode ${episodeNumber}.`),
      );
      continue;
    }

    for (const entry of entries) mirrors.push(resolveEntry(config, entry, context));
  }

  // Ready mirrors first (tier order preserved inside each group) so the
  // failover worker walks usable hops before it ever reaches a dead slot.
  return mirrors.sort((left, right) => {
    const readyDelta = Number(right.status === 'ready') - Number(left.status === 'ready');
    if (readyDelta !== 0) return readyDelta;
    return TIER_ORDER[left.tier] - TIER_ORDER[right.tier];
  });
}

/** Mirrors the player can actually attach to. */
export function playableMirrors(mirrors: readonly StreamMirrorNode[]): StreamMirrorNode[] {
  return mirrors.filter((mirror) => mirror.status === 'ready');
}
