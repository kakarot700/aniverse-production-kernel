import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPLETION_RATIO,
  MAX_PROGRESS_ENTRIES,
  MIN_RESUME_MS,
  continueWatching,
  emptyLibrary,
  forgetTitle,
  isInWatchlist,
  latestEpisodeFor,
  parseLibrary,
  prune,
  recordProgress,
  resumePositionFor,
  toggleWatchlist,
  watchlistEntries,
} from '../lib/user-data/library';

const NOW = 1_700_000_000_000;
const EPISODE_MS = 24 * 60 * 1000;

function withEpisode(positionMs: number, episodeNumber = 1, now = NOW, episodeCount: number | null = 12) {
  return recordProgress(emptyLibrary(), {
    mediaId: 'anilist:21',
    episodeNumber,
    positionMs,
    durationMs: EPISODE_MS,
    title: 'One Piece',
    coverImage: '/posters/aurora.jpg',
    episodeCount,
    now,
  });
}

test('recording progress does not mutate the previous state', () => {
  const before = emptyLibrary();
  const after = withEpisode(60_000);
  assert.deepEqual(before.progress, {}, 'the original object is untouched');
  assert.notEqual(before, after);
  assert.equal(Object.keys(after.progress).length, 1);
});

test('a barely-started episode is not offered as a resume', () => {
  const state = withEpisode(MIN_RESUME_MS - 1);
  assert.equal(resumePositionFor(state, 'anilist:21', 1), 0);
  assert.equal(continueWatching(state).length, 0, 'and it does not clutter the continue row');
});

test('a genuinely watched episode resumes where it stopped', () => {
  const state = withEpisode(8 * 60_000);
  assert.equal(resumePositionFor(state, 'anilist:21', 1), 8 * 60_000);

  const [item] = continueWatching(state);
  assert.equal(item.episodeNumber, 1);
  assert.equal(item.resumeMs, 8 * 60_000);
  assert.ok(item.progressRatio > 0.3 && item.progressRatio < 0.4);
});

test('finishing an episode advances the continue row to the next one', () => {
  const state = withEpisode(Math.ceil(EPISODE_MS * COMPLETION_RATIO) + 1_000);
  assert.equal(state.progress['anilist:21::1'].completed, true);
  assert.equal(resumePositionFor(state, 'anilist:21', 1), 0, 'a finished episode restarts rather than resuming at the credits');

  const [item] = continueWatching(state);
  assert.equal(item.episodeNumber, 2);
  assert.equal(item.resumeMs, 0);
});

test('finishing the final episode retires the series from the continue row', () => {
  const state = withEpisode(EPISODE_MS, 12, NOW, 12);
  assert.equal(continueWatching(state).length, 0);
});

test('a series with an unknown episode count keeps offering the next episode', () => {
  const state = withEpisode(EPISODE_MS, 12, NOW, null);
  const [item] = continueWatching(state);
  assert.equal(item.episodeNumber, 13);
});

test('a source with no duration never auto-completes', () => {
  const state = recordProgress(emptyLibrary(), {
    mediaId: 'anilist:1',
    episodeNumber: 1,
    positionMs: 30 * 60_000,
    durationMs: 0,
    title: 'Cowboy Bebop',
    coverImage: '',
    now: NOW,
  });
  assert.equal(state.progress['anilist:1::1'].completed, false);
  assert.equal(resumePositionFor(state, 'anilist:1', 1), 30 * 60_000);
});

test('the continue row shows one entry per title, most recent first', () => {
  let state = emptyLibrary();
  state = recordProgress(state, {
    mediaId: 'anilist:1', episodeNumber: 1, positionMs: 60_000, durationMs: EPISODE_MS,
    title: 'A', coverImage: '', now: NOW,
  });
  state = recordProgress(state, {
    mediaId: 'anilist:1', episodeNumber: 2, positionMs: 60_000, durationMs: EPISODE_MS,
    title: 'A', coverImage: '', now: NOW + 5_000,
  });
  state = recordProgress(state, {
    mediaId: 'anilist:2', episodeNumber: 1, positionMs: 60_000, durationMs: EPISODE_MS,
    title: 'B', coverImage: '', now: NOW + 10_000,
  });

  const row = continueWatching(state);
  assert.equal(row.length, 2);
  assert.equal(row[0].mediaId, 'anilist:2');
  assert.equal(row[1].mediaId, 'anilist:1');
  assert.equal(row[1].episodeNumber, 2, 'the most recent episode of that title wins');
});

test('latestEpisodeFor picks the most recently touched episode', () => {
  let state = withEpisode(60_000, 3, NOW);
  state = recordProgress(state, {
    mediaId: 'anilist:21', episodeNumber: 4, positionMs: 20_000, durationMs: EPISODE_MS,
    title: 'One Piece', coverImage: '', now: NOW + 1_000,
  });
  assert.equal(latestEpisodeFor(state, 'anilist:21')?.episodeNumber, 4);
  assert.equal(latestEpisodeFor(state, 'anilist:999'), null);
});

test('the watchlist toggles and orders newest first', () => {
  let state = emptyLibrary();
  state = toggleWatchlist(state, { mediaId: 'a', title: 'A', coverImage: '' }, NOW);
  state = toggleWatchlist(state, { mediaId: 'b', title: 'B', coverImage: '' }, NOW + 1_000);

  assert.equal(isInWatchlist(state, 'a'), true);
  assert.deepEqual(watchlistEntries(state).map((entry) => entry.mediaId), ['b', 'a']);

  state = toggleWatchlist(state, { mediaId: 'a', title: 'A', coverImage: '' }, NOW + 2_000);
  assert.equal(isInWatchlist(state, 'a'), false);
});

test('forgetting a title clears its progress but not the watchlist', () => {
  let state = withEpisode(60_000);
  state = toggleWatchlist(state, { mediaId: 'anilist:21', title: 'One Piece', coverImage: '' }, NOW);
  state = forgetTitle(state, 'anilist:21');

  assert.equal(continueWatching(state).length, 0);
  assert.equal(isInWatchlist(state, 'anilist:21'), true);
});

test('progress rows are pruned oldest-first at the cap', () => {
  let state = emptyLibrary();
  for (let index = 0; index < MAX_PROGRESS_ENTRIES + 25; index += 1) {
    state = recordProgress(state, {
      mediaId: `anilist:${index}`, episodeNumber: 1, positionMs: 60_000, durationMs: EPISODE_MS,
      title: `Title ${index}`, coverImage: '', now: NOW + index,
    });
  }
  assert.equal(Object.keys(state.progress).length, MAX_PROGRESS_ENTRIES);
  assert.ok(state.progress['anilist:424::1'], 'the newest row survived');
  assert.equal(state.progress['anilist:0::1'], undefined, 'the oldest row was dropped');
});

test('prune is a no-op below the cap', () => {
  const state = withEpisode(60_000);
  assert.equal(prune(state), state);
});

test('invalid input is rejected rather than stored', () => {
  const base = emptyLibrary();
  assert.equal(recordProgress(base, {
    mediaId: '', episodeNumber: 1, positionMs: 0, title: 'x', coverImage: '',
  }), base);
  assert.equal(recordProgress(base, {
    mediaId: 'a', episodeNumber: 0, positionMs: 0, title: 'x', coverImage: '',
  }), base);
  assert.equal(recordProgress(base, {
    mediaId: 'a', episodeNumber: 1.5, positionMs: 0, title: 'x', coverImage: '',
  }), base);
});

test('stored JSON is re-validated, not trusted', () => {
  assert.deepEqual(parseLibrary(null), emptyLibrary());
  assert.deepEqual(parseLibrary('nonsense'), emptyLibrary());

  const recovered = parseLibrary({
    version: 1,
    progress: {
      good: { mediaId: 'a', episodeNumber: 2, positionMs: 500, durationMs: 1_000, title: 'A', coverImage: '' },
      missingId: { episodeNumber: 1, positionMs: 10 },
      badEpisode: { mediaId: 'b', episodeNumber: -4, positionMs: 10 },
      badPosition: { mediaId: 'c', episodeNumber: 1, positionMs: -10 },
    },
    watchlist: {
      keep: { mediaId: 'z', title: 'Z', addedAt: 5 },
      drop: { title: 'no id' },
    },
  });

  assert.deepEqual(Object.keys(recovered.progress), ['good']);
  assert.equal(recovered.progress.good.updatedAt, 0, 'a missing timestamp defaults rather than throwing');
  assert.deepEqual(Object.keys(recovered.watchlist), ['keep']);
});
