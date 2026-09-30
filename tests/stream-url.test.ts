import assert from 'node:assert/strict';
import test from 'node:test';
import { isProbeable, mirrorsSignature, playbackUrlFor } from '../lib/stream-url';
import type { StreamMirrorNode } from '../types/media';

function mirror(overrides: Partial<StreamMirrorNode> = {}): StreamMirrorNode {
  return {
    id: 'server-a',
    serverName: 'Server A',
    group: 'Licensed',
    language: 'sub',
    kind: 'hls',
    manifestUrl: 'https://cdn.example.com/master.m3u8?token=abc&x=1',
    requiresProxy: true,
    priority: 1,
    ...overrides,
  };
}

test('proxied mirrors are rewritten to the same-origin endpoint with a fully encoded target', () => {
  const url = playbackUrlFor(mirror());
  assert.ok(url.startsWith('/api/proxy?url=https%3A%2F%2Fcdn.example.com%2Fmaster.m3u8%3Ftoken%3Dabc%26x%3D1'));
  // The invariant that matters: the target's own query string must survive
  // encoding intact rather than bleeding into our parameters.
  const params = new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('url'), 'https://cdn.example.com/master.m3u8?token=abc&x=1');
  assert.equal(params.get('token'), null, 'the target query string must not leak into ours');
});

test('mirrors flagged requiresProxy:false are addressed directly', () => {
  assert.equal(playbackUrlFor(mirror({ requiresProxy: false })), 'https://cdn.example.com/master.m3u8?token=abc&x=1');
});

test('an omitted requiresProxy defaults to proxying', () => {
  const rest = { ...mirror() };
  delete rest.requiresProxy;
  assert.match(playbackUrlFor(rest), /^\/api\/proxy\?url=/);
  assert.equal(isProbeable(rest), true);
});

test('only same-origin proxy mirrors are probeable', () => {
  assert.equal(isProbeable(mirror()), true);
  assert.equal(isProbeable(mirror({ requiresProxy: false })), false);
});

test('the mirror signature changes when a URL or server changes, not on re-render', () => {
  const list = [mirror(), mirror({ id: 'server-b', manifestUrl: 'https://cdn2.example.com/master.m3u8' })];
  assert.equal(mirrorsSignature(list), mirrorsSignature([...list]));
  assert.notEqual(
    mirrorsSignature(list),
    mirrorsSignature([mirror(), mirror({ id: 'server-b', manifestUrl: 'https://cdn3.example.com/master.m3u8' })]),
  );
});

test('a proxied url carries the mirror id so telemetry can be attributed', () => {
  const url = playbackUrlFor({ manifestUrl: 'https://cdn.example.com/m.m3u8', id: 'mux-1' });
  const params = new URL(url, 'https://app.test').searchParams;
  assert.equal(params.get('url'), 'https://cdn.example.com/m.m3u8');
  assert.equal(params.get('mirror'), 'mux-1');
});

test('a direct (unproxied) url is never rewritten to carry attribution', () => {
  const url = playbackUrlFor({
    manifestUrl: 'https://cdn.example.com/m.m3u8', id: 'mux-1', requiresProxy: false,
  });
  assert.equal(url, 'https://cdn.example.com/m.m3u8');
});

test('a mirror id needing encoding does not break the query string', () => {
  const url = playbackUrlFor({ manifestUrl: 'https://cdn.example.com/m.m3u8', id: 'a&b=c' });
  assert.equal(new URL(url, 'https://app.test').searchParams.get('mirror'), 'a&b=c');
});
