import assert from 'node:assert/strict';
import test from 'node:test';
import { catalog } from '../lib/catalog';

test('demo catalog records are poster-only and do not point at missing video files', () => {
  assert.equal(catalog.length, 5);
  assert.ok(catalog.every((item) => item.previewUrl === undefined));
  assert.ok(catalog.every((item) => item.coverPoster.startsWith('/posters/')));
  assert.ok(catalog.every((item) => item.episodes.every((episode) => episode.mirrors.length === 0)));
});
