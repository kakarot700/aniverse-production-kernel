import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECENCY_HALF_LIFE_MS,
  buildTasteProfile,
  profileFromLibrary,
  recommend,
  scoreCandidate,
  topGenres,
  type ProfileSource,
} from '../lib/recommendations';
import { emptyLibrary, recordProgress, toggleWatchlist } from '../lib/user-data/library';
import type { AnimeSummary } from '../types/anime';

const NOW = 1_700_000_000_000;

function anime(id: string, genres: string[], extra: Partial<AnimeSummary> = {}): AnimeSummary {
  return {
    id,
    anilistId: null,
    malId: null,
    slug: id,
    title: id,
    titles: { romaji: id, english: null, native: null },
    synopsis: '',
    coverImage: '',
    bannerImage: null,
    accentColor: null,
    genres,
    year: 2020,
    season: null,
    format: 'TV',
    status: 'FINISHED',
    episodeCount: 12,
    durationMinutes: 24,
    averageScore: 70,
    popularity: 1000,
    studios: [],
    isAdult: false,
    trailer: null,
    source: 'anilist',
    ...extra,
  };
}

function source(overrides: Partial<ProfileSource> = {}): ProfileSource {
  return {
    mediaId: 'anilist:1',
    title: 'Watched',
    genres: ['Action', 'Fantasy'],
    studios: ['Studio A'],
    format: 'TV',
    updatedAt: NOW,
    weight: 1,
    ...overrides,
  };
}

test('an empty profile recommends nothing', () => {
  const profile = buildTasteProfile([], NOW);
  assert.equal(profile.strength, 0);
  assert.equal(scoreCandidate(anime('a', ['Action']), profile), null);
  assert.deepEqual(recommend([anime('a', ['Action'])], profile), []);
});

test('genre overlap drives the ranking', () => {
  const profile = buildTasteProfile([source()], NOW);
  const results = recommend(
    [anime('match', ['Action', 'Fantasy']), anime('partial', ['Action']), anime('miss', ['Sports'])],
    profile,
  );

  assert.deepEqual(results.map((entry) => entry.item.id), ['match', 'partial']);
  assert.ok(results[0].score > results[1].score);
  assert.equal(results.find((entry) => entry.item.id === 'miss'), undefined);
});

test('already watched or saved titles are never recommended back', () => {
  const profile = buildTasteProfile([source({ mediaId: 'anilist:7' })], NOW);
  const results = recommend([anime('anilist:7', ['Action', 'Fantasy'])], profile);
  assert.deepEqual(results, []);
});

test('explicit exclusions are honoured on top of the known set', () => {
  const profile = buildTasteProfile([source()], NOW);
  const results = recommend([anime('a', ['Action']), anime('b', ['Action'])], profile, { exclude: ['a'] });
  assert.deepEqual(results.map((entry) => entry.item.id), ['b']);
});

test('a studio match adds to the score and shows up in the reason', () => {
  const profile = buildTasteProfile([source()], NOW);
  const withStudio = scoreCandidate(anime('s', ['Action'], { studios: ['Studio A'] }), profile);
  const withoutStudio = scoreCandidate(anime('n', ['Action']), profile);

  assert.ok(withStudio && withoutStudio);
  assert.ok(withStudio.score > withoutStudio.score);
  assert.match(withStudio.reason, /Studio A/);
});

test('a carpet-bombed genre list cannot outrank a focused match', () => {
  const profile = buildTasteProfile([source()], NOW);
  const focused = scoreCandidate(anime('focused', ['Action', 'Fantasy']), profile);
  const everything = scoreCandidate(
    anime('everything', ['Action', 'Fantasy', 'Sports', 'Music', 'Horror', 'Mecha', 'Romance', 'Comedy']),
    profile,
  );

  assert.ok(focused && everything);
  assert.ok(focused.score > everything.score, 'normalisation by genre count holds');
});

test('recent history outweighs stale history', () => {
  const profile = buildTasteProfile(
    [
      source({ mediaId: 'old', genres: ['Sports'], updatedAt: NOW - RECENCY_HALF_LIFE_MS * 6 }),
      source({ mediaId: 'new', genres: ['Horror'], updatedAt: NOW }),
    ],
    NOW,
  );

  const results = recommend([anime('sporty', ['Sports']), anime('scary', ['Horror'])], profile);
  assert.equal(results[0].item.id, 'scary');
});

test('adult titles are filtered out regardless of match', () => {
  const profile = buildTasteProfile([source()], NOW);
  assert.equal(scoreCandidate(anime('x', ['Action', 'Fantasy'], { isAdult: true }), profile), null);
});

test('a higher rated title edges ahead of an equally on-taste one', () => {
  const profile = buildTasteProfile([source()], NOW);
  const good = scoreCandidate(anime('good', ['Action'], { averageScore: 88 }), profile);
  const weak = scoreCandidate(anime('weak', ['Action'], { averageScore: 55 }), profile);
  assert.ok(good && weak);
  assert.ok(good.score > weak.score);
});

test('duplicate candidates are collapsed and the limit is respected', () => {
  const profile = buildTasteProfile([source()], NOW);
  const candidates = [anime('a', ['Action']), anime('a', ['Action']), anime('b', ['Action']), anime('c', ['Action'])];
  const results = recommend(candidates, profile, { limit: 2 });
  assert.equal(results.length, 2);
  assert.equal(new Set(results.map((entry) => entry.item.id)).size, 2);
});

test('top genres summarise the profile deterministically', () => {
  const profile = buildTasteProfile(
    [source({ genres: ['Action', 'Action', 'Fantasy'] }), source({ mediaId: 'x', genres: ['Action'] })],
    NOW,
  );
  assert.equal(topGenres(profile, 1)[0], 'Action');
});

test('a profile reads straight out of stored library state', () => {
  let state = emptyLibrary();
  state = recordProgress(state, {
    mediaId: 'anilist:1',
    episodeNumber: 1,
    positionMs: 60_000,
    durationMs: 1_400_000,
    title: 'Watched',
    coverImage: '',
    genres: ['Action', 'Fantasy'],
    studios: ['Studio A'],
    format: 'TV',
    now: NOW,
  });
  state = toggleWatchlist(
    state,
    { mediaId: 'anilist:2', title: 'Saved', coverImage: '', genres: ['Horror'], format: 'MOVIE' },
    NOW,
  );

  const profile = profileFromLibrary(state, NOW);
  assert.ok(profile.strength > 0);
  assert.equal(profile.known.has('anilist:1'), true);
  assert.equal(profile.known.has('anilist:2'), true);
  assert.ok((profile.genres.get('Action') ?? 0) > (profile.genres.get('Horror') ?? 0), 'a watch outweighs a save');

  const results = recommend([anime('new', ['Action', 'Fantasy'])], profile);
  assert.equal(results[0].item.id, 'new');
});

test('history with no genre metadata produces an empty profile rather than throwing', () => {
  let state = emptyLibrary();
  state = recordProgress(state, {
    mediaId: 'anilist:9', episodeNumber: 1, positionMs: 60_000, durationMs: 1_000,
    title: 'Legacy record', coverImage: '', now: NOW,
  });
  const profile = profileFromLibrary(state, NOW);
  assert.equal(profile.strength, 0);
  assert.deepEqual(recommend([anime('a', ['Action'])], profile), []);
});
