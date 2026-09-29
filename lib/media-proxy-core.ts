/**
 * Framework-free media proxy.
 *
 * The Next route handler is a thin wrapper around `performMediaProxy` so the
 * whole fetch path — allowlisting, redirect re-checks, manifest rewriting,
 * range and content-encoding handling — is unit testable with an injected
 * fetch implementation.
 */
import {
  looksLikeHlsPlaylist,
  parseAllowedMediaUrl,
  rewriteHlsManifest,
  sanitizeRangeHeader,
  shouldForwardContentLength,
} from './media-proxy';

export const MAX_REDIRECTS = 3;
export const MAX_MANIFEST_BYTES = 4_000_000;
export const MANIFEST_TIMEOUT_MS = 12_000;
export const HEADER_TIMEOUT_MS = 20_000;

export type ProxyKind = 'manifest' | 'media' | 'error';

export interface ProxyRequest {
  rawUrl: string | null;
  method: 'GET' | 'HEAD';
  range?: string | null;
  signal?: AbortSignal;
}

export interface ProxyOptions {
  allowedHosts: readonly string[];
  fetchImpl?: typeof fetch;
  proxyEndpoint?: string;
  manifestTimeoutMs?: number;
  headerTimeoutMs?: number;
}

export interface ProxyResult {
  status: number;
  kind: ProxyKind;
  headers: Record<string, string>;
  /** String for manifests and errors, a stream for media, null for HEAD. */
  body: string | ReadableStream<Uint8Array> | null;
}

function errorResult(message: string, status: number): ProxyResult {
  return {
    status,
    kind: 'error',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ error: message }),
  };
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

function upstreamHeaders(range: string | null, target: URL): Headers {
  const headers = new Headers({
    Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, video/*, audio/*, */*',
    // Ask for an uncompressed body so the upstream content-length stays
    // truthful for the ranged segment responses the browser depends on.
    'Accept-Encoding': 'identity',
    'User-Agent': 'Aniverse-Media-Proxy/1.0',
  });
  // A partial playlist cannot be rewritten, so never range-request one.
  if (looksLikeHlsPlaylist('', target.pathname)) return headers;
  const safeRange = sanitizeRangeHeader(range ?? null);
  if (safeRange) headers.set('Range', safeRange);
  return headers;
}

export function mediaPassthroughHeaders(response: Response, contentType: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=30',
    'X-Aniverse-Proxy-Kind': 'media',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': response.headers.get('accept-ranges') ?? 'bytes',
  };
  const contentRange = response.headers.get('content-range');
  if (contentRange) headers['Content-Range'] = contentRange;
  const contentLength = response.headers.get('content-length');
  if (contentLength && shouldForwardContentLength(response.headers.get('content-encoding'))) {
    headers['Content-Length'] = contentLength;
  }
  return headers;
}

/** Follows redirects manually so every hop is re-checked against the allowlist. */
async function fetchAllowlisted(
  initialUrl: URL,
  allowedHosts: readonly string[],
  headers: Headers,
  signal: AbortSignal,
  method: 'GET' | 'HEAD',
  fetchImpl: typeof fetch,
): Promise<{ response: Response; finalUrl: URL }> {
  let current = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const checked = parseAllowedMediaUrl(current.toString(), allowedHosts);
    if (!checked.ok) throw new Error('Redirect target is not allowlisted.');
    const response = await fetchImpl(checked.url, { method, headers, redirect: 'manual', signal, cache: 'no-store' });
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: checked.url };
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === MAX_REDIRECTS) throw new Error('Too many or invalid redirects.');
    current = new URL(location, checked.url);
  }
  throw new Error('Redirect limit exceeded.');
}

export async function performMediaProxy(request: ProxyRequest, options: ProxyOptions): Promise<ProxyResult> {
  const { rawUrl, method } = request;
  if (!rawUrl || rawUrl.length > 4096) return errorResult('A valid media URL is required.', 400);

  const allowedHosts = options.allowedHosts;
  if (allowedHosts.length === 0) return errorResult('The media proxy is not configured.', 503);

  const checked = parseAllowedMediaUrl(rawUrl, allowedHosts);
  if (!checked.ok) return errorResult('The media host is not allowed.', 403);

  const fetchImpl = options.fetchImpl ?? fetch;
  const proxyEndpoint = options.proxyEndpoint ?? '/api/proxy';
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  request.signal?.addEventListener('abort', abortFromCaller, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort(),
    options.headerTimeoutMs ?? HEADER_TIMEOUT_MS,
  );
  const clearTimer = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  try {
    let { response, finalUrl } = await fetchAllowlisted(
      checked.url,
      allowedHosts,
      upstreamHeaders(request.range ?? null, checked.url),
      controller.signal,
      method,
      fetchImpl,
    );

    // A playlist served from an extension-less URL can still come back as a
    // partial body if the caller sent a Range. Re-fetch it whole; a truncated
    // manifest is useless and would look like a dead server.
    if (
      method === 'GET' &&
      response.status === 206 &&
      looksLikeHlsPlaylist(response.headers.get('content-type') || '', finalUrl.pathname)
    ) {
      await response.body?.cancel();
      const headersWithoutRange = upstreamHeaders(null, checked.url);
      headersWithoutRange.delete('Range');
      ({ response, finalUrl } = await fetchAllowlisted(
        checked.url,
        allowedHosts,
        headersWithoutRange,
        controller.signal,
        method,
        fetchImpl,
      ));
    }

    if (!response.ok && response.status !== 206) {
      await response.body?.cancel();
      clearTimer();
      return errorResult('The configured media source did not respond successfully.', 502);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const isPlaylist = looksLikeHlsPlaylist(contentType, finalUrl.pathname);

    if (method === 'HEAD') {
      await response.body?.cancel();
      clearTimer();
      return {
        status: response.status,
        kind: isPlaylist ? 'manifest' : 'media',
        headers: isPlaylist
          ? {
              'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Aniverse-Proxy-Kind': 'manifest',
            }
          : mediaPassthroughHeaders(response, contentType),
        body: null,
      };
    }

    if (isPlaylist) {
      clearTimer();
      timeoutId = setTimeout(() => controller.abort(), options.manifestTimeoutMs ?? MANIFEST_TIMEOUT_MS);
      const rawManifest = await readBoundedText(response.body);
      clearTimer();
      if (!rawManifest.trimStart().startsWith('#EXTM3U')) {
        return errorResult('The configured source did not return a valid HLS playlist.', 502);
      }
      return {
        status: 200,
        kind: 'manifest',
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'private, max-age=15',
          'X-Aniverse-Proxy-Kind': 'manifest',
          'X-Content-Type-Options': 'nosniff',
        },
        body: rewriteHlsManifest(rawManifest, finalUrl.toString(), proxyEndpoint),
      };
    }

    // Segments and progressive files stream straight through. The header
    // timeout is cleared so a long download is never cut off mid-body; the
    // caller's abort signal still tears the upstream request down.
    clearTimer();
    return {
      status: response.status,
      kind: 'media',
      headers: mediaPassthroughHeaders(response, contentType),
      body: response.body,
    };
  } catch {
    clearTimer();
    if (request.signal?.aborted) return errorResult('Client aborted the media request.', 499);
    return errorResult('The configured media source could not be reached.', 502);
  } finally {
    clearTimer();
    request.signal?.removeEventListener('abort', abortFromCaller);
  }
}
