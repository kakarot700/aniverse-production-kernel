'use client';

import { useSyncExternalStore } from 'react';

/**
 * A clock that ticks at a fixed resolution, shared across every subscriber.
 *
 * Two problems this solves.
 *
 * Hydration: the server has its own clock and its own timezone, so any
 * component that renders `Date.now()` during SSR produces HTML that cannot
 * match the client. `getServerSnapshot` returns a stable sentinel, and
 * callers treat `0` as "time not known yet" and render a placeholder. The
 * real time arrives on the first client render.
 *
 * Cost: one interval for the whole page instead of one per countdown. A
 * schedule showing forty countdowns would otherwise run forty timers that
 * all fire at slightly different moments, so the numbers visibly disagree.
 */

const SUBSCRIBERS = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let snapshot = 0;
let tickMs = 60_000;

function start(resolutionMs: number) {
  // Finest requested resolution wins; a 1s countdown and a 60s one can
  // coexist, and the slower consumer simply re-renders more often than it
  // strictly needs to, which is cheaper than a second timer.
  tickMs = Math.min(tickMs, resolutionMs);
  if (intervalId !== null) return;

  snapshot = Date.now();
  intervalId = setInterval(() => {
    snapshot = Date.now();
    for (const notify of SUBSCRIBERS) notify();
  }, tickMs);
}

function subscribe(onStoreChange: () => void): () => void {
  SUBSCRIBERS.add(onStoreChange);
  return () => {
    SUBSCRIBERS.delete(onStoreChange);
    if (SUBSCRIBERS.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
      tickMs = 60_000;
    }
  };
}

function getSnapshot(): number {
  if (snapshot === 0) snapshot = Date.now();
  return snapshot;
}

/** Stable across the whole SSR pass, so the markup is deterministic. */
function getServerSnapshot(): number {
  return 0;
}

/**
 * Returns the current epoch milliseconds, or `0` during SSR and the very
 * first hydration pass. Always branch on `0`.
 */
export function useNow(resolutionMs = 60_000): number {
  const value = useSyncExternalStore(
    (onStoreChange) => {
      start(resolutionMs);
      return subscribe(onStoreChange);
    },
    getSnapshot,
    getServerSnapshot,
  );
  return value;
}
