/**
 * Touch gesture recognition for the player.
 *
 * Pure state machine, no DOM. The component feeds it pointer coordinates and
 * timestamps and gets back an intent; that keeps every tricky rule here —
 * where the thirds fall, what counts as a tap versus a drag, how a
 * double-tap chains — testable without a browser.
 *
 * The vocabulary is the one every mobile video player has converged on, so
 * it needs no teaching:
 *
 *   double-tap left third   seek back
 *   double-tap middle       play / pause
 *   double-tap right third  seek forward
 *   horizontal drag         scrub, committed on release
 *   vertical drag (right)   volume
 *   long press              temporary speed-up until release
 *
 * Deliberately omitted: brightness on the left vertical drag. The web has no
 * brightness API, and faking it with a black overlay makes the picture worse
 * rather than the screen brighter. A gesture that lies is worse than no
 * gesture.
 */

export type Zone = 'left' | 'middle' | 'right';

export interface GestureConfig {
  /** Movement beyond this (px) means a drag, not a tap. */
  dragThresholdPx: number;
  /** Two taps within this many ms chain into a double-tap. */
  doubleTapMs: number;
  /** Holding still this long starts the speed-up. */
  longPressMs: number;
  /** Seconds per full screen width of horizontal drag. */
  scrubSecondsPerWidth: number;
  /** Dragging this far vertically during a scrub cancels it. */
  scrubCancelPx: number;
  /** Seconds a double-tap seek moves. */
  seekStepSeconds: number;
  /** Playback rate while long-pressing. */
  speedUpRate: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  dragThresholdPx: 10,
  doubleTapMs: 300,
  longPressMs: 500,
  scrubSecondsPerWidth: 90,
  scrubCancelPx: 144,
  seekStepSeconds: 10,
  speedUpRate: 2,
};

export type GestureAction =
  | { type: 'none' }
  | { type: 'toggle-play' }
  | { type: 'seek-by'; seconds: number; zone: Zone; chain: number }
  | { type: 'scrub-preview'; deltaSeconds: number; cancelled: boolean }
  | { type: 'scrub-commit'; deltaSeconds: number }
  | { type: 'scrub-cancel' }
  | { type: 'volume-preview'; delta: number }
  | { type: 'volume-commit' }
  | { type: 'speed-start'; rate: number }
  | { type: 'speed-end' }
  | { type: 'show-controls' };

type Mode = 'idle' | 'pending' | 'scrub' | 'volume' | 'speed';

export interface GestureState {
  mode: Mode;
  startX: number;
  startY: number;
  startAt: number;
  zone: Zone;
  /** Timestamp of the last completed tap, for double-tap chaining. */
  lastTapAt: number;
  lastTapZone: Zone | null;
  /** How many taps have chained in the current burst. */
  chain: number;
  /** Whether a long press already fired for this touch. */
  speedActive: boolean;
}

export function initialGestureState(): GestureState {
  return {
    mode: 'idle',
    startX: 0,
    startY: 0,
    startAt: 0,
    zone: 'middle',
    lastTapAt: 0,
    lastTapZone: null,
    chain: 0,
    speedActive: false,
  };
}

/**
 * Which third of the player a touch landed in.
 *
 * The middle zone is deliberately the full third rather than a narrow strip:
 * play/pause is the most common intent and the one people aim at least
 * carefully, so it gets the most forgiving target.
 */
export function zoneFor(x: number, width: number): Zone {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return 'middle';
  const ratio = x / width;
  if (ratio < 1 / 3) return 'left';
  if (ratio > 2 / 3) return 'right';
  return 'middle';
}

export function onPointerDown(
  state: GestureState,
  x: number,
  y: number,
  at: number,
  width: number,
): GestureState {
  return {
    ...state,
    mode: 'pending',
    startX: x,
    startY: y,
    startAt: at,
    zone: zoneFor(x, width),
    speedActive: false,
  };
}

export interface MoveResult {
  state: GestureState;
  action: GestureAction;
}

export function onPointerMove(
  state: GestureState,
  x: number,
  y: number,
  width: number,
  config: GestureConfig = DEFAULT_GESTURE_CONFIG,
): MoveResult {
  if (state.mode === 'idle') return { state, action: { type: 'none' } };

  const dx = x - state.startX;
  const dy = y - state.startY;

  // A long press that turns into a drag was a drag all along.
  if (state.mode === 'speed') {
    if (Math.abs(dx) < config.dragThresholdPx && Math.abs(dy) < config.dragThresholdPx) {
      return { state, action: { type: 'none' } };
    }
    return { state: { ...state, mode: 'pending', speedActive: false }, action: { type: 'speed-end' } };
  }

  if (state.mode === 'pending') {
    if (Math.abs(dx) < config.dragThresholdPx && Math.abs(dy) < config.dragThresholdPx) {
      return { state, action: { type: 'none' } };
    }
    // Axis lock on first commitment. Without it, a scrub that drifts
    // vertically starts yanking the volume around mid-gesture.
    if (Math.abs(dx) > Math.abs(dy)) {
      return {
        state: { ...state, mode: 'scrub' },
        action: { type: 'scrub-preview', deltaSeconds: scrubDelta(dx, width, config), cancelled: false },
      };
    }
    // Vertical drags only control volume on the right. On the left there is
    // nothing to control, so the touch stays pending and does nothing.
    if (state.zone === 'right') {
      return { state: { ...state, mode: 'volume' }, action: { type: 'volume-preview', delta: -dy / 200 } };
    }
    return { state, action: { type: 'none' } };
  }

  if (state.mode === 'scrub') {
    // A far-enough vertical drag arms the cancel, the same escape hatch
    // file managers and video apps use for drag-to-reorder.
    const cancelled = Math.abs(dy) > config.scrubCancelPx;
    return {
      state,
      action: { type: 'scrub-preview', deltaSeconds: scrubDelta(dx, width, config), cancelled },
    };
  }

  // volume
  return { state, action: { type: 'volume-preview', delta: -dy / 200 } };
}

export function onPointerUp(
  state: GestureState,
  x: number,
  y: number,
  at: number,
  width: number,
  config: GestureConfig = DEFAULT_GESTURE_CONFIG,
): MoveResult {
  const dx = x - state.startX;
  const dy = y - state.startY;
  const reset: GestureState = { ...state, mode: 'idle', speedActive: false };

  if (state.mode === 'speed') {
    return { state: reset, action: { type: 'speed-end' } };
  }

  if (state.mode === 'scrub') {
    if (Math.abs(dy) > config.scrubCancelPx) {
      return { state: reset, action: { type: 'scrub-cancel' } };
    }
    return { state: reset, action: { type: 'scrub-commit', deltaSeconds: scrubDelta(dx, width, config) } };
  }

  if (state.mode === 'volume') {
    return { state: reset, action: { type: 'volume-commit' } };
  }

  // A tap: small movement, and short enough not to have been a hold.
  const moved = Math.abs(dx) >= config.dragThresholdPx || Math.abs(dy) >= config.dragThresholdPx;
  if (moved) return { state: reset, action: { type: 'none' } };

  const sameZone = state.lastTapZone === state.zone;
  const withinWindow = at - state.lastTapAt <= config.doubleTapMs;
  const isChained = sameZone && withinWindow && state.chain > 0;
  const chain = isChained ? state.chain + 1 : 1;

  const next: GestureState = {
    ...reset,
    lastTapAt: at,
    lastTapZone: state.zone,
    chain,
  };

  // A single tap only reveals the chrome. Acting on the first tap of a
  // double-tap would make every seek also toggle playback.
  if (chain < 2) {
    return { state: next, action: { type: 'show-controls' } };
  }

  if (state.zone === 'middle') {
    return { state: next, action: { type: 'toggle-play' } };
  }

  // Chained taps accumulate: tap-tap-tap on the right is 20s, not 10s
  // repeated. Matching how YouTube and MX Player behave.
  const direction = state.zone === 'right' ? 1 : -1;
  return {
    state: next,
    action: {
      type: 'seek-by',
      seconds: direction * config.seekStepSeconds * (chain - 1),
      zone: state.zone,
      chain: chain - 1,
    },
  };
}

/** Called by the component's long-press timer. */
export function onLongPress(
  state: GestureState,
  config: GestureConfig = DEFAULT_GESTURE_CONFIG,
): MoveResult {
  if (state.mode !== 'pending') return { state, action: { type: 'none' } };
  return {
    state: { ...state, mode: 'speed', speedActive: true },
    action: { type: 'speed-start', rate: config.speedUpRate },
  };
}

/** A cancelled touch (call, notification) must never commit anything. */
export function onPointerCancel(state: GestureState): MoveResult {
  const reset: GestureState = { ...initialGestureState(), lastTapAt: state.lastTapAt, lastTapZone: state.lastTapZone, chain: state.chain };
  if (state.mode === 'speed') return { state: reset, action: { type: 'speed-end' } };
  if (state.mode === 'scrub') return { state: reset, action: { type: 'scrub-cancel' } };
  return { state: reset, action: { type: 'none' } };
}

function scrubDelta(dx: number, width: number, config: GestureConfig): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return (dx / width) * config.scrubSecondsPerWidth;
}

/** "+1:30" / "−0:45" — the offset a scrub is about to apply. */
export function formatSeekOffset(seconds: number): string {
  if (!Number.isFinite(seconds)) return '+0:00';
  const sign = seconds < 0 ? '−' : '+';
  const total = Math.round(Math.abs(seconds));
  const minutes = Math.floor(total / 60);
  return `${sign}${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** Clamps a target time to the media, so a scrub cannot overrun the end. */
export function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, time);
  return Math.min(Math.max(0, time), duration);
}
