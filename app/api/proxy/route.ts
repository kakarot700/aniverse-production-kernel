import { NextResponse, type NextRequest } from 'next/server';
import { performMediaProxy } from '@/lib/media-proxy-core';
import { getAllowedMediaHosts } from '@/lib/streams/registry';
import { extractCmcd } from '@/lib/streams/cmcd';
import { ingestCmcdReport, recordMirrorOutcome } from '@/lib/streams/control-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET|HEAD /api/proxy?url=<https media url>`
 *
 * Same-origin gateway for catalog-supplied media. Only hosts in the derived
 * allowlist (explicit `ANIVERSE_MEDIA_ALLOWED_HOSTS` entries plus the static
 * hosts of every configured stream server) are reachable, redirects are
 * re-checked on every hop, and nested playlist/segment/key URLs are rewritten
 * back through this endpoint so the browser never talks to the origin.
 *
 * It is also the CMCD ingest point. Every segment the player fetches passes
 * through here carrying the client's buffer level, throughput estimate and
 * starvation flag, which feeds the control plane that `/api/steering` reads.
 * That is how one viewer hitting a dying mirror protects the next viewer from
 * it, instead of every browser tab having to rediscover the failure alone.
 */
async function handle(request: NextRequest, method: 'GET' | 'HEAD'): Promise<NextResponse> {
  // `mirror` is ours, not part of CMCD: it tells us which pathway served this
  // object, which CMCD itself has no reserved key for.
  const mirrorId = request.nextUrl.searchParams.get('mirror');

  const cmcd = extractCmcd(request.nextUrl, request.headers);
  if (Object.keys(cmcd).length > 0) ingestCmcdReport(cmcd, mirrorId);

  const startedAt = Date.now();
  const result = await performMediaProxy(
    {
      rawUrl: request.nextUrl.searchParams.get('url'),
      method,
      range: request.headers.get('range'),
      signal: request.signal,
    },
    { allowedHosts: getAllowedMediaHosts() },
  );

  if (mirrorId) {
    // 4xx from an allowlist rejection is our fault, not the mirror's, so only
    // real upstream outcomes are scored.
    const upstreamFailure = result.status >= 500 || result.status === 0;
    recordMirrorOutcome(mirrorId, !upstreamFailure, Date.now() - startedAt);
  }

  if (result.body === null) {
    return new NextResponse(null, { status: result.status, headers: result.headers });
  }
  if (typeof result.body === 'string') {
    return new NextResponse(result.body, { status: result.status, headers: result.headers });
  }
  return new NextResponse(result.body, { status: result.status, headers: result.headers });
}

export async function GET(request: NextRequest) {
  return handle(request, 'GET');
}

export async function HEAD(request: NextRequest) {
  return handle(request, 'HEAD');
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { Allow: 'GET, HEAD, OPTIONS', 'Cache-Control': 'no-store' },
  });
}
