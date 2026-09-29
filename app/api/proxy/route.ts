import { NextResponse, type NextRequest } from 'next/server';
import { performMediaProxy } from '@/lib/media-proxy-core';
import { getAllowedMediaHosts } from '@/lib/streams/registry';

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
 */
async function handle(request: NextRequest, method: 'GET' | 'HEAD'): Promise<NextResponse> {
  const result = await performMediaProxy(
    {
      rawUrl: request.nextUrl.searchParams.get('url'),
      method,
      range: request.headers.get('range'),
      signal: request.signal,
    },
    { allowedHosts: getAllowedMediaHosts() },
  );

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
