import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BASE_COOLDOWN_MS,
  HEALTH_TTL_MS,
  MAX_COOLDOWN_MS,
  createHealthBook,
  isCoolingDown,
  orderMirrorIndices,
  pruneHealthBook,
  recordFailure,
  recordSuccess,
  scoreMirror,
} from '../lib/streams/health';

const NOW = 1_700_000_000_000;

test('a fresh book leaves registry priority untouched', () => {
  const book = createHealthBook();
  const mirrors = [
    { id: 'a', priority: 10 },
    { id: 'b', priority: 20 },
    { id: 'c', priority: 30 },
  ];
  assert.deepEqual(orderMirrorIndices(mirrors, book, NOW), [0, 1, 2]);
});

test('a failed mirror is pushed behind healthy ones and cools down', () => {
  const book = createHealthBook();
  recordFailure(book, 'a', NOW);

  assert.equal(isCoolingDown(book, 'a', NOW), true);
  assert.equal(isCoolingDown(book, 'a', NOW + BASE_COOLDOWN_MS + 1), false);

  const mirrors = [
    { id: 'a', priority: 10 },
    { id: 'b', priority: 20 },
  ];
  assert.deepEqual(orderMirrorIndices(mirrors, book, NOW), [1, 0]);
  // Once the cooldown lapses the operator's ranking is restored.
  assert.deepEqual(orderMirrorIndices(mirrors, book, NOW + BASE_COOLDOWN_MS + 1), [0, 1]);
});

test('consecutive failures back off exponentially and stay capped', () => {
  const book = createHealthBook();
  const first = recordFailure(book, 'a', NOW);
  assert.equal(first.cooldownUntil - NOW, BASE_COOLDOWN_MS);

  const second = recordFailure(book, 'a', NOW);
  assert.equal(second.cooldownUntil - NOW, BASE_COOLDOWN_MS * 2);

  for (let attempt = 0; attempt < 30; attempt += 1) recordFailure(book, 'a', NOW);
  assert.equal(book.a.cooldownUntil - NOW, MAX_COOLDOWN_MS);
});

test('a success immediately clears the penalty box', () => {
  const book = createHealthBook();
  recordFailure(book, 'a', NOW);
  recordFailure(book, 'a', NOW);
  assert.equal(isCoolingDown(book, 'a', NOW), true);

  recordSuccess(book, 'a', 40, NOW);
  assert.equal(isCoolingDown(book, 'a', NOW), false);
  assert.equal(book.a.consecutiveFailures, 0);
});

test('latency nudges ordering but never overturns a wide priority gap', () => {
  const book = createHealthBook();
  // `a` is ranked first by the operator but is slow; `b` is fast.
  recordSuccess(book, 'a', 2_000, NOW);
  recordSuccess(book, 'b', 20, NOW);

  const close = [
    { id: 'a', priority: 10 },
    { id: 'b', priority: 11 },
  ];
  assert.deepEqual(orderMirrorIndices(close, book, NOW), [1, 0], 'fast mirror wins a near tie');

  const wide = [
    { id: 'a', priority: 10 },
    { id: 'b', priority: 90 },
  ];
  assert.deepEqual(orderMirrorIndices(wide, book, NOW), [0, 1], 'explicit ranking survives a wide gap');
});

test('the latency EMA smooths a single outlier', () => {
  const book = createHealthBook();
  recordSuccess(book, 'a', 100, NOW);
  recordSuccess(book, 'a', 100, NOW);
  const before = book.a.emaLatencyMs ?? 0;
  recordSuccess(book, 'a', 5_000, NOW);
  const after = book.a.emaLatencyMs ?? 0;
  assert.ok(after > before, 'the outlier moves the average');
  assert.ok(after < 5_000, 'but does not replace it outright');
});

test('a preferred mirror is tried first, but the circuit breaker outranks the preference', () => {
  const book = createHealthBook();
  const mirrors = [
    { id: 'a', priority: 10 },
    { id: 'b', priority: 20 },
    { id: 'c', priority: 30 },
  ];
  assert.deepEqual(orderMirrorIndices(mirrors, book, NOW, 'c'), [2, 0, 1]);

  // A remembered favourite that just failed must not be retried first: a
  // stale preference is exactly how a viewer ends up staring at the one
  // server that is currently down.
  recordFailure(book, 'c', NOW);
  assert.deepEqual(orderMirrorIndices(mirrors, book, NOW, 'c'), [0, 1, 2]);

  // Once it cools down and proves itself again, the preference returns.
  recordSuccess(book, 'c', 30, NOW + BASE_COOLDOWN_MS + 1);
  assert.deepEqual(orderMirrorIndices(mirrors, book, NOW + BASE_COOLDOWN_MS + 2, 'c'), [2, 0, 1]);
});

test('equal scores keep the registry order stable', () => {
  const book = createHealthBook();
  const mirrors = [
    { id: 'a', priority: 10 },
    { id: 'b', priority: 10 },
    { id: 'c', priority: 10 },
  ];
  assert.deepEqual(orderMirrorIndices(mirrors, book, NOW), [0, 1, 2]);
});

test('records age out and stop influencing scores', () => {
  const book = createHealthBook();
  recordFailure(book, 'a', NOW);
  const stale = NOW + HEALTH_TTL_MS + 1;

  assert.equal(isCoolingDown(book, 'a', stale), false);
  assert.equal(scoreMirror({ id: 'a', priority: 10 }, book, stale), 10);

  pruneHealthBook(book, stale);
  assert.equal(Object.keys(book).length, 0);
});

test('a stale record is replaced rather than accumulated', () => {
  const book = createHealthBook();
  recordFailure(book, 'a', NOW);
  assert.equal(book.a.failures, 1);

  recordFailure(book, 'a', NOW + HEALTH_TTL_MS + 1);
  assert.equal(book.a.failures, 1, 'the aged-out record was reset before counting');
  assert.equal(book.a.consecutiveFailures, 1);
});
