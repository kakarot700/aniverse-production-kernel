import assert from 'node:assert/strict';
import test from 'node:test';
import { computeStats, formatWatchTime } from '../lib/user-data/stats';
import type { EpisodeProgress, LibraryState } from '../lib/user-data/library';

function progress(overrides: Partial<EpisodeProgress> & { mediaId: string; episodeNumber: number }): EpisodeProgress {
  return {
    positionMs: 0,
    durationMs: 24 * 60_000,
    completed: false,
    updatedAt: 1,
    title: 'Title',
    coverImage: '',
    episodeCount: 12,
    ...overrides,
  };
}

function library(records: EpisodeProgress[], watchlistIds: string[] = []): LibraryState {
  return {
    version: 1,
    progress: Object.fromEntries(records.map((r) => [`${r.mediaId}:${r.episodeNumber}`, r])),
    watchlist: Object.fromEntries(
      watchlistIds.map((id) => [id, { mediaId: id, title: id, coverImage: '', addedAt: 1 }]),
    ),
  };
}

test('an absent library produces zeroes, not a crash', () => {
  const stats = computeStats(null);
  assert.equal(stats.episodesCompleted, 0);
  assert.equal(stats.titlesStarted, 0);
  assert.deepEqual(stats.topGenres, []);
});

test('episodes and distinct titles are counted separately', () => {
  const stats = computeStats(
    library([
      progress({ mediaId: 'a', episodeNumber: 1, completed: true }),
      progress({ mediaId: 'a', episodeNumber: 2, completed: true }),
      progress({ mediaId: 'b', episodeNumber: 1, completed: true }),
    ]),
  );
  assert.equal(stats.episodesCompleted, 3);
  assert.equal(stats.titlesStarted, 2);
});

test('a title counts as complete only when every recorded episode is', () => {
  const stats = computeStats(
    library([
      progress({ mediaId: 'a', episodeNumber: 1, completed: true }),
      progress({ mediaId: 'a', episodeNumber: 2, completed: false, positionMs: 5_000 }),
      progress({ mediaId: 'b', episodeNumber: 1, completed: true }),
    ]),
  );
  assert.equal(stats.titlesCompleted, 1, 'only b');
  assert.equal(stats.inProgress, 1, 'only a');
});

test('watch time counts the position reached, not the whole episode', () => {
  // Someone who stopped four minutes in watched four minutes. Counting the
  // full runtime would inflate every total on the page.
  const stats = computeStats(
    library([progress({ mediaId: 'a', episodeNumber: 1, positionMs: 4 * 60_000, completed: false })]),
  );
  assert.equal(stats.minutesWatched, 4);
});

test('a completed episode counts its full duration', () => {
  // Stored position usually stops a little short of the end.
  const stats = computeStats(
    library([
      progress({ mediaId: 'a', episodeNumber: 1, positionMs: 23 * 60_000, durationMs: 24 * 60_000, completed: true }),
    ]),
  );
  assert.equal(stats.minutesWatched, 24);
});

test('genres and studios are ranked by frequency', () => {
  const stats = computeStats(
    library([
      progress({ mediaId: 'a', episodeNumber: 1, genres: ['Action', 'Comedy'], studios: ['Bones'] }),
      progress({ mediaId: 'a', episodeNumber: 2, genres: ['Action'], studios: ['Bones'] }),
      progress({ mediaId: 'b', episodeNumber: 1, genres: ['Comedy'], studios: ['Madhouse'] }),
    ]),
  );
  assert.deepEqual(stats.topGenres, [
    { name: 'Action', count: 2 },
    { name: 'Comedy', count: 2 },
  ]);
  assert.equal(stats.topStudios[0].name, 'Bones');
});

test('equal counts break ties alphabetically for a stable order', () => {
  const stats = computeStats(
    library([progress({ mediaId: 'a', episodeNumber: 1, genres: ['Zombie', 'Action', 'Mecha'] })]),
  );
  assert.deepEqual(stats.topGenres.map((g) => g.name), ['Action', 'Mecha', 'Zombie']);
});

test('malformed records are skipped rather than poisoning the totals', () => {
  const state = library([progress({ mediaId: 'a', episodeNumber: 1, completed: true })]);
  // Shapes that a corrupted or hand-edited localStorage can produce.
  (state.progress as Record<string, unknown>).junk = null;
  (state.progress as Record<string, unknown>).other = { episodeNumber: 3 };
  (state.progress as Record<string, unknown>).nan = progress({
    mediaId: 'c',
    episodeNumber: 1,
    positionMs: Number.NaN,
  });

  const stats = computeStats(state);
  assert.equal(stats.episodesCompleted, 1);
  assert.equal(stats.minutesWatched, 24, 'NaN must not propagate');
});

test('the watchlist is counted independently of progress', () => {
  const stats = computeStats(library([], ['a', 'b', 'c']));
  assert.equal(stats.watchlistSize, 3);
  assert.equal(stats.titlesStarted, 0);
});

test('watch time formats to the largest useful unit', () => {
  assert.equal(formatWatchTime(0), '—');
  assert.equal(formatWatchTime(-5), '—');
  assert.equal(formatWatchTime(Number.NaN), '—');
  assert.equal(formatWatchTime(45), '45m');
  assert.equal(formatWatchTime(60), '1h');
  assert.equal(formatWatchTime(90), '1h 30m');
  assert.equal(formatWatchTime(23 * 60), '23h');
  assert.equal(formatWatchTime(24 * 60), '1d');
  assert.equal(formatWatchTime(25 * 60), '1d 1h');
  assert.equal(formatWatchTime(49 * 60), '2d 1h');
});
