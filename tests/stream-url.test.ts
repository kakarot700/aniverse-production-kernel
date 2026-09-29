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
  assert.equal(url, '/api/proxy?url=https%3A%2F%2Fcdn.example.com%2Fmaster.m3u8%3Ftoken%3Dabc%26x%3D1');
  assert.equal(new URLSearchParams(url.split('?')[1]).get('url'), 'https://cdn.example.com/master.m3u8?token=abc&x=1');
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
