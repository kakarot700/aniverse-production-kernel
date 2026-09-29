import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeEntities, describeRuntime, formatLabel, slugify, stripHtml, truncate } from '../lib/anime/text';

test('AniList descriptions are flattened to safe plain text', () => {
  const source = 'A war begins.<br><br><i>Everything</i> changes &mdash; forever.<script>alert(1)</script>';
  const result = stripHtml(source);
  assert.equal(result, 'A war begins.\n\nEverything changes — forever.alert(1)');
  assert.ok(!result.includes('<'));
  assert.ok(!result.includes('>'));
});

test('numeric and named HTML entities decode', () => {
  assert.equal(decodeEntities('&amp;&lt;&gt;&#39;&#x27;&quot;'), '&<>\'\'"');
  assert.equal(decodeEntities('&unknownentity;'), '&unknownentity;');
});

test('empty or missing descriptions collapse to an empty string', () => {
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
  assert.equal(stripHtml('   '), '');
});

test('slugs are ASCII, hyphenated and bounded', () => {
  assert.equal(slugify('Kimetsu no Yaiba: Yuukaku-hen'), 'kimetsu-no-yaiba-yuukaku-hen');
  assert.equal(slugify('  ///  '), 'untitled');
  assert.ok(slugify('x'.repeat(200)).length <= 80);
});

test('truncate keeps whole words and marks the cut', () => {
  assert.equal(truncate('short', 20), 'short');
  const cut = truncate('the quick brown fox jumps over the lazy dog', 20);
  assert.ok(cut.endsWith('…'));
  assert.ok(cut.length <= 21);
});

test('format labels stay readable', () => {
  assert.equal(formatLabel('TV'), 'TV');
  assert.equal(formatLabel('TV_SHORT'), 'Tv Short');
  assert.equal(formatLabel('MOVIE'), 'Movie');
  assert.equal(formatLabel('ONA'), 'Ona');
});

test('runtime descriptions cover films, finished runs and ongoing shows', () => {
  assert.equal(describeRuntime({ format: 'MOVIE', episodeCount: 1, durationMinutes: 108 }), 'Movie · 1h 48m');
  assert.equal(describeRuntime({ format: 'MOVIE', episodeCount: 1, durationMinutes: 47 }), 'Movie · 47m');
  assert.equal(describeRuntime({ format: 'MOVIE', episodeCount: null, durationMinutes: null }), 'Movie');
  assert.equal(describeRuntime({ format: 'TV', episodeCount: 12, durationMinutes: 24 }), 'TV · 12 episodes');
  assert.equal(describeRuntime({ format: 'TV', episodeCount: 1, durationMinutes: 24 }), 'TV · 1 episode');
  assert.equal(describeRuntime({ format: 'TV', episodeCount: null, durationMinutes: 24 }), 'TV · ongoing');
});
