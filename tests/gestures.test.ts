import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GESTURE_CONFIG as CFG,
  clampTime,
  formatSeekOffset,
  initialGestureState,
  onLongPress,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  zoneFor,
  type GestureState,
} from '../lib/player/gestures';

const W = 900; // player width
const LEFT = 100;
const MID = 450;
const RIGHT = 800;

/** Down then up at the same point — a clean tap. */
function tap(state: GestureState, x: number, at: number) {
  const down = onPointerDown(state, x, 300, at, W);
  return onPointerUp(down, x, 300, at + 40, W);
}

/* ── zones ─────────────────────────────────────────────────────────── */

test('the player splits into left, middle and right thirds', () => {
  assert.equal(zoneFor(0, W), 'left');
  assert.equal(zoneFor(299, W), 'left');
  assert.equal(zoneFor(450, W), 'middle');
  assert.equal(zoneFor(601, W), 'right');
  assert.equal(zoneFor(900, W), 'right');
});

test('a degenerate width does not throw or misfire', () => {
  // Happens on the first frame, before layout has measured anything.
  assert.equal(zoneFor(100, 0), 'middle');
  assert.equal(zoneFor(Number.NaN, W), 'middle');
});

/* ── taps ──────────────────────────────────────────────────────────── */

test('a single tap only reveals the chrome', () => {
  // Acting on the first tap would make every double-tap seek also toggle
  // playback on the way through.
  const { action } = tap(initialGestureState(), MID, 1000);
  assert.equal(action.type, 'show-controls');
});

test('a double-tap in the middle toggles playback', () => {
  const first = tap(initialGestureState(), MID, 1000);
  const second = tap(first.state, MID, 1150);
  assert.equal(second.action.type, 'toggle-play');
});

test('a double-tap on the right seeks forward, on the left backward', () => {
  const r1 = tap(initialGestureState(), RIGHT, 1000);
  const r2 = tap(r1.state, RIGHT, 1150);
  assert.deepEqual(r2.action, { type: 'seek-by', seconds: 10, zone: 'right', chain: 1 });

  const l1 = tap(initialGestureState(), LEFT, 1000);
  const l2 = tap(l1.state, LEFT, 1150);
  assert.deepEqual(l2.action, { type: 'seek-by', seconds: -10, zone: 'left', chain: 1 });
});

test('chained taps accumulate instead of repeating one step', () => {
  // Tap-tap-tap on the right is 20s total, the behaviour YouTube trained
  // everyone to expect.
  let s = initialGestureState();
  const a = tap(s, RIGHT, 1000); s = a.state;
  const b = tap(s, RIGHT, 1150); s = b.state;
  const c = tap(s, RIGHT, 1300); s = c.state;
  const d = tap(s, RIGHT, 1450);

  assert.equal((b.action as { seconds: number }).seconds, 10);
  assert.equal((c.action as { seconds: number }).seconds, 20);
  assert.equal((d.action as { seconds: number }).seconds, 30);
});

test('a slow second tap starts a new burst rather than chaining', () => {
  const first = tap(initialGestureState(), RIGHT, 1000);
  const second = tap(first.state, RIGHT, 1000 + CFG.doubleTapMs + 50);
  assert.equal(second.action.type, 'show-controls', 'outside the window');
});

test('switching zones breaks the chain', () => {
  // Otherwise a tap left then right reads as "seek forward 10s", which is
  // the opposite of what the second tap asked for.
  const first = tap(initialGestureState(), LEFT, 1000);
  const second = tap(first.state, RIGHT, 1100);
  assert.equal(second.action.type, 'show-controls');
});

test('a tap that moved is not a tap', () => {
  const down = onPointerDown(initialGestureState(), MID, 300, 1000, W);
  const up = onPointerUp(down, MID + 40, 300, 1040, W);
  assert.equal(up.action.type, 'none');
});

/* ── scrubbing ─────────────────────────────────────────────────────── */

test('a horizontal drag scrubs proportionally to screen width', () => {
  const down = onPointerDown(initialGestureState(), MID, 300, 1000, W);
  const move = onPointerMove(down, MID + W / 2, 300, W);
  assert.equal(move.action.type, 'scrub-preview');
  // Half a screen width == half of the 90s full-width sweep.
  assert.equal(Math.round((move.action as { deltaSeconds: number }).deltaSeconds), 45);
});

test('the scrub commits on release', () => {
  const down = onPointerDown(initialGestureState(), MID, 300, 1000, W);
  const moved = onPointerMove(down, MID + 300, 300, W);
  const up = onPointerUp(moved.state, MID + 300, 300, 1400, W);
  assert.equal(up.action.type, 'scrub-commit');
  assert.equal(Math.round((up.action as { deltaSeconds: number }).deltaSeconds), 30);
});

test('dragging far vertically arms and then performs a cancel', () => {
  const down = onPointerDown(initialGestureState(), MID, 300, 1000, W);
  const started = onPointerMove(down, MID + 200, 300, W);

  const armed = onPointerMove(started.state, MID + 200, 300 + CFG.scrubCancelPx + 10, W);
  assert.equal((armed.action as { cancelled: boolean }).cancelled, true, 'UI can warn before release');

  const up = onPointerUp(armed.state, MID + 200, 300 + CFG.scrubCancelPx + 10, 1500, W);
  assert.equal(up.action.type, 'scrub-cancel', 'and nothing is committed');
});

test('the axis locks on first commitment', () => {
  // A scrub that drifts vertically must keep scrubbing, not start yanking
  // the volume around halfway through.
  const down = onPointerDown(initialGestureState(), RIGHT, 300, 1000, W);
  const horizontal = onPointerMove(down, RIGHT + 60, 302, W);
  assert.equal(horizontal.state.mode, 'scrub');

  const drifted = onPointerMove(horizontal.state, RIGHT + 70, 360, W);
  assert.equal(drifted.action.type, 'scrub-preview', 'still scrubbing');
});

/* ── volume ────────────────────────────────────────────────────────── */

test('a vertical drag on the right controls volume, upward increasing', () => {
  const down = onPointerDown(initialGestureState(), RIGHT, 300, 1000, W);
  const move = onPointerMove(down, RIGHT, 200, W);
  assert.equal(move.action.type, 'volume-preview');
  assert.ok((move.action as { delta: number }).delta > 0, 'up means louder');
});

test('a vertical drag on the left does nothing', () => {
  // Brightness has no web API. A gesture that pretends to work is worse
  // than one that is absent.
  const down = onPointerDown(initialGestureState(), LEFT, 300, 1000, W);
  const move = onPointerMove(down, LEFT, 180, W);
  assert.equal(move.action.type, 'none');
  assert.equal(move.state.mode, 'pending');
});

/* ── long press ────────────────────────────────────────────────────── */

test('a long press starts the temporary speed-up and release ends it', () => {
  const down = onPointerDown(initialGestureState(), MID, 300, 1000, W);
  const held = onLongPress(down);
  assert.deepEqual(held.action, { type: 'speed-start', rate: 2 });

  const up = onPointerUp(held.state, MID, 300, 3000, W);
  assert.equal(up.action.type, 'speed-end');
});

test('a long press does not also register as a tap on release', () => {
  const down = onPointerDown(initialGestureState(), MID, 300, 1000, W);
  const held = onLongPress(down);
  const up = onPointerUp(held.state, MID, 300, 3000, W);
  assert.equal(up.action.type, 'speed-end');
  assert.notEqual(up.action.type, 'toggle-play');
});

test('a long press that becomes a drag hands over cleanly', () => {
  const down = onPointerDown(initialGestureState(), MID, 300, 1000, W);
  const held = onLongPress(down);
  const dragged = onPointerMove(held.state, MID + 80, 300, W);
  assert.equal(dragged.action.type, 'speed-end');
  assert.equal(dragged.state.mode, 'pending', 'ready to be re-classified');
});

test('a long press fires only from a settled touch', () => {
  const idle = onLongPress(initialGestureState());
  assert.equal(idle.action.type, 'none');
});

/* ── cancellation ──────────────────────────────────────────────────── */

test('an interrupted touch commits nothing', () => {
  // An incoming call mid-scrub must not jump the playhead.
  const down = onPointerDown(initialGestureState(), MID, 300, 1000, W);
  const scrubbing = onPointerMove(down, MID + 300, 300, W);
  const cancelled = onPointerCancel(scrubbing.state);

  assert.equal(cancelled.action.type, 'scrub-cancel');
  assert.equal(cancelled.state.mode, 'idle');
});

test('an interrupted long press restores the playback rate', () => {
  const down = onPointerDown(initialGestureState(), MID, 300, 1000, W);
  const held = onLongPress(down);
  const cancelled = onPointerCancel(held.state);
  assert.equal(cancelled.action.type, 'speed-end', 'or playback is stuck at 2x');
});

/* ── formatting and clamping ───────────────────────────────────────── */

test('the seek offset always shows a sign and padded seconds', () => {
  assert.equal(formatSeekOffset(0), '+0:00');
  assert.equal(formatSeekOffset(9), '+0:09');
  assert.equal(formatSeekOffset(90), '+1:30');
  assert.equal(formatSeekOffset(-45), '−0:45');
  assert.equal(formatSeekOffset(-3600), '−60:00');
  assert.equal(formatSeekOffset(Number.NaN), '+0:00');
});

test('a scrub cannot run past either end of the media', () => {
  assert.equal(clampTime(-10, 100), 0);
  assert.equal(clampTime(150, 100), 100);
  assert.equal(clampTime(50, 100), 50);
});

test('clamping tolerates an unknown duration', () => {
  // Live streams and the moments before metadata loads.
  assert.equal(clampTime(50, Number.NaN), 50);
  assert.equal(clampTime(50, 0), 50);
  assert.equal(clampTime(-5, 0), 0);
  assert.equal(clampTime(Number.NaN, 100), 0);
});
