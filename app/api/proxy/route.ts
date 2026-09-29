import { NextResponse, type NextRequest } from 'next/server';
import { parseAllowedMediaUrl, rewriteHlsManifest } from '@/lib/media-proxy';
import { getEffectiveAllowedHosts } from '@/lib/servers/allowlist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REDIRECTS = 3;
const MAX_MANIFEST_BYTES = 1_500_000;
const CONNECT_TIMEOUT_MS = 12_000;

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readBoundedText(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_MANIFEST_BYTES) {
        await reader.cancel();
        throw new Error('Manifest exceeded size limit.');
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released by cancel().
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchAllowlisted(
  initialUrl: URL,
  allowedHosts: readonly string[],
  headers: Headers,
  signal: AbortSignal,
  method: 'GET' | 'HEAD',
): Promise<{ response: Response; finalUrl: URL }> {
  let current = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const checked = parseAllowedMediaUrl(current.toString(), allowedHosts);
    if (!checked.ok) throw new Error('Redirect target is not allowlisted.');

    const response = await fetch(checked.url, { method, headers, redirect: 'manual', signal });
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: checked.url };

    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === MAX_REDIRECTS) throw new Error('Too many or invalid redirects.');
    current = new URL(location, checked.url);
  }
  throw new Error('Redirect limit exceeded.');
}

/**
 * Some CDNs reject requests without a browser-like `User-Agent`, or require a
 * specific `Referer`/`Origin`. Both are operator-configured so the proxy never
 * invents an identity of its own.
 */
function buildUpstreamHeaders(request: NextRequest): Headers {
  const headers = new Headers({
    Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, video/*, */*',
    'Accept-Encoding': 'identity',
  });

  const userAgent = process.env.ANIVERSE_MEDIA_USER_AGENT?.trim();
  if (userAgent) headers.set('User-Agent', userAgent);

  const referer = process.env.ANIVERSE_MEDIA_REFERER?.trim();
  if (referer) {
    headers.set('Referer', referer);
    try {
      headers.set('Origin', new URL(referer).origin);
    } catch {
      // Ignore a malformed referer rather than failing the request.
    }
  }

  // Range is forwarded so seeking works on progressive files.
  const range = request.headers.get('range');
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set('Range', range);

  return headers;
}

async function handle(request: NextRequest, method: 'GET' | 'HEAD'): Promise<Response> {
  const rawUrl = request.nextUrl.searchParams.get('url');
  if (!rawUrl || rawUrl.length > 4096) return jsonError('A valid media URL is required.', 400);

  const allowedHosts = getEffectiveAllowedHosts();
  if (allowedHosts.length === 0) return jsonError('The media proxy is not configured.', 503);

  const checked = parseAllowedMediaUrl(rawUrl, allowedHosts);
  if (!checked.ok) return jsonError('The media host is not allowed.', 403);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  // If the browser goes away mid-stream, stop pulling from upstream.
  const abortOnDisconnect = () => controller.abort();
  request.signal.addEventListener('abort', abortOnDisconnect, { once: true });

  /** Stops the connect deadline but keeps client-disconnect cancellation. */
  const clearConnectDeadline = () => clearTimeout(timeoutId);
  /** Fully detaches; only safe once nothing else will read from upstream. */
  const cleanup = () => {
    clearTimeout(timeoutId);
    request.signal.removeEventListener('abort', abortOnDisconnect);
  };

  try {
    const { response, finalUrl } = await fetchAllowlisted(
      checked.url,
      allowedHosts,
      buildUpstreamHeaders(request),
      controller.signal,
      method,
    );

    if (!response.ok) {
      await response.body?.cancel();
      cleanup();
      return jsonError('The configured media source did not respond successfully.', 502);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const isPlaylist =
      contentType.toLowerCase().includes('mpegurl') || finalUrl.pathname.toLowerCase().endsWith('.m3u8');

    if (isPlaylist && method === 'GET') {
      const rawManifest = await readBoundedText(response.body);
      cleanup();
      if (!rawManifest.trimStart().startsWith('#EXTM3U')) {
        return jsonError('The configured source did not return a valid HLS playlist.', 502);
      }
      const manifest = rewriteHlsManifest(rawManifest, finalUrl.toString(), '/api/proxy');
      return new NextResponse(manifest, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'private, max-age=15',
          'X-Aniverse-Proxy-Kind': 'manifest',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const responseHeaders = new Headers({
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=30',
      'X-Aniverse-Proxy-Kind': isPlaylist ? 'manifest' : 'media',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const header of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = response.headers.get(header);
      if (value) responseHeaders.set(header, value);
    }

    if (method === 'HEAD') {
      await response.body?.cancel();
      cleanup();
      return new NextResponse(null, { status: response.status, headers: responseHeaders });
    }

    // Body is streamed, so the connect deadline must be cleared before we hand
    // the stream to the runtime — otherwise a long segment aborts at 12s. The
    // disconnect listener stays attached so upstream is cancelled if the
    // browser abandons the request mid-segment.
    clearConnectDeadline();
    return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    cleanup();
    return jsonError('The configured media source could not be reached.', 502);
  }
}

export async function GET(request: NextRequest) {
  return handle(request, 'GET');
}

export async function HEAD(request: NextRequest) {
  return handle(request, 'HEAD');
}
