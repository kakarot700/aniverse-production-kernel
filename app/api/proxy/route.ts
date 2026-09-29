import { NextRequest, NextResponse } from 'next/server';
import { parseAllowedHosts, parseAllowedMediaUrl, rewriteHlsManifest } from '@/lib/media-proxy';

export const runtime = 'nodejs';

const MAX_REDIRECTS = 3;
const MAX_MANIFEST_BYTES = 1_500_000;

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readBoundedText(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
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
    reader.releaseLock();
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
): Promise<{ response: Response; finalUrl: URL }> {
  let current = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const checked = parseAllowedMediaUrl(current.toString(), allowedHosts);
    if (!checked.ok) throw new Error('Redirect target is not allowlisted.');
    const response = await fetch(checked.url, { headers, redirect: 'manual', signal });
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: checked.url };
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === MAX_REDIRECTS) throw new Error('Too many or invalid redirects.');
    current = new URL(location, checked.url);
  }
  throw new Error('Redirect limit exceeded.');
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get('url');
  if (!rawUrl || rawUrl.length > 4096) return jsonError('A valid media URL is required.', 400);

  const allowedHosts = parseAllowedHosts(process.env.ANIVERSE_MEDIA_ALLOWED_HOSTS);
  if (allowedHosts.length === 0) return jsonError('The media proxy is not configured.', 503);
  const checked = parseAllowedMediaUrl(rawUrl, allowedHosts);
  if (!checked.ok) return jsonError('The media host is not allowed.', 403);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const upstreamHeaders = new Headers({
      Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, video/*, */*',
    });
    const range = request.headers.get('range');
    if (range && /^bytes=\d*-\d*$/.test(range)) upstreamHeaders.set('Range', range);

    const { response, finalUrl } = await fetchAllowlisted(checked.url, allowedHosts, upstreamHeaders, controller.signal);
    if (!response.ok && response.status !== 206) {
      await response.body?.cancel();
      clearTimeout(timeoutId);
      return jsonError('The configured media source did not respond successfully.', 502);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const isPlaylist = contentType.toLowerCase().includes('mpegurl') || finalUrl.pathname.toLowerCase().endsWith('.m3u8');
    if (isPlaylist) {
      const rawManifest = await readBoundedText(response.body);
      clearTimeout(timeoutId);
      if (!rawManifest.trimStart().startsWith('#EXTM3U')) return jsonError('The configured source did not return a valid HLS playlist.', 502);
      const manifest = rewriteHlsManifest(rawManifest, finalUrl.toString(), '/api/proxy');
      return new NextResponse(manifest, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'private, max-age=15',
          'X-Aniverse-Proxy-Kind': 'manifest',
        },
      });
    }

    clearTimeout(timeoutId);
    const responseHeaders = new Headers({
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=30',
      'X-Aniverse-Proxy-Kind': 'media',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const header of ['content-length', 'content-range', 'accept-ranges']) {
      const value = response.headers.get(header);
      if (value) responseHeaders.set(header, value);
    }
    return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    clearTimeout(timeoutId);
    return jsonError('The configured media source could not be reached.', 502);
  }
}
