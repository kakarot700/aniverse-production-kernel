/**
 * Mirror health memory and attempt ordering.
 *
 * The registry gives every mirror a static `priority`. That is the operator's
 * *intent*, but it says nothing about what is actually working right now. This
 * module keeps a short-lived, per-session memory of how each mirror behaved
 * and reorders the attempt list accordingly, so a server that just failed is
 * not the first thing tried on the next episode, and a server that answers in
 * 40 ms outranks one that answers in 900 ms.
 *
 * Pure and isomorphic on purpose: no DOM, no timers, no fetch. The worker owns
 * the racing; this module owns the decisions, so the decisions are unit
 * testable.
 */

export interface MirrorHealthRecord {
  id: string;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  /** Exponential moving average of successful probe latency, in ms. */
  emaLatencyMs: number | null;
  /** Epoch ms before which this mirror should not be tried first again. */
  cooldownUntil: number;
  lastOutcomeAt: number;
}

export type MirrorHealthBook = Record<string, MirrorHealthRecord>;

/** Smoothing factor for the latency EMA: recent probes dominate, history damps noise. */
const EMA_ALPHA = 0.4;

/** First cooldown after a failure; doubles per consecutive failure. */
export const BASE_COOLDOWN_MS = 20_000;

/** Ceiling so a mirror that recovers is never exiled for a whole session. */
export const MAX_COOLDOWN_MS = 5 * 60_000;

/** A record older than this is stale and treated as unknown. */
export const HEALTH_TTL_MS = 30 * 60_000;

/** Score penalty applied to a mirror still inside its cooldown window. */
const COOLDOWN_PENALTY = 1_000_000;

/** Score bonus for the mirror the viewer (or their last session) settled on. */
const PREFERRED_BONUS = 500_000;

export function createHealthBook(): MirrorHealthBook {
  return {};
}

function recordFor(book: MirrorHealthBook, id: string, now: number): MirrorHealthRecord {
  const existing = book[id];
  if (existing && now - existing.lastOutcomeAt <= HEALTH_TTL_MS) return existing;
  const fresh: MirrorHealthRecord = {
    id,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    emaLatencyMs: null,
    cooldownUntil: 0,
    lastOutcomeAt: now,
  };
  book[id] = fresh;
  return fresh;
}

export function recordSuccess(
  book: MirrorHealthBook,
  id: string,
  latencyMs: number,
  now: number = Date.now(),
): MirrorHealthRecord {
  const record = recordFor(book, id, now);
  const sane = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0;
  record.successes += 1;
  record.consecutiveFailures = 0;
  // A success clears the penalty box immediately; the mirror just proved itself.
  record.cooldownUntil = 0;
  record.emaLatencyMs =
    record.emaLatencyMs === null ? sane : record.emaLatencyMs * (1 - EMA_ALPHA) + sane * EMA_ALPHA;
  record.lastOutcomeAt = now;
  return record;
}

export function recordFailure(
  book: MirrorHealthBook,
  id: string,
  now: number = Date.now(),
): MirrorHealthRecord {
  const record = recordFor(book, id, now);
  record.failures += 1;
  record.consecutiveFailures += 1;
  // Exponential backoff, capped. Shift is bounded before use so a long-lived
  // session cannot overflow into a negative or absurd cooldown.
  const exponent = Math.min(record.consecutiveFailures - 1, 8);
  const cooldown = Math.min(BASE_COOLDOWN_MS * 2 ** exponent, MAX_COOLDOWN_MS);
  record.cooldownUntil = now + cooldown;
  record.lastOutcomeAt = now;
  return record;
}

export function isCoolingDown(book: MirrorHealthBook, id: string, now: number = Date.now()): boolean {
  const record = book[id];
  if (!record) return false;
  if (now - record.lastOutcomeAt > HEALTH_TTL_MS) return false;
  return record.cooldownUntil > now;
}

export interface ScorableMirror {
  id: string;
  priority: number;
}

/**
 * Lower is better. Operator priority is the backbone; health only nudges
 * within that ordering, except for a cooling-down mirror which is pushed
 * decisively to the back, and a preferred mirror which is pulled decisively
 * to the front.
 */
export function scoreMirror(
  mirror: ScorableMirror,
  book: MirrorHealthBook,
  now: number = Date.now(),
  preferredId?: string | null,
): number {
  let score = mirror.priority;

  if (preferredId && mirror.id === preferredId) score -= PREFERRED_BONUS;
  if (isCoolingDown(book, mirror.id, now)) score += COOLDOWN_PENALTY;

  const record = book[mirror.id];
  if (record && now - record.lastOutcomeAt <= HEALTH_TTL_MS && record.emaLatencyMs !== null) {
    // A fast, proven mirror can climb at most ~5 priority points, so an
    // operator's explicit ranking is never overturned by latency alone.
    const latencyPenalty = Math.min(5, record.emaLatencyMs / 200);
    score += latencyPenalty - 5;
  }

  return score;
}

/**
 * Returns attempt order as indices into `mirrors`, best first. Stable: equal
 * scores preserve the registry's original ordering.
 */
export function orderMirrorIndices(
  mirrors: readonly ScorableMirror[],
  book: MirrorHealthBook,
  now: number = Date.now(),
  preferredId?: string | null,
): number[] {
  return mirrors
    .map((mirror, index) => ({ index, score: scoreMirror(mirror, book, now, preferredId) }))
    .sort((left, right) => (left.score === right.score ? left.index - right.index : left.score - right.score))
    .map((entry) => entry.index);
}

/** Drops records that have aged out, so the book cannot grow without bound. */
export function pruneHealthBook(book: MirrorHealthBook, now: number = Date.now()): MirrorHealthBook {
  for (const [id, record] of Object.entries(book)) {
    if (now - record.lastOutcomeAt > HEALTH_TTL_MS) delete book[id];
  }
  return book;
}
