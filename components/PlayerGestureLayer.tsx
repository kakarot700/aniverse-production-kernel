'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_GESTURE_CONFIG,
  clampTime,
  formatSeekOffset,
  initialGestureState,
  onLongPress,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  type GestureConfig,
  type GestureState,
} from '@/lib/player/gestures';

interface PlayerGestureLayerProps {
  video: HTMLVideoElement | null;
  enabled: boolean;
  seekStepSeconds: number;
}

interface Feedback {
  text: string;
  detail?: string;
  /** Held feedback stays until dismissed; one-shots fade. */
  sticky: boolean;
  bar?: number;
}

/**
 * Touch gesture surface for the player.
 *
 * Two constraints shape this component.
 *
 * It is touch-only. `pointerType` is checked on every event and anything
 * from a mouse or pen falls straight through, because a cursor already has
 * precise controls and hijacking a click-drag would break them. Keyboard
 * handling is untouched.
 *
 * It stops short of the bottom edge. The native control bar lives there, and
 * an overlay across the full video would eat every attempt to grab the
 * scrubber — the single worst thing a gesture layer can do.
 */
export function PlayerGestureLayer({ video, enabled, seekStepSeconds }: PlayerGestureLayerProps) {
  const stateRef = useRef<GestureState>(initialGestureState());
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateBeforeHold = useRef(1);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const config: GestureConfig = { ...DEFAULT_GESTURE_CONFIG, seekStepSeconds };

  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  if (!enabled || !video) return null;

  const flash = (next: Feedback | null) => {
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
    setFeedback(next);
    if (next && !next.sticky) {
      feedbackTimer.current = setTimeout(() => setFeedback(null), 700);
    }
  };

  const width = () => surfaceRef.current?.clientWidth ?? 1;

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    const rect = event.currentTarget.getBoundingClientRect();
    stateRef.current = onPointerDown(
      stateRef.current,
      event.clientX - rect.left,
      event.clientY - rect.top,
      event.timeStamp,
      rect.width,
    );

    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      const { state, action } = onLongPress(stateRef.current, config);
      stateRef.current = state;
      if (action.type === 'speed-start') {
        rateBeforeHold.current = video.playbackRate;
        video.playbackRate = action.rate;
        flash({ text: `${action.rate}× speed`, sticky: true });
      }
    }, config.longPressMs);
  };

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || stateRef.current.mode === 'idle') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const { state, action } = onPointerMove(
      stateRef.current,
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      config,
    );
    stateRef.current = state;

    if (action.type !== 'none') clearLongPress();

    switch (action.type) {
      case 'scrub-preview': {
        const target = clampTime(video.currentTime + action.deltaSeconds, video.duration);
        flash({
          text: action.cancelled ? 'Release to cancel' : formatSeekOffset(action.deltaSeconds),
          detail: action.cancelled ? undefined : formatClock(target),
          sticky: true,
        });
        break;
      }
      case 'volume-preview': {
        const next = Math.min(1, Math.max(0, video.volume + action.delta));
        video.volume = next;
        if (next > 0) video.muted = false;
        flash({ text: `Volume ${Math.round(next * 100)}%`, sticky: true, bar: next });
        break;
      }
      case 'speed-end': {
        video.playbackRate = rateBeforeHold.current;
        flash(null);
        break;
      }
      default:
        break;
    }
  };

  const handleUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    clearLongPress();

    const rect = event.currentTarget.getBoundingClientRect();
    const { state, action } = onPointerUp(
      stateRef.current,
      event.clientX - rect.left,
      event.clientY - rect.top,
      event.timeStamp,
      rect.width,
      config,
    );
    stateRef.current = state;

    switch (action.type) {
      case 'toggle-play':
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
        flash({ text: video.paused ? 'Paused' : 'Playing', sticky: false });
        break;
      case 'seek-by':
        video.currentTime = clampTime(video.currentTime + action.seconds, video.duration);
        flash({ text: `${action.seconds > 0 ? '+' : '−'}${Math.abs(action.seconds)}s`, sticky: false });
        break;
      case 'scrub-commit':
        video.currentTime = clampTime(video.currentTime + action.deltaSeconds, video.duration);
        flash(null);
        break;
      case 'scrub-cancel':
        flash({ text: 'Cancelled', sticky: false });
        break;
      case 'volume-commit':
        flash(null);
        break;
      case 'speed-end':
        video.playbackRate = rateBeforeHold.current;
        flash(null);
        break;
      default:
        flash(null);
        break;
    }
    void width;
  };

  const handleCancel = () => {
    clearLongPress();
    const { state, action } = onPointerCancel(stateRef.current);
    stateRef.current = state;
    if (action.type === 'speed-end') video.playbackRate = rateBeforeHold.current;
    flash(null);
  };

  return (
    <div
      ref={surfaceRef}
      className="gesture-layer"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
      // Without this the browser claims the drag for panning and the
      // horizontal scrub never receives a move event.
      style={{ touchAction: 'none' }}
      aria-hidden="true"
    >
      {feedback ? (
        <div className="gesture-pill">
          <span className="gesture-pill-text">{feedback.text}</span>
          {feedback.detail ? <span className="gesture-pill-detail">{feedback.detail}</span> : null}
          {feedback.bar !== undefined ? (
            <span className="gesture-bar">
              <span style={{ width: `${Math.round(feedback.bar * 100)}%` }} />
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
