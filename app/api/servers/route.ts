import { NextResponse } from 'next/server';
import { describeServers, getRegistry } from '@/lib/streams/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/servers`
 *
 * Operational view of the stream-server registry. URL templates are withheld
 * on purpose (they can contain signing paths); only names, tiers and
 * configuration diagnostics are exposed.
 */
export async function GET() {
  const registry = getRegistry();
  const servers = describeServers();

  return NextResponse.json(
    {
      servers,
      summary: {
        total: servers.length,
        enabled: servers.filter((server) => server.enabled).length,
        licensed: servers.filter((server) => !server.isReference).length,
        reference: servers.filter((server) => server.isReference).length,
        groups: [...new Set(servers.map((server) => server.group))],
      },
      config: {
        loadedFrom: registry.loadedFrom,
        configuredCount: registry.configuredCount,
        referenceStreamsEnabled: registry.referenceStreamsEnabled,
        allowedProxyHosts: registry.allowedHosts,
        issues: registry.issues,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
