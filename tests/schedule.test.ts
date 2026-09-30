import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dayLabel,
  formatCountdown,
  groupByLocalDay,
  hasAired,
  localIsoDate,
  startOfLocalDay,
  unwatchedCount,
  type AiringEntry,
} from '../lib/schedule';
import type { AnimeSummary } from '../types/anime';

/**
 * Every assertion is expressed in LOCAL time and derived from `new Date(...)`
 * with local components, never from a hardcoded UTC instant. That is the whole
 * point: these tests must pass in Asia/Kolkata, UTC and America/Los_Angeles
 * alike, so they cannot bake in the runner's offset.
 */

function summary(id: string, title = id): AnimeSummary {
  return {
    id, anilistId: null, malId: null, slug: id, title,
    titles: { romaji: title, english: null, native: null },
    synopsis: '', coverImage: '', bannerImage: null, accentColor: null,
    genres: [], year: 2026, season: null, format: 'TV', status: 'RELEASING',
    episodeCount: 12, durationMinutes: 24, averageScore: 80, popularity: 1,
    studios: [], isAdult: false, trailer: null, source: 'anilist',
  };
}

/** Builds a local time today at h:m, returned as Unix seconds. */
function todayAt(hours: number, minutes = 0, dayOffset = 0): number {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function entry(id: string, airingAt: number, episode = 1): AiringEntry {
  return { media: summary(id), episode, airingAt };
}

// ───────────────────────────── day boundaries ─────────────────────────────

test('start of local day is local midnight, not UTC midnight', () => {
  const noon = new Date();
  noon.setHours(12, 34, 56, 789);
  const start = new Date(startOfLocalDay(noon.getTime()));

  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getSeconds(), 0);
  assert.equal(start.getMilliseconds(), 0);
  assert.equal(start.getDate(), noon.getDate(), 'still the same calendar day');
});

test('the local iso date does not drift to UTC', () => {
  // 23:30 local is "tomorrow" in UTC for anyone east of Greenwich, and
  // toISOString().slice(0,10) would silently report that.
  const lateEvening = new Date();
  lateEvening.setHours(23, 30, 0, 0);

  const iso = localIsoDate(lateEvening.getTime());
  const expected = `${lateEvening.getFullYear()}-${String(lateEvening.getMonth() + 1).padStart(2, '0')}-${String(lateEvening.getDate()).padStart(2, '0')}`;
  assert.equal(iso, expected);
});

test('an early morning local time does not drift backwards either', () => {
  const earlyMorning = new Date();
  earlyMorning.setHours(0, 30, 0, 0);
  const iso = localIsoDate(earlyMorning.getTime());
  assert.equal(iso.slice(8, 10), String(earlyMorning.getDate()).padStart(2, '0'));
});

test('day labels are relative to now', () => {
  const now = Date.now();
  const day = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return startOfLocalDay(date.getTime());
  };

  assert.equal(dayLabel(day(0), now), 'Today');
  assert.equal(dayLabel(day(1), now), 'Tomorrow');
  assert.equal(dayLabel(day(-1), now), 'Yesterday');

  const inThreeDays = day(3);
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  assert.equal(dayLabel(inThreeDays, now), weekdays[new Date(inThreeDays).getDay()]);
});

test('a label is computed from the calendar day, not elapsed hours', () => {
  // A DST transition makes a day 23 or 25 hours long. Dividing elapsed ms by
  // 24h would round to the wrong day.
  const now = Date.now();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 0, 0);
  assert.equal(dayLabel(startOfLocalDay(tomorrow.getTime()), now), 'Tomorrow');
});

// ───────────────────────────── grouping ─────────────────────────────

test('entries land on their local day', () => {
  const now = Date.now();
  const days = groupByLocalDay(
    [entry('a', todayAt(20)), entry('b', todayAt(9, 0, 1)), entry('c', todayAt(21, 0, 2))],
    now,
  );

  assert.equal(days.length, 7);
  assert.equal(days[0].label, 'Today');
  assert.deepEqual(days[0].entries.map((item) => item.media.id), ['a']);
  assert.deepEqual(days[1].entries.map((item) => item.media.id), ['b']);
  assert.deepEqual(days[2].entries.map((item) => item.media.id), ['c']);
});

test('empty days are preserved rather than collapsed', () => {
  // A schedule with Wednesday missing reads as a data failure; "nothing
  // airing" is information.
  const days = groupByLocalDay([entry('a', todayAt(20))], Date.now());
  assert.equal(days.length, 7);
  assert.equal(days[3].entries.length, 0);
  assert.ok(days[3].label.length > 0);
});

test('days come back in chronological order with today first', () => {
  const days = groupByLocalDay([], Date.now());
  const starts = days.map((day) => day.dayStart);
  assert.deepEqual([...starts].sort((a, b) => a - b), starts);
  assert.equal(days[0].isToday, true);
  assert.equal(days.slice(1).some((day) => day.isToday), false);
});

test('entries within a day are sorted by air time', () => {
  const days = groupByLocalDay(
    [entry('late', todayAt(22)), entry('early', todayAt(6)), entry('mid', todayAt(14))],
    Date.now(),
  );
  assert.deepEqual(days[0].entries.map((item) => item.media.id), ['early', 'mid', 'late']);
});

test('simultaneous airings are ordered by title, not left to chance', () => {
  const sameTime = todayAt(18);
  const days = groupByLocalDay(
    [
      { media: summary('z', 'Zebra'), episode: 1, airingAt: sameTime },
      { media: summary('a', 'Apple'), episode: 1, airingAt: sameTime },
    ],
    Date.now(),
  );
  assert.deepEqual(days[0].entries.map((item) => item.media.title), ['Apple', 'Zebra']);
});

test('entries beyond the horizon are dropped', () => {
  const days = groupByLocalDay([entry('far', todayAt(12, 0, 20))], Date.now());
  assert.equal(days.flatMap((day) => day.entries).length, 0);
});

test('entries from a past day are dropped rather than creating an out-of-order day', () => {
  const days = groupByLocalDay([entry('old', todayAt(12, 0, -3))], Date.now());
  assert.equal(days.flatMap((day) => day.entries).length, 0);
  assert.equal(days[0].isToday, true);
});

test('the window length is configurable and clamped', () => {
  assert.equal(groupByLocalDay([], Date.now(), { days: 3 }).length, 3);
  assert.equal(groupByLocalDay([], Date.now(), { days: 0 }).length, 1);
  assert.equal(groupByLocalDay([], Date.now(), { days: 99 }).length, 14);
});

test('earlier-today entries can be excluded for an upcoming-only view', () => {
  const now = new Date();
  now.setHours(15, 0, 0, 0);

  const entries = [entry('past', todayAt(9)), entry('future', todayAt(21))];
  const withPast = groupByLocalDay(entries, now.getTime());
  const withoutPast = groupByLocalDay(entries, now.getTime(), { includeEarlierToday: false });

  assert.equal(withPast[0].entries.length, 2);
  assert.deepEqual(withoutPast[0].entries.map((item) => item.media.id), ['future']);
});

test('malformed air times are skipped without throwing', () => {
  const days = groupByLocalDay(
    [
      { media: summary('nan'), episode: 1, airingAt: Number.NaN },
      { media: summary('zero'), episode: 1, airingAt: 0 },
      { media: summary('neg'), episode: 1, airingAt: -5 },
      entry('ok', todayAt(20)),
    ],
    Date.now(),
  );
  assert.deepEqual(days.flatMap((day) => day.entries).map((item) => item.media.id), ['ok']);
});

test('an empty input still yields a full, well-formed week', () => {
  const days = groupByLocalDay([], Date.now());
  assert.equal(days.length, 7);
  assert.ok(days.every((day) => day.entries.length === 0 && day.isoDate.length === 10));
});

// ───────────────────────────── countdown ─────────────────────────────

test('countdowns show at most two units', () => {
  assert.equal(formatCountdown(2 * 86_400 + 4 * 3600 + 32 * 60), '2d 4h');
  assert.equal(formatCountdown(4 * 3600 + 12 * 60), '4h 12m');
  assert.equal(formatCountdown(12 * 60), '12m');
});

test('a whole unit drops the empty second unit', () => {
  assert.equal(formatCountdown(2 * 86_400), '2d');
  assert.equal(formatCountdown(3 * 3600), '3h');
});

test('the countdown degrades sensibly at the boundaries', () => {
  assert.equal(formatCountdown(0), 'now');
  assert.equal(formatCountdown(-60), 'now');
  assert.equal(formatCountdown(30), 'under a minute');
  assert.equal(formatCountdown(Number.NaN), '');
});

// ───────────────────────────── catch-up ─────────────────────────────

test('an unaired next episode means the previous one is the latest available', () => {
  // Relative to now, never to a wall-clock hour: asserting "09:00 has passed"
  // is only true if the test happens to run in the afternoon, which is an
  // environment assumption masquerading as a test.
  const now = Date.now();
  const upcoming = entry('a', Math.floor(now / 1000) + 3600, 5);

  assert.equal(hasAired(upcoming, now), false);
  assert.equal(unwatchedCount(upcoming, 2, now), 2, 'episodes 3 and 4');
});

test('a stale cached record whose time has passed counts as aired', () => {
  // Otherwise the badge never appears for anyone reading a cached schedule.
  const now = Date.now();
  const justAired = entry('a', Math.floor(now / 1000) - 3600, 5);

  assert.equal(hasAired(justAired, now), true);
  assert.equal(unwatchedCount(justAired, 2, now), 3, 'episodes 3, 4 and 5');
});

test('an episode airing exactly now counts as aired', () => {
  const now = Date.now();
  assert.equal(hasAired(entry('a', Math.floor(now / 1000), 5), now), true);
});

test('a fully caught-up viewer is never shown a negative count', () => {
  const now = Date.now();
  const upcoming = entry('a', Math.floor(now / 1000) + 3600, 5);
  assert.equal(unwatchedCount(upcoming, 99, now), 0);
  assert.equal(unwatchedCount(entry('a', Math.floor(now / 1000) + 3600, 1), 0, now), 0);
});
