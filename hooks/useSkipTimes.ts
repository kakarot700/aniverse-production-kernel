'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchSkipTimes } from '@/lib/anime/aniskip';
import type { SkipTimestamps } from '@/types/media';

/**
 * Loads AniSkip opening/ending timestamps for one episode.
 *
 * AniSkip requires the episode's real runtime and filters its index by
 * proximity to it, so this deliberately does nothing until the player has
 * reported a duration. The lookup then runs once per (title, episode,
 * rounded duration) and is remembered for the lifetime of the dialog.
 *
 * Server first — the route caches across all viewers — then straight from the
 * browser, matching how the catalog already degrades when this server has no
 * outbound network.
 */
export function useSkipTimes(malId: number | null, episode: number, durationSeconds: number) {
  const [skip, setSkip] = useState<SkipTimestamps | null>(null);
  const requestedRef = useRef('');

  useEffect(() => {
    if (!malId || !episode || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return;

    // Round the duration so ordinary playback jitter does not re-request.
    const key = `${malId}:${episode}:${Math.round(durationSeconds / 5)}`;
    if (requestedRef.current === key) return;
    requestedRef.current = key;

    const controller = new AbortController();

    const run = async () => {
      try {
        const response = await fetch(
          `/api/skip/${malId}/${episode}?length=${durationSeconds.toFixed(3)}`,
          { signal: controller.signal, headers: { Accept: 'application/json' } },
        );
        if (response.ok) {
          const payload = (await response.json()) as { skip: SkipTimestamps | null };
          if (payload.skip) {
            setSkip(payload.skip);
            return;
          }
          // The server answered "not indexed" authoritatively; trust it.
          if (response.headers.get('X-Aniverse-Skip-Found') === 'no') {
            setSkip(null);
            return;
          }
        }
      } catch {
        if (controller.signal.aborted) return;
      }

      const direct = await fetchSkipTimes(malId, episode, durationSeconds, { signal: controller.signal });
      if (!controller.signal.aborted) setSkip(direct);
    };

    void run();
    return () => controller.abort();
  }, [durationSeconds, episode, malId]);

  // A new episode must not inherit the previous one's timestamps.
  useEffect(() => {
    setSkip(null);
    requestedRef.current = '';
  }, [episode, malId]);

  return skip;
}
