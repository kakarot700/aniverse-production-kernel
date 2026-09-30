'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeQoe, type QoeEvent, type QoeMetrics } from '@/lib/streams/qoe';

/** Cap the event log so a marathon session cannot grow without bound. */
const MAX_EVENTS = 500;

/** How often the live metrics recompute while the overlay is watching. */
const REFRESH_MS = 1_000;

export interface UseQoeSessionResult {
  /** Stable per-playback-session GUID, reused as the CMCD `sid`. */
  sessionId: string;
  record: (event: QoeEvent) => void;
  /** Recomputed on a timer; null until the first event arrives. */
  metrics: QoeMetrics | null;
  /** Clears the log for a new episode. */
  reset: () => void;
  /** Current metrics without waiting for the next refresh tick. */
  snapshot: () => QoeMetrics;
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Owns the QoE event log for one playback session.
 *
 * The log lives in a ref, not state: these events fire several times a second
 * during a rebuffer, and re-rendering the player on each one would itself
 * cause the stutter we are trying to measure. Metrics are derived on a slow
 * timer instead, and only while someone is actually looking.
 */
export function useQoeSession(active: boolean): UseQoeSessionResult {
  const eventsRef = useRef<QoeEvent[]>([]);
  const [sessionId, setSessionId] = useState(newSessionId);
  const [metrics, setMetrics] = useState<QoeMetrics | null>(null);

  const record = useCallback((event: QoeEvent) => {
    const log = eventsRef.current;
    if (log.length >= MAX_EVENTS) {
      // Keep the head: `play-intent` and `first-frame` define video start
      // time, and dropping them would silently invalidate the whole session.
      log.splice(8, 1);
    }
    log.push(event);
  }, []);

  const snapshot = useCallback(() => computeQoe(eventsRef.current, Date.now()), []);

  const reset = useCallback(() => {
    eventsRef.current = [];
    setMetrics(null);
    setSessionId(newSessionId());
  }, []);

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (eventsRef.current.length > 0) setMetrics(computeQoe(eventsRef.current, Date.now()));
    };
    tick();
    const timer = window.setInterval(tick, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  return useMemo(
    () => ({ sessionId, record, metrics, reset, snapshot }),
    [metrics, record, reset, sessionId, snapshot],
  );
}
