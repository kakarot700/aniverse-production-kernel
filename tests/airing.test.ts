import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAiringResponse } from '../lib/anime/airing';

/** A minimal but realistically shaped AniList media node. */
function media(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    idMal: 11,
    title: { romaji: 'Test Anime', english: null, native: null },
    description: 'A show.',
    coverImage: { extraLarge: 'x.jpg', large: 'l.jpg', medium: 'm.jpg', color: '#fff' },
    bannerImage: null,
    genres: ['Action'],
    seasonYear: 2026,
    season: 'FALL',
    format: 'TV',
    status: 'RELEASING',
    episodes: 12,
    duration: 24,
    averageScore: 80,
    popularity: 1000,
    isAdult: false,
    studios: { nodes: [{ name: 'Studio' }] },
    trailer: null,
    nextAiringEpisode: { episode: 5, airingAt: 1_800_000_000 },
    ...overrides,
  };
}

function response(nodes: unknown[]) {
  return { data: { Page: { media: nodes } } };
}

test('a well-formed node maps to an airing entry', () => {
  const [entry] = parseAiringResponse(response([media()]));
  assert.equal(entry.episode, 5);
  assert.equal(entry.airingAt, 1_800_000_000);
  assert.equal(entry.media.title, 'Test Anime');
  assert.equal(entry.media.id, 'anilist:1');
});

test('a releasing show with no next episode is left off the calendar', () => {
  // Usually a series on an unannounced break. It belongs in a catalog, not
  // on a schedule.
  const entries = parseAiringResponse(response([media({ nextAiringEpisode: null })]));
  assert.deepEqual(entries, []);
});

test('nodes missing an airing time or episode are dropped', () => {
  const entries = parseAiringResponse(
    response([
      media({ id: 1, nextAiringEpisode: { episode: 5, airingAt: null } }),
      media({ id: 2, nextAiringEpisode: { episode: null, airingAt: 1_800_000_000 } }),
      media({ id: 3, nextAiringEpisode: { episode: 0, airingAt: 1_800_000_000 } }),
      media({ id: 4, nextAiringEpisode: { episode: 5, airingAt: 0 } }),
      media({ id: 5, nextAiringEpisode: { episode: 5, airingAt: -1 } }),
    ]),
  );
  assert.deepEqual(entries, []);
});

test('non-numeric values never reach the UI', () => {
  // AniList is well behaved, but this is still untrusted JSON.
  const entries = parseAiringResponse(
    response([
      media({ id: 1, nextAiringEpisode: { episode: '5', airingAt: 1_800_000_000 } }),
      media({ id: 2, nextAiringEpisode: { episode: 5, airingAt: 'soon' } }),
      media({ id: 3, nextAiringEpisode: { episode: Number.NaN, airingAt: 1_800_000_000 } }),
      media({ id: 4, nextAiringEpisode: { episode: 5, airingAt: Number.POSITIVE_INFINITY } }),
    ]),
  );
  assert.deepEqual(entries, []);
});

test('one bad record does not cost the whole week', () => {
  const entries = parseAiringResponse(
    response([media({ id: 1 }), null, media({ id: 2 }), undefined]),
  );
  assert.equal(entries.length, 2);
});

test('an error-only or empty payload yields an empty week, not a throw', () => {
  assert.deepEqual(parseAiringResponse(null), []);
  assert.deepEqual(parseAiringResponse(undefined), []);
  assert.deepEqual(parseAiringResponse({}), []);
  assert.deepEqual(parseAiringResponse({ data: null }), []);
  assert.deepEqual(parseAiringResponse({ data: { Page: null } }), []);
  assert.deepEqual(parseAiringResponse({ data: { Page: { media: null } } }), []);
  assert.deepEqual(parseAiringResponse({ errors: [{ message: 'rate limited' }] }), []);
});

test('airing times stay absolute so a cached response never goes stale wrong', () => {
  // The whole reason grouping happens in the browser: the timestamp means
  // the same instant for every viewer, in every timezone.
  const [entry] = parseAiringResponse(response([media()]));
  assert.equal(typeof entry.airingAt, 'number');
  assert.equal(entry.airingAt, 1_800_000_000);
});
