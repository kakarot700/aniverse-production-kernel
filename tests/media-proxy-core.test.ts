import assert from 'node:assert/strict';
import test from 'node:test';
import { performMediaProxy } from '../lib/media-proxy-core';

const ALLOWED = ['cdn.example.com', '*.edge.example.com'];

interface StubCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function stubFetch(
  routes: Record<string, { status?: number; headers?: Record<string, string>; body?: string | null }>,
): { fetchImpl: typeof fetch; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ url, method: init?.method ?? 'GET', headers });

    const route = routes[url];
    if (!route) throw new Error(`Unexpected upstream request: ${url}`);
    return new Response(route.body === null ? null : (route.body ?? ''), {
      status: route.status ?? 200,
      headers: route.headers ?? {},
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function bodyText(body: string | ReadableStream<Uint8Array> | null): Promise<string> {
  if (body === null) return '';
  if (typeof body === 'string') return body;
  return new Response(body).text();
}

test('a missing or oversized url is rejected before any fetch happens', async () => {
  const { fetchImpl, calls } = stubFetch({});
  assert.equal((await performMediaProxy({ rawUrl: null, method: 'GET' }, { allowedHosts: ALLOWED, fetchImpl })).status, 400);
  assert.equal(
    (await performMediaProxy({ rawUrl: `https://cdn.example.com/${'a'.repeat(5000)}`, method: 'GET' }, { allowedHosts: ALLOWED, fetchImpl })).status,
    400,
  );
  assert.equal(calls.length, 0);
});

test('an empty allowlist reports the proxy as unconfigured', async () => {
  const result = await performMediaProxy({ rawUrl: 'https://cdn.example.com/a.m3u8', method: 'GET' }, { allowedHosts: [] });
  assert.equal(result.status, 503);
});

test('non-allowlisted hosts are refused without contacting anything', async () => {
  const { fetchImpl, calls } = stubFetch({});
  const result = await performMediaProxy(
    { rawUrl: 'https://attacker.example/a.m3u8', method: 'GET' },
    { allowedHosts: ALLOWED, fetchImpl },
  );
  assert.equal(result.status, 403);
  assert.equal(calls.length, 0);
});

test('a manifest is rewritten so every child URL comes back through the proxy', async () => {
  const manifest = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="../keys/key.bin"',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:6,',
    'segments/001.ts',
    '#EXTINF:6,',
    'https://other.edge.example.com/abs/002.ts',
    '',
  ].join('\n');

  const { fetchImpl, calls } = stubFetch({
    'https://cdn.example.com/show/ep1/master.m3u8?token=abc': {
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      body: manifest,
    },
  });

  const result = await performMediaProxy(
    { rawUrl: 'https://cdn.example.com/show/ep1/master.m3u8?token=abc', method: 'GET' },
    { allowedHosts: ALLOWED, fetchImpl },
  );

  assert.equal(result.status, 200);
  assert.equal(result.kind, 'manifest');
  assert.equal(result.headers['X-Aniverse-Proxy-Kind'], 'manifest');
  assert.match(result.headers['Content-Type'], /mpegurl/);

  const text = await bodyText(result.body);
  assert.ok(text.startsWith('#EXTM3U'));
  assert.match(text, /URI="\/api\/proxy\?url=https%3A%2F%2Fcdn\.example\.com%2Fshow%2Fkeys%2Fkey\.bin"/);
  assert.match(text, /URI="\/api\/proxy\?url=https%3A%2F%2Fcdn\.example\.com%2Fshow%2Fep1%2Finit\.mp4"/);
  assert.match(text, /^\/api\/proxy\?url=https%3A%2F%2Fcdn\.example\.com%2Fshow%2Fep1%2Fsegments%2F001\.ts$/m);
  assert.match(text, /^\/api\/proxy\?url=https%3A%2F%2Fother\.edge\.example\.com%2Fabs%2F002\.ts$/m);
  // The token query string survives so signed manifests keep working.
  assert.equal(calls[0].url, 'https://cdn.example.com/show/ep1/master.m3u8?token=abc');
  assert.equal(calls[0].headers['accept-encoding'], 'identity');
});

test('a source that does not return a real playlist is reported as a bad gateway', async () => {
  const { fetchImpl } = stubFetch({
    'https://cdn.example.com/a.m3u8': {
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      body: '<html>blocked</html>',
    },
  });
  const result = await performMediaProxy({ rawUrl: 'https://cdn.example.com/a.m3u8', method: 'GET' }, { allowedHosts: ALLOWED, fetchImpl });
  assert.equal(result.status, 502);
});

test('redirects are followed but every hop is re-checked against the allowlist', async () => {
  const { fetchImpl, calls } = stubFetch({
    'https://cdn.example.com/a.m3u8': { status: 302, headers: { location: 'https://node1.edge.example.com/b.m3u8' } },
    'https://node1.edge.example.com/b.m3u8': {
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      body: '#EXTM3U\n#EXTINF:4,\n1.ts\n',
    },
  });

  const result = await performMediaProxy({ rawUrl: 'https://cdn.example.com/a.m3u8', method: 'GET' }, { allowedHosts: ALLOWED, fetchImpl });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  // Relative children resolve against the *final* URL, not the original one.
  assert.match(await bodyText(result.body), /node1\.edge\.example\.com%2F1\.ts/);
});

test('a redirect off the allowlist is refused', async () => {
  const { fetchImpl } = stubFetch({
    'https://cdn.example.com/a.m3u8': { status: 302, headers: { location: 'https://attacker.example/steal.m3u8' } },
  });
  const result = await performMediaProxy({ rawUrl: 'https://cdn.example.com/a.m3u8', method: 'GET' }, { allowedHosts: ALLOWED, fetchImpl });
  assert.equal(result.status, 502);
});

test('a redirect loop terminates instead of hanging', async () => {
  const { fetchImpl, calls } = stubFetch({
    'https://cdn.example.com/a.m3u8': { status: 302, headers: { location: 'https://cdn.example.com/a.m3u8' } },
  });
  const result = await performMediaProxy({ rawUrl: 'https://cdn.example.com/a.m3u8', method: 'GET' }, { allowedHosts: ALLOWED, fetchImpl });
  assert.equal(result.status, 502);
  assert.ok(calls.length <= 4);
});

test('segments stream through with range and content-range preserved', async () => {
  const { fetchImpl, calls } = stubFetch({
    'https://cdn.example.com/seg/1.ts': {
      status: 206,
      headers: {
        'content-type': 'video/mp2t',
        'content-range': 'bytes 0-1023/98765',
        'content-length': '1024',
        'accept-ranges': 'bytes',
      },
      body: 'x'.repeat(1024),
    },
  });

  const result = await performMediaProxy(
    { rawUrl: 'https://cdn.example.com/seg/1.ts', method: 'GET', range: 'bytes=0-1023' },
    { allowedHosts: ALLOWED, fetchImpl },
  );

  assert.equal(result.status, 206);
  assert.equal(result.kind, 'media');
  assert.equal(result.headers['Content-Range'], 'bytes 0-1023/98765');
  assert.equal(result.headers['Content-Length'], '1024');
  assert.equal(result.headers['Accept-Ranges'], 'bytes');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(calls[0].headers.range, 'bytes=0-1023');
  assert.equal((await bodyText(result.body)).length, 1024);
});

test('a malformed Range header is dropped rather than forwarded', async () => {
  const { fetchImpl, calls } = stubFetch({
    'https://cdn.example.com/seg/1.ts': { headers: { 'content-type': 'video/mp2t' }, body: 'data' },
  });
  await performMediaProxy(
    { rawUrl: 'https://cdn.example.com/seg/1.ts', method: 'GET', range: 'bytes=0-10; drop table' },
    { allowedHosts: ALLOWED, fetchImpl },
  );
  assert.equal(calls[0].headers.range, undefined);
});

test('a re-encoded upstream body never forwards its stale content-length', async () => {
  const { fetchImpl } = stubFetch({
    'https://cdn.example.com/seg/1.ts': {
      headers: { 'content-type': 'video/mp2t', 'content-length': '40', 'content-encoding': 'gzip' },
      body: 'decompressed body that is much longer than forty bytes',
    },
  });
  const result = await performMediaProxy({ rawUrl: 'https://cdn.example.com/seg/1.ts', method: 'GET' }, { allowedHosts: ALLOWED, fetchImpl });
  assert.equal(result.headers['Content-Length'], undefined);
  assert.equal((await bodyText(result.body)).length, 54);
});

test('HEAD returns headers only', async () => {
  const { fetchImpl, calls } = stubFetch({
    'https://cdn.example.com/seg/1.ts': {
      headers: { 'content-type': 'video/mp2t', 'content-length': '2048' },
      body: null,
    },
  });
  const result = await performMediaProxy({ rawUrl: 'https://cdn.example.com/seg/1.ts', method: 'HEAD' }, { allowedHosts: ALLOWED, fetchImpl });
  assert.equal(result.body, null);
  assert.equal(result.headers['Content-Length'], '2048');
  assert.equal(calls[0].method, 'HEAD');
});

test('an upstream error status is surfaced as 502, not passed through', async () => {
  const { fetchImpl } = stubFetch({
    'https://cdn.example.com/a.m3u8': { status: 404, headers: { 'content-type': 'text/plain' }, body: 'nope' },
  });
  const result = await performMediaProxy({ rawUrl: 'https://cdn.example.com/a.m3u8', method: 'GET' }, { allowedHosts: ALLOWED, fetchImpl });
  assert.equal(result.status, 502);
});

test('an unreachable origin is reported without leaking the upstream error', async () => {
  const fetchImpl = (async () => {
    throw new Error('ECONNREFUSED 203.0.113.9:443');
  }) as unknown as typeof fetch;
  const result = await performMediaProxy({ rawUrl: 'https://cdn.example.com/a.m3u8', method: 'GET' }, { allowedHosts: ALLOWED, fetchImpl });
  assert.equal(result.status, 502);
  assert.ok(!(await bodyText(result.body)).includes('203.0.113.9'));
});

test('a Range header is never forwarded for a playlist URL', async () => {
  const { fetchImpl, calls } = stubFetch({
    'https://cdn.example.com/master.m3u8': {
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n',
    },
  });
  const result = await performMediaProxy(
    { rawUrl: 'https://cdn.example.com/master.m3u8', method: 'GET', range: 'bytes=0-1' },
    { allowedHosts: ALLOWED, fetchImpl },
  );
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.range, undefined);
  assert.match(await bodyText(result.body), /^#EXTM3U/);
});

test('a Range header is forwarded for progressive media', async () => {
  const { fetchImpl, calls } = stubFetch({
    'https://cdn.example.com/video.mp4': {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1/1000' },
      body: 'ab',
    },
  });
  const result = await performMediaProxy(
    { rawUrl: 'https://cdn.example.com/video.mp4', method: 'GET', range: 'bytes=0-1' },
    { allowedHosts: ALLOWED, fetchImpl },
  );
  assert.equal(result.status, 206);
  assert.equal(calls[0].headers.range, 'bytes=0-1');
  assert.equal(result.headers['X-Aniverse-Proxy-Kind'], 'media');
});

test('a partial playlist response is re-fetched in full instead of rewritten truncated', async () => {
  let hit = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    hit += 1;
    const headers = new Headers(init?.headers);
    if (headers.has('range')) {
      return new Response('#E', { status: 206, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\nseg0.ts\n', {
      status: 200,
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
    });
  }) as unknown as typeof fetch;

  // A playlist behind an extension-less URL: the first attempt carries the
  // caller's Range because the path gives nothing away.
  const result = await performMediaProxy(
    { rawUrl: 'https://cdn.example.com/stream/manifest', method: 'GET', range: 'bytes=0-1' },
    { allowedHosts: ALLOWED, fetchImpl },
  );
  assert.equal(hit, 2);
  assert.equal(result.status, 200);
  const text = await bodyText(result.body);
  assert.match(text, /^#EXTM3U/);
  assert.match(text, /\/api\/proxy\?url=https%3A%2F%2Fcdn\.example\.com%2Fstream%2Fseg0\.ts/);
});
