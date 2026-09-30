import { NextResponse, type NextRequest } from 'next/server';
import { getRegistry } from '@/lib/streams/registry';
import { buildSteeringManifest, chooseTtlSeconds, rankPathways } from '@/lib/streams/steering';
import {
  getControlPlane,
  ingestCmcdReport,
  snapshotControlPlane,
  toSteerableMirrors,
} from '@/lib/streams/control-plane';
import { parseCmcd } from '@/lib/streams/cmcd';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/steering`
 *
 * An HLS Content Steering server (RFC 8216bis §7).
 *
 * Returns a Steering Manifest ordering our mirrors by live health: static
 * operator priority as the backbone, adjusted by probe latency, circuit-
 * breaker cooldowns, and real viewer distress harvested from CMCD. A
 * conformant player — hls.js, Shaka, AVPlayer, ExoPlayer — reroutes to a
 * healthier pathway mid-playback, with no reload and no lost buffer.
 *
 * Per spec the client may send:
 *   _HLS_pathway=<id>        the pathway it is currently using
 *   _HLS_throughput=<bps>    its current throughput estimate
 *
 * The TTL is adaptive: 300 s when everything is healthy, as low as 10 s while
 * mirrors are failing, because a degrading system cannot wait five minutes
 * for clients to check back in.
 */
export async function GET(request: NextRequest) {
  const registry = getRegistry();
  const mirrors = toSteerableMirrors(registry.servers);

  if (mirrors.length === 0) {
    // A manifest must contain at least one pathway, so there is nothing
    // legal to return. 503 tells the player to keep its current pathway.
    return NextResponse.json(
      { error: 'No stream servers are configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const params = request.nextUrl.searchParams;
  const currentPathway = params.get('_HLS_pathway');

  // Throughput is advisory; a client reporting a collapsed estimate is
  // additional evidence its current pathway is struggling.
  const throughputBps = Number(params.get('_HLS_throughput'));

  // A player may also attach CMCD to the steering request itself.
  const cmcd = parseCmcd(params.get('CMCD'));
  if (Object.keys(cmcd).length > 0) ingestCmcdReport(cmcd, currentPathway);

  const { health, qoe } = getControlPlane();
  const distress = qoe.snapshot();

  if (currentPathway && Number.isFinite(throughputBps) && throughputBps > 0 && throughputBps < 300_000) {
    // Under ~300 kbps almost nothing plays. Nudge, do not condemn: this is a
    // single client's estimate and may just be their train tunnel.
    distress[currentPathway] = Math.min(1, (distress[currentPathway] ?? 0) + 0.15);
  }

  const priority = rankPathways(mirrors, health, { distress });
  const manifest = buildSteeringManifest(priority, {
    ttlSeconds: chooseTtlSeconds(mirrors, health, Date.now(), distress),
    // Echo the pathway back so the next request self-identifies even if the
    // player drops the query parameter.
    reloadUri: currentPathway
      ? `/api/steering?_HLS_pathway=${encodeURIComponent(currentPathway)}`
      : '/api/steering',
  });

  return NextResponse.json(manifest, {
    headers: {
      // Steering responses are per-client and volatile; caching one would
      // pin every viewer to one snapshot of the world.
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  });
}

/**
 * `POST /api/steering`
 *
 * CMCD ingest for clients that batch reports rather than attaching them to
 * every segment. Accepts either a single parsed object or a newline-delimited
 * body of raw CMCD records, which is CMCD v2's own batch format.
 */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  const pathwayId = request.nextUrl.searchParams.get('_HLS_pathway');

  try {
    if (contentType.includes('application/json')) {
      const body = await request.json();
      const records = Array.isArray(body) ? body : [body];
      for (const record of records.slice(0, 100)) {
        if (record && typeof record === 'object') {
          ingestCmcdReport(record as Record<string, string | number | boolean>, pathwayId);
        }
      }
    } else {
      const text = await request.text();
      for (const line of text.split('\n').slice(0, 100)) {
        const parsed = parseCmcd(line.trim());
        if (Object.keys(parsed).length > 0) ingestCmcdReport(parsed, pathwayId);
      }
    }
  } catch {
    return NextResponse.json({ error: 'Malformed CMCD report.' }, { status: 400 });
  }

  const registry = getRegistry();
  const snapshot = snapshotControlPlane(toSteerableMirrors(registry.servers));

  return NextResponse.json(
    { accepted: true, activeSessions: snapshot.activeSessions },
    { status: 202, headers: { 'Cache-Control': 'no-store' } },
  );
}
