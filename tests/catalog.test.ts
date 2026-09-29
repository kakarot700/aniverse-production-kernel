import assert from 'node:assert/strict';
import test from 'node:test';
import { catalog, getPublicCatalog, toPublicCatalogRecord } from '../lib/catalog';

test('demo catalog records are poster-only and do not point at missing video files', () => {
  assert.equal(catalog.length, 5);
  assert.ok(catalog.every((item) => item.previewUrl === undefined));
  assert.ok(catalog.every((item) => item.coverPoster.startsWith('/posters/')));
  assert.ok(catalog.every((item) => item.episodes.every((episode) => episode.mirrors.length === 0)));
});

test('the public catalog projection keeps every record and its display fields', () => {
  const publicCatalog = getPublicCatalog();
  assert.deepEqual(publicCatalog.map((item) => item.id), catalog.map((item) => item.id));
  assert.deepEqual(publicCatalog.map((item) => item.title), catalog.map((item) => item.title));
  assert.ok(publicCatalog.every((item) => item.coverPoster.startsWith('/posters/')));
  assert.ok(publicCatalog.every((item) => item.episodes.length > 0));
});

test('the public catalog projection never exposes mirror manifest URLs', () => {
  const serialized = JSON.stringify(getPublicCatalog());
  assert.ok(!serialized.includes('mirrors'));
  assert.ok(!serialized.includes('manifestUrl'));
  assert.ok(getPublicCatalog().every((item) => item.episodes.every((episode) => episode.mirrorCount === 0)));
});

test('projection allowlists fields, so a private mirror URL cannot leak through', () => {
  const projected = toPublicCatalogRecord({
    id: 'private-source',
    title: 'Private Source',
    synopsis: 'A record whose mirrors must not reach the client.',
    coverPoster: '/posters/aurora.jpg',
    genre: 'Fantasy',
    year: 2025,
    format: 'Series · 1 episode',
    episodes: [{
      episodeNumber: 1,
      episodeTitle: 'Only Episode',
      mirrors: [{ serverName: 'Owned CDN', manifestUrl: 'https://cdn.example.com/secret/master.m3u8' }],
    }],
  });

  assert.equal(projected.episodes[0].mirrorCount, 1);
  assert.ok(!('mirrors' in projected.episodes[0]));
  assert.ok(!JSON.stringify(projected).includes('cdn.example.com'));
});
