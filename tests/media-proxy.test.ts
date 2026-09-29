import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllowedHosts, parseAllowedMediaUrl, rewriteHlsManifest } from '../lib/media-proxy';

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
