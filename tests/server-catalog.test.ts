import assert from 'node:assert/strict';
import test from 'node:test';
import { GET } from '../app/api/catalog/route';
import type { MediaCatalogRecord, StreamMirrorNode } from '../types/media';

// Every mirror tier in the server catalog matrix, in priority order.
// If a server is intentionally removed or re-ordered, update this list on purpose.
const EXPECTED_SERVER_ORDER = [
  'Vidstream / Vidplay',
  'MyCloud (MCloud)',
  'Filemoon',
  'DoodStream Node',
  'Streamtape Mirror',
  'Voe.sx Cluster',
  'Streamwish Node',
  'Vidhide Secure Node',
  'Mp4Upload High-Bitrate',
  'Netu.tv Resilient Core',
  'Mixdrop Alternative Path',
];

test('GET /api/catalog serves the server catalog matrix with every server present', async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);

  const body = (await response.json()) as MediaCatalogRecord[];
  assert.equal(body.length, 1);

  const record = body[0];
  assert.equal(record.id, 'bleach-tybw-masterpiece');
  assert.equal(record.title, 'Bleach: Thousand-Year Blood War');
  assert.ok(record.synopsis.length > 0);
  assert.ok(record.coverPoster.startsWith('/posters/'));
  assert.ok(Number.isFinite(record.year));
  assert.ok(record.genre.length > 0);
  assert.ok(record.format.length > 0);

  const episode = record.episodes.find((item) => item.episodeNumber === 1);
  assert.ok(episode, 'episode 1 must exist');
  assert.ok(episode.episodeTitle.length > 0);

  assert.equal(episode.mirrors.length, EXPECTED_SERVER_ORDER.length);
  assert.deepEqual(
    episode.mirrors.map((mirror) => mirror.serverName),
    EXPECTED_SERVER_ORDER,
  );

  for (const mirror of episode.mirrors as StreamMirrorNode[]) {
    assert.ok(mirror.manifestUrl.startsWith('https://'), `${mirror.serverName} must expose an HTTPS manifest URL`);
    assert.equal(typeof mirror.requiresProxy, 'boolean', `${mirror.serverName} must declare its proxy tier`);
  }
});
