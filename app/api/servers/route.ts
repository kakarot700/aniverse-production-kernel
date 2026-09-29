import { NextResponse } from 'next/server';
import { envKeyForServer, getServerRuntimeConfig, getSourceMapConfig } from '@/lib/servers/config';
import { getEffectiveAllowedHosts } from '@/lib/servers/allowlist';
import { isReferenceStreamsEnabled } from '@/lib/servers/reference-streams';
import { TIER_ORDER } from '@/lib/servers/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/servers` — operator-facing view of the streaming server registry.
 *
 * Reports, for every server slot: whether it is enabled, whether a base URL
 * is configured, whether its host is on the proxy allowlist, and the exact
 * environment variable to set next. This is the endpoint to check when a
 * mirror shows up as `unconfigured` or `blocked` in the player.
 *
 * No secrets are returned — only public hostnames and boolean state.
 */
export async function GET() {
  const allowedHosts = getEffectiveAllowedHosts();
  const sourceMap = getSourceMapConfig();
  const referenceStreams = isReferenceStreamsEnabled();

  const servers = getServerRuntimeConfig()
    .map(({ definition, enabled, configured, disabledReason }) => ({
      id: definition.id,
      name: definition.name,
      tier: definition.tier,
      kind: definition.kind,
      host: definition.host,
      note: definition.note,
      enabled,
      configured,
      disabledReason,
      envKey: envKeyForServer(definition.id),
      /** Embeds are not proxied, so the allowlist is irrelevant for them. */
      allowlisted: definition.requiresProxy ? allowedHosts.includes(definition.host) : null,
      requiresProxy: definition.requiresProxy,
    }))
    .sort((left, right) => TIER_ORDER[left.tier] - TIER_ORDER[right.tier]);

  return NextResponse.json(
    {
      servers,
      summary: {
        total: servers.length,
        enabled: servers.filter((server) => server.enabled).length,
        configured: servers.filter((server) => server.configured).length,
      },
      proxy: {
        allowedHosts,
        configured: allowedHosts.length > 0,
      },
      sourceMap: {
        configured: sourceMap.present,
        fromUrl: Boolean(sourceMap.url),
        fromInline: Boolean(sourceMap.inline),
      },
      referenceStreams,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
