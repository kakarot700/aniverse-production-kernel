import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BAD_REBUFFER_RATIO,
  PathwayQoeBook,
  TARGET_START_MS,
  computeQoe,
  describeQoe,
  scoreSession,
  type QoeEvent,
} from '../lib/streams/qoe';

const T = 1_700_000_000_000;

function at(offsetMs: number, type: QoeEvent['type'], extra: Partial<QoeEvent> = {}): QoeEvent {
  return { type, at: T + offsetMs, ...extra };
}

test('a clean session scores perfectly', () => {
  const metrics = computeQoe([
    at(0, 'play-intent'),
    at(800, 'first-frame'),
    at(800, 'bitrate-change', { bitrateKbps: 3000 }),
    at(600_800, 'end'),
  ], T + 600_800);

  assert.equal(metrics.videoStartTimeMs, 800);
  assert.equal(metrics.watchTimeMs, 600_000);
  assert.equal(metrics.rebufferTimeMs, 0);
  assert.equal(metrics.rebufferRatio, 0);
  assert.equal(metrics.score, 100);
  assert.equal(describeQoe(metrics), 'Excellent');
});

test('video start time is measured from play intent to first frame', () => {
  const metrics = computeQoe([at(0, 'play-intent'), at(3_500, 'first-frame'), at(10_000, 'end')], T + 10_000);
  assert.equal(metrics.videoStartTimeMs, 3_500);
  // 1.5s over target at 10 points per second.
  assert.equal(metrics.score, 85);
});

test('rebuffer ratio uses rebuffer time over rebuffer plus watch time', () => {
  const metrics = computeQoe([
    at(0, 'play-intent'),
    at(0, 'first-frame'),
    at(90_000, 'rebuffer-start'),
    at(100_000, 'rebuffer-end'),
    at(190_000, 'end'),
  ], T + 190_000);

  assert.equal(metrics.watchTimeMs, 180_000);
  assert.equal(metrics.rebufferTimeMs, 10_000);
  assert.equal(metrics.rebufferCount, 1);
  assert.ok(Math.abs(metrics.rebufferRatio - 10_000 / 190_000) < 1e-9);
});

test('a deliberate pause counts as neither watch time nor rebuffering', () => {
  // Counting paused time as rebuffering makes every session look broken;
  // counting it as watch time makes the ratio look artificially good.
  const metrics = computeQoe([
    at(0, 'play-intent'),
    at(0, 'first-frame'),
    at(10_000, 'pause'),
    at(600_000, 'resume'),
    at(610_000, 'end'),
  ], T + 610_000);

  assert.equal(metrics.watchTimeMs, 20_000);
  assert.equal(metrics.rebufferTimeMs, 0);
  assert.equal(metrics.rebufferCount, 0);
  assert.equal(metrics.rebufferRatio, 0);
});

test('a stall before the first frame is startup, not rebuffering', () => {
  // Otherwise the same delay is charged twice: once to start time and once to
  // the rebuffer ratio.
  const metrics = computeQoe([
    at(0, 'play-intent'),
    at(500, 'rebuffer-start'),
    at(2_000, 'rebuffer-end'),
    at(2_000, 'first-frame'),
    at(62_000, 'end'),
  ], T + 62_000);

  assert.equal(metrics.rebufferCount, 0);
  assert.equal(metrics.rebufferTimeMs, 0);
  assert.equal(metrics.videoStartTimeMs, 2_000);
});

test('bitrate is time-weighted, not a plain mean of the reported values', () => {
  // Two hours at 3000 and four seconds at 300 is not an average of 1650.
  const metrics = computeQoe([
    at(0, 'play-intent'),
    at(0, 'first-frame'),
    at(0, 'bitrate-change', { bitrateKbps: 3000 }),
    at(100_000, 'bitrate-change', { bitrateKbps: 300 }),
    at(104_000, 'end'),
  ], T + 104_000);

  assert.equal(metrics.bitrateChanges, 1);
  const expected = (3000 * 100_000 + 300 * 4_000) / 104_000;
  assert.ok(Math.abs((metrics.averageBitrateKbps ?? 0) - expected) < 2);
  assert.ok((metrics.averageBitrateKbps ?? 0) > 2800, 'dominated by the long high-bitrate stretch');
});

test('an unchanged bitrate report is not counted as a switch', () => {
  const metrics = computeQoe([
    at(0, 'play-intent'), at(0, 'first-frame'),
    at(0, 'bitrate-change', { bitrateKbps: 3000 }),
    at(10_000, 'bitrate-change', { bitrateKbps: 3000 }),
    at(20_000, 'end'),
  ], T + 20_000);
  assert.equal(metrics.bitrateChanges, 0);
});

test('an invalid bitrate is ignored', () => {
  const metrics = computeQoe([
    at(0, 'play-intent'), at(0, 'first-frame'),
    at(0, 'bitrate-change', { bitrateKbps: 0 }),
    at(1_000, 'bitrate-change', { bitrateKbps: Number.NaN }),
    at(2_000, 'end'),
  ], T + 2_000);
  assert.equal(metrics.averageBitrateKbps, null);
  assert.equal(metrics.bitrateChanges, 0);
});

test('a fatal error before the first frame is a video start failure and scores zero', () => {
  const metrics = computeQoe([at(0, 'play-intent'), at(5_000, 'error'), at(5_000, 'end')], T + 5_000);
  assert.equal(metrics.videoStartFailure, true);
  assert.equal(metrics.exitBeforeVideoStart, false);
  assert.equal(metrics.score, 0);
  assert.equal(describeQoe(metrics), 'Failed to start');
});

test('leaving before the first frame with no error is exit-before-video-start', () => {
  const metrics = computeQoe([at(0, 'play-intent'), at(8_000, 'end')], T + 8_000);
  assert.equal(metrics.exitBeforeVideoStart, true);
  assert.equal(metrics.videoStartFailure, false);
  assert.equal(metrics.score, 0);
  assert.equal(describeQoe(metrics), 'Abandoned before start');
});

test('a recovered error barely costs anything', () => {
  // The failover layer doing its job is a success. Penalising it would push
  // the system toward hiding failovers rather than performing them.
  const clean = computeQoe([at(0, 'play-intent'), at(500, 'first-frame'), at(60_000, 'end')], T + 60_000);
  const recovered = computeQoe([
    at(0, 'play-intent'), at(500, 'first-frame'),
    at(10_000, 'error', { recovered: true }),
    at(60_000, 'end'),
  ], T + 60_000);

  assert.equal(recovered.recoveredErrors, 1);
  assert.equal(recovered.videoStartFailure, false);
  assert.equal(clean.score - recovered.score, 1);
});

test('rebuffering dominates the score', () => {
  const metrics = computeQoe([
    at(0, 'play-intent'), at(0, 'first-frame'),
    at(10_000, 'rebuffer-start'), at(20_000, 'rebuffer-end'),
    at(30_000, 'end'),
  ], T + 30_000);

  assert.ok(metrics.rebufferRatio > BAD_REBUFFER_RATIO);
  assert.ok(metrics.score < 50, `expected a poor score, got ${metrics.score}`);
  assert.equal(describeQoe(metrics), 'Poor');
});

test('an unterminated session is closed off at the supplied end time', () => {
  const metrics = computeQoe([at(0, 'play-intent'), at(0, 'first-frame')], T + 45_000);
  assert.equal(metrics.watchTimeMs, 45_000);
});

test('an unterminated rebuffer is charged up to the end time', () => {
  const metrics = computeQoe([
    at(0, 'play-intent'), at(0, 'first-frame'), at(10_000, 'rebuffer-start'),
  ], T + 30_000);
  assert.equal(metrics.rebufferTimeMs, 20_000);
  assert.equal(metrics.watchTimeMs, 10_000);
});

test('out-of-order events are dropped instead of producing negative durations', () => {
  const metrics = computeQoe([
    at(0, 'play-intent'), at(10_000, 'first-frame'), at(5_000, 'rebuffer-start'), at(20_000, 'end'),
  ], T + 20_000);
  assert.ok(metrics.watchTimeMs >= 0);
  assert.ok(metrics.rebufferTimeMs >= 0);
  assert.equal(metrics.rebufferCount, 0);
});

test('an empty event stream is handled without throwing', () => {
  const metrics = computeQoe([]);
  assert.equal(metrics.videoStartTimeMs, null);
  assert.equal(metrics.watchTimeMs, 0);
  assert.equal(metrics.rebufferRatio, 0);
});

test('a duplicated rebuffer-start does not double count', () => {
  const metrics = computeQoe([
    at(0, 'play-intent'), at(0, 'first-frame'),
    at(10_000, 'rebuffer-start'), at(11_000, 'rebuffer-start'),
    at(15_000, 'rebuffer-end'), at(20_000, 'end'),
  ], T + 20_000);
  assert.equal(metrics.rebufferCount, 1);
  assert.equal(metrics.rebufferTimeMs, 5_000);
});

test('a rebuffer-end with no matching start is ignored', () => {
  const metrics = computeQoe([
    at(0, 'play-intent'), at(0, 'first-frame'), at(5_000, 'rebuffer-end'), at(10_000, 'end'),
  ], T + 10_000);
  assert.equal(metrics.rebufferTimeMs, 0);
  assert.equal(metrics.rebufferCount, 0);
});

test('the score stays within bounds under compounded punishment', () => {
  const score = scoreSession({
    videoStartTimeMs: 60_000, watchTimeMs: 1_000, rebufferTimeMs: 100_000, rebufferCount: 50,
    rebufferRatio: 0.99, averageBitrateKbps: 100, bitrateChanges: 100, recoveredErrors: 50,
    exitBeforeVideoStart: false, videoStartFailure: false,
  });
  assert.ok(score >= 0 && score <= 100);
  assert.equal(score, 0);
});

test('a fast start under the target is not penalised', () => {
  const score = scoreSession({
    videoStartTimeMs: TARGET_START_MS - 1, watchTimeMs: 60_000, rebufferTimeMs: 0, rebufferCount: 0,
    rebufferRatio: 0, averageBitrateKbps: 3000, bitrateChanges: 0, recoveredErrors: 0,
    exitBeforeVideoStart: false, videoStartFailure: false,
  });
  assert.equal(score, 100);
});

// ───────────────────────── per-pathway rolling book ─────────────────────────

test('an unknown pathway reports no distress', () => {
  assert.equal(new PathwayQoeBook().distress('nope'), 0);
});

test('distress is the inverse of the mean session score', () => {
  const book = new PathwayQoeBook();
  book.record('cdn-a', 100);
  book.record('cdn-a', 0);
  assert.ok(Math.abs(book.distress('cdn-a') - 0.5) < 1e-9);
});

test('the sample window is bounded so an old catastrophe is forgiven', () => {
  const book = new PathwayQoeBook(3);
  book.record('cdn-a', 0);
  book.record('cdn-a', 100);
  book.record('cdn-a', 100);
  book.record('cdn-a', 100);

  assert.equal(book.sampleCount('cdn-a'), 3);
  assert.equal(book.distress('cdn-a'), 0, 'the zero has aged out of the window');
});

test('scores are clamped so a bad caller cannot poison the book', () => {
  const book = new PathwayQoeBook();
  book.record('cdn-a', 999);
  book.record('cdn-b', -999);
  assert.equal(book.distress('cdn-a'), 0);
  assert.equal(book.distress('cdn-b'), 1);
});

test('a snapshot is shaped for the steering ranker', () => {
  const book = new PathwayQoeBook();
  book.record('cdn-a', 100);
  book.record('cdn-b', 20);
  const snapshot = book.snapshot();
  assert.deepEqual(Object.keys(snapshot).sort(), ['cdn-a', 'cdn-b']);
  assert.ok(snapshot['cdn-b'] > snapshot['cdn-a']);
});
