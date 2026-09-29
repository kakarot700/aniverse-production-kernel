import assert from 'node:assert/strict';
import test from 'node:test';
import {
  looksLikeHlsPlaylist,
  parseAllowedHosts,
  parseAllowedMediaUrl,
  rewriteHlsManifest,
  sanitizeRangeHeader,
  shouldForwardContentLength,
} from '../lib/media-proxy';

test('allowed host parsing trims and ignores empty entries', () => {
  assert.deepEqual(parseAllowedHosts(' cdn.example.com, ,*.assets.example '), ['cdn.example.com', '*.assets.example']);
});

test('media URL checks require HTTPS and an allowlisted hostname', () => {
  assert.equal(parseAllowedMediaUrl('https://cdn.example.com/master.m3u8', ['cdn.example.com']).ok, true);
  assert.equal(parseAllowedMediaUrl('http://cdn.example.com/master.m3u8', ['cdn.example.com']).ok, false);
  assert.equal(parseAllowedMediaUrl('https://other.example/master.m3u8', ['cdn.example.com']).ok, false);
  assert.equal(parseAllowedMediaUrl('https://user:pass@cdn.example.com/master.m3u8', ['cdn.example.com']).ok, false);
});

test('wildcard hosts do not match the bare suffix or a lookalike suffix', () => {
  const hosts = ['*.media.example'];
  assert.equal(parseAllowedMediaUrl('https://edge.media.example/master.m3u8', hosts).ok, true);
  assert.equal(parseAllowedMediaUrl('https://media.example/master.m3u8', hosts).ok, false);
  assert.equal(parseAllowedMediaUrl('https://edge.media.example.attacker.test/master.m3u8', hosts).ok, false);
});

test('loopback and literal IP targets are rejected even if a broad allowlist is supplied', () => {
  const allow = ['127.0.0.1', 'localhost', '::1', '*.example.com'];
  assert.equal(parseAllowedMediaUrl('https://127.0.0.1/private', allow).ok, false);
  assert.equal(parseAllowedMediaUrl('https://localhost/private', allow).ok, false);
  assert.equal(parseAllowedMediaUrl('https://[::1]/private', allow).ok, false);
});

test('HLS child playlists, segments, and quoted key URIs are rewritten through the local proxy', () => {
  const source = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../keys/key.bin"\n#EXTINF:6,\nsegments/001.ts\n';
  const result = rewriteHlsManifest(source, 'https://cdn.example.com/series/ep/master.m3u8?token=abc');
  assert.match(result, /URI="\/api\/proxy\?url=/);
  assert.match(result, /https%3A%2F%2Fcdn\.example\.com%2Fseries%2Fkeys%2Fkey\.bin/);
  assert.match(result, /https%3A%2F%2Fcdn\.example\.com%2Fseries%2Fep%2Fsegments%2F001\.ts/);
  assert.ok(result.startsWith('#EXTM3U'));
});

test('non-HTTP URI schemes in HLS attributes are not rewritten', () => {
  const source = '#EXTM3U\n#EXT-X-KEY:METHOD=NONE,URI="data:application/octet-stream;base64,AA=="\n';
  assert.equal(rewriteHlsManifest(source, 'https://cdn.example.com/master.m3u8'), source);
});

test('content-length is only forwarded when the upstream body was not re-encoded', () => {
  assert.equal(shouldForwardContentLength(null), true);
  assert.equal(shouldForwardContentLength('identity'), true);
  assert.equal(shouldForwardContentLength(' IDENTITY '), true);
  // fetch transparently decompresses these, so the upstream length is a lie.
  assert.equal(shouldForwardContentLength('gzip'), false);
  assert.equal(shouldForwardContentLength('br'), false);
  assert.equal(shouldForwardContentLength('gzip, chunked'), false);
});

test('only well-formed byte ranges are forwarded upstream', () => {
  assert.equal(sanitizeRangeHeader('bytes=0-1023'), 'bytes=0-1023');
  assert.equal(sanitizeRangeHeader('  bytes=500-  '), 'bytes=500-');
  assert.equal(sanitizeRangeHeader('bytes=0-99, 200-299'), 'bytes=0-99, 200-299');
  assert.equal(sanitizeRangeHeader(null), null);
  assert.equal(sanitizeRangeHeader('items=0-10'), null);
  assert.equal(sanitizeRangeHeader('bytes=0-10; injected'), null);
  assert.equal(sanitizeRangeHeader(`bytes=${'0-1,'.repeat(60)}0-1`), null);
});

test('playlists are detected by content type or by path', () => {
  assert.equal(looksLikeHlsPlaylist('application/vnd.apple.mpegurl', '/a/b'), true);
  assert.equal(looksLikeHlsPlaylist('application/x-mpegURL', '/a/b'), true);
  assert.equal(looksLikeHlsPlaylist('application/octet-stream', '/a/master.m3u8'), true);
  assert.equal(looksLikeHlsPlaylist('text/plain', '/a/index.M3U8'), true);
  assert.equal(looksLikeHlsPlaylist('video/mp2t', '/a/seg-001.ts'), false);
  assert.equal(looksLikeHlsPlaylist('video/mp4', '/a/movie.mp4'), false);
});

test('a manifest served from a redirected URL resolves relative children against the final URL', () => {
  const source = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n480p/index.m3u8\n';
  const result = rewriteHlsManifest(source, 'https://edge.example.com/deep/path/master.m3u8');
  assert.match(result, /https%3A%2F%2Fedge\.example\.com%2Fdeep%2Fpath%2F480p%2Findex\.m3u8/);
});

test('absolute child URLs on other hosts are still routed through the proxy for allowlist checks', () => {
  const source = '#EXTM3U\n#EXTINF:6,\nhttps://segments.example.net/a/1.ts\n';
  const result = rewriteHlsManifest(source, 'https://cdn.example.com/master.m3u8');
  assert.match(result, /^\/api\/proxy\?url=https%3A%2F%2Fsegments\.example\.net%2Fa%2F1\.ts$/m);
});
