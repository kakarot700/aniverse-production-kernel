/**
 * Quality of Experience session model.
 *
 * The streaming industry converged long ago on a small set of metrics that
 * actually predict whether a viewer leaves: how long they waited for the first
 * frame, what fraction of their session was spent staring at a spinner, and
 * whether playback ever started at all. Everything else — CDN uptime, origin
 * latency, cache hit ratio — is a proxy for these.
 *
 * This is a pure state machine: feed it timestamped events, get the standard
 * metrics out. No timers and no clock of its own, so a two-hour session can be
 * replayed and asserted on in a millisecond.
 *
 * Definitions follow the common industry formulations (Conviva/Mux-style):
 *
 *   Video Start Time (a.k.a. join time)
 *       first frame rendered − play intent
 *   Rebuffering Ratio
 *       rebuffer time ÷ (rebuffer time + watch time)
 *   Exit Before Video Start (EBVS)
 *       session ended, no error, first frame never arrived
 *   Video Start Failure (VSF)
 *       session ended on a fatal error, first frame never arrived
 */

export type QoeEventType =
  /** The viewer asked for playback. The clock for start time begins here. */
  | 'play-intent'
  /** First frame rendered. */
  | 'first-frame'
  /** Playback stalled and the viewer is now waiting. */
  | 'rebuffer-start'
  /** Playback resumed after a stall. */
  | 'rebuffer-end'
  /** The viewer paused deliberately; this is not a stall and must not count. */
  | 'pause'
  | 'resume'
  /** A rendition switch, carrying the new bitrate in kbps. */
  | 'bitrate-change'
  /** Playback failed fatally. */
  | 'error'
  /** The session ended, whether by finishing or by the viewer leaving. */
  | 'end';

export interface QoeEvent {
  type: QoeEventType;
  /** Epoch ms. Events are expected in order; out-of-order events are ignored. */
  at: number;
  /** For `bitrate-change`, the new bitrate in kbps. */
  bitrateKbps?: number;
  /** For `error`, whether the failure was recoverable by failing over. */
  recovered?: boolean;
  /** Which mirror/pathway was in use. */
  pathwayId?: string;
}

export interface QoeMetrics {
  /** Null when the first frame never arrived. */
  videoStartTimeMs: number | null;
  /** Wall time with video actually advancing. */
  watchTimeMs: number;
  rebufferTimeMs: number;
  rebufferCount: number;
  /** In [0,1]. Zero when nothing was watched. */
  rebufferRatio: number;
  /** Time-weighted mean bitrate, kbps. Null when no bitrate was reported. */
  averageBitrateKbps: number | null;
  /** Mid-session rendition switches. */
  bitrateChanges: number;
  /** Failures the failover layer absorbed without the viewer losing the session. */
  recoveredErrors: number;
  exitBeforeVideoStart: boolean;
  videoStartFailure: boolean;
  /** 0–100. See `scoreSession`. */
  score: number;
}

/** Above this, viewers begin abandoning in measurable numbers. */
export const TARGET_START_MS = 2_000;

/** A rebuffer ratio above this is considered a bad session outright. */
export const BAD_REBUFFER_RATIO = 0.02;

interface Accumulator {
  playIntentAt: number | null;
  firstFrameAt: number | null;
  playingSince: number | null;
  rebufferingSince: number | null;
  lastBitrateAt: number | null;
  currentBitrate: number | null;
  watchTimeMs: number;
  rebufferTimeMs: number;
  rebufferCount: number;
  bitrateChanges: number;
  bitrateWeightedSum: number;
  bitrateWeightMs: number;
  recoveredErrors: number;
  fatalError: boolean;
  ended: boolean;
  lastAt: number;
}

function closeBitrateWindow(state: Accumulator, at: number): void {
  if (state.currentBitrate !== null && state.lastBitrateAt !== null && at > state.lastBitrateAt) {
    const span = at - state.lastBitrateAt;
    state.bitrateWeightedSum += state.currentBitrate * span;
    state.bitrateWeightMs += span;
  }
  state.lastBitrateAt = at;
}

/**
 * Folds an event stream into metrics.
 *
 * Two subtleties that a naive implementation gets wrong:
 *
 *   - A deliberate pause is not a stall. Counting paused time as rebuffering
 *     makes every session look broken, and counting it as watch time makes the
 *     rebuffer ratio look artificially good. It must be excluded from both.
 *   - Bitrate must be time-weighted. A session that spent two hours at 1080p
 *     and four seconds at 240p did not average the two evenly, and a plain
 *     mean of the reported values says it did.
 */
export function computeQoe(events: readonly QoeEvent[], endedAt?: number): QoeMetrics {
  const state: Accumulator = {
    playIntentAt: null, firstFrameAt: null, playingSince: null, rebufferingSince: null,
    lastBitrateAt: null, currentBitrate: null, watchTimeMs: 0, rebufferTimeMs: 0,
    rebufferCount: 0, bitrateChanges: 0, bitrateWeightedSum: 0, bitrateWeightMs: 0,
    recoveredErrors: 0, fatalError: false, ended: false, lastAt: 0,
  };

  for (const event of events) {
    if (!Number.isFinite(event.at)) continue;
    // Out-of-order events would produce negative durations; drop them rather
    // than let one bad timestamp corrupt the whole session.
    if (event.at < state.lastAt) continue;
    state.lastAt = event.at;

    switch (event.type) {
      case 'play-intent':
        state.playIntentAt ??= event.at;
        break;

      case 'first-frame':
        if (state.firstFrameAt === null) {
          state.firstFrameAt = event.at;
          state.playingSince = event.at;
          state.lastBitrateAt = event.at;
        }
        break;

      case 'rebuffer-start':
        // A stall before the first frame is startup, not rebuffering; it is
        // already captured by video start time and must not be double-counted.
        if (state.firstFrameAt === null) break;
        if (state.rebufferingSince !== null) break;
        if (state.playingSince !== null) {
          state.watchTimeMs += event.at - state.playingSince;
          state.playingSince = null;
        }
        closeBitrateWindow(state, event.at);
        state.rebufferingSince = event.at;
        state.rebufferCount += 1;
        break;

      case 'rebuffer-end':
        if (state.rebufferingSince === null) break;
        state.rebufferTimeMs += event.at - state.rebufferingSince;
        state.rebufferingSince = null;
        state.playingSince = event.at;
        state.lastBitrateAt = event.at;
        break;

      case 'pause':
        if (state.playingSince !== null) {
          state.watchTimeMs += event.at - state.playingSince;
          state.playingSince = null;
        }
        closeBitrateWindow(state, event.at);
        state.lastBitrateAt = null;
        break;

      case 'resume':
        if (state.firstFrameAt !== null && state.playingSince === null && state.rebufferingSince === null) {
          state.playingSince = event.at;
          state.lastBitrateAt = event.at;
        }
        break;

      case 'bitrate-change': {
        const next = event.bitrateKbps;
        if (typeof next !== 'number' || !Number.isFinite(next) || next <= 0) break;
        if (state.playingSince !== null) closeBitrateWindow(state, event.at);
        if (state.currentBitrate !== null && state.currentBitrate !== next) state.bitrateChanges += 1;
        state.currentBitrate = next;
        if (state.lastBitrateAt === null && state.playingSince !== null) state.lastBitrateAt = event.at;
        break;
      }

      case 'error':
        if (event.recovered) state.recoveredErrors += 1;
        else state.fatalError = true;
        break;

      case 'end':
        state.ended = true;
        break;

      default:
        break;
    }
  }

  const finalAt = endedAt ?? state.lastAt;
  if (finalAt >= state.lastAt) {
    if (state.playingSince !== null) {
      state.watchTimeMs += finalAt - state.playingSince;
      closeBitrateWindow(state, finalAt);
    }
    if (state.rebufferingSince !== null) state.rebufferTimeMs += finalAt - state.rebufferingSince;
  }

  const videoStartTimeMs =
    state.playIntentAt !== null && state.firstFrameAt !== null
      ? Math.max(0, state.firstFrameAt - state.playIntentAt)
      : null;

  const denominator = state.watchTimeMs + state.rebufferTimeMs;
  const rebufferRatio = denominator > 0 ? state.rebufferTimeMs / denominator : 0;

  const startedPlaying = state.firstFrameAt !== null;
  const metrics: Omit<QoeMetrics, 'score'> = {
    videoStartTimeMs,
    watchTimeMs: state.watchTimeMs,
    rebufferTimeMs: state.rebufferTimeMs,
    rebufferCount: state.rebufferCount,
    rebufferRatio,
    averageBitrateKbps:
      state.bitrateWeightMs > 0 ? Math.round(state.bitrateWeightedSum / state.bitrateWeightMs) : null,
    bitrateChanges: state.bitrateChanges,
    recoveredErrors: state.recoveredErrors,
    videoStartFailure: !startedPlaying && state.fatalError,
    exitBeforeVideoStart: !startedPlaying && !state.fatalError && (state.ended || endedAt !== undefined),
  };

  return { ...metrics, score: scoreSession(metrics) };
}

/**
 * Collapses a session to 0–100.
 *
 * Weighted the way the metrics actually correlate with abandonment: never
 * starting is total failure, rebuffering hurts hardest, a slow start hurts
 * next, and bitrate churn is a minor irritation. A recovered error costs
 * almost nothing on purpose — the failover layer doing its job is a success,
 * not a defect, and penalising it would push the system toward hiding
 * failovers instead of performing them.
 */
export function scoreSession(metrics: Omit<QoeMetrics, 'score'>): number {
  if (metrics.videoStartFailure) return 0;
  if (metrics.exitBeforeVideoStart) return 0;

  let score = 100;

  if (metrics.videoStartTimeMs !== null && metrics.videoStartTimeMs > TARGET_START_MS) {
    // 10 points per second late, capped at 30.
    score -= Math.min(30, ((metrics.videoStartTimeMs - TARGET_START_MS) / 1000) * 10);
  }

  // The steepest term: 2% rebuffering already costs 20 points.
  score -= Math.min(50, metrics.rebufferRatio * 1000);

  // Each stall is an event the viewer noticed, independent of its length.
  score -= Math.min(15, metrics.rebufferCount * 3);

  score -= Math.min(5, metrics.bitrateChanges * 0.5);
  score -= Math.min(5, metrics.recoveredErrors * 1);

  return Math.max(0, Math.round(score));
}

/** Human-readable verdict, for the stats overlay and the server dashboard. */
export function describeQoe(metrics: QoeMetrics): string {
  if (metrics.videoStartFailure) return 'Failed to start';
  if (metrics.exitBeforeVideoStart) return 'Abandoned before start';
  if (metrics.score >= 90) return 'Excellent';
  if (metrics.score >= 75) return 'Good';
  if (metrics.score >= 50) return 'Fair';
  return 'Poor';
}

/**
 * Rolling per-pathway distress, for the steering server.
 *
 * Kept as a bounded ring of recent session scores per pathway so one
 * catastrophic session cannot permanently condemn a CDN, and a CDN that
 * recovered is not held to a grudge.
 */
export class PathwayQoeBook {
  private readonly samples = new Map<string, number[]>();

  constructor(private readonly windowSize = 20) {}

  record(pathwayId: string, score: number): void {
    const list = this.samples.get(pathwayId) ?? [];
    list.push(Math.max(0, Math.min(100, score)));
    if (list.length > this.windowSize) list.shift();
    this.samples.set(pathwayId, list);
  }

  /** Mean distress in [0,1]; 0 when the pathway has no samples. */
  distress(pathwayId: string): number {
    const list = this.samples.get(pathwayId);
    if (!list || list.length === 0) return 0;
    const mean = list.reduce((total, value) => total + value, 0) / list.length;
    return Math.max(0, Math.min(1, (100 - mean) / 100));
  }

  /** Distress for every known pathway, shaped for `rankPathways`. */
  snapshot(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const pathwayId of this.samples.keys()) result[pathwayId] = this.distress(pathwayId);
    return result;
  }

  sampleCount(pathwayId: string): number {
    return this.samples.get(pathwayId)?.length ?? 0;
  }
}
