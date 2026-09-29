'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addToOwnWatchlist,
  listOwnPlaybackHistory,
  listOwnWatchlist,
  recordOwnPlayback,
  removeFromOwnWatchlist,
} from '@/lib/supabase/repositories';
import type { SupabaseUserState } from './useSupabaseUser';

export interface PlaybackProgress {
  mediaId: string;
  episodeNumber: number;
  positionMs: number;
  updatedAt: string;
}

export interface UserLibrary {
  ready: boolean;
  watchlist: Set<string>;
  /** Most-recent-first, one entry per media/episode pair. */
  history: PlaybackProgress[];
  error: string;
  toggleWatchlist: (mediaId: string) => Promise<void>;
  isSaved: (mediaId: string) => boolean;
  /** Debounced, de-duplicated progress write. */
  saveProgress: (mediaId: string, episodeNumber: number, positionMs: number) => void;
  /** Resume position for a media/episode pair, if one was recorded. */
  resumeFor: (mediaId: string, episodeNumber: number) => number;
  refresh: () => void;
}

const PROGRESS_FLUSH_MS = 5000;
/** Do not record a resume point inside the first or last slice of an episode. */
const MIN_RESUME_MS = 15_000;

/**
 * Watchlist + playback history backed by the RLS-scoped repository helpers.
 *
 * These repositories existed in the codebase but had no callers at all; this
 * hook is what makes the `watchlists` and `playback_history` tables — and the
 * migration's policies — actually do something.
 */
export function useUserLibrary({ client, user }: SupabaseUserState): UserLibrary {
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<PlaybackProgress[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  const pendingRef = useRef<Map<string, { mediaId: string; episodeNumber: number; positionMs: number }>>(new Map());
  const flushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!client || !user) {
      setWatchlist(new Set());
      setHistory([]);
      setReady(false);
      return;
    }

    let active = true;
    setError('');

    void Promise.all([listOwnWatchlist(client), listOwnPlaybackHistory(client)])
      .then(([rows, historyRows]) => {
        if (!active) return;
        setWatchlist(new Set((rows ?? []).map((row) => row.media_id)));
        setHistory(
          (historyRows ?? []).map((row) => ({
            mediaId: row.media_id,
            episodeNumber: row.episode_number,
            positionMs: Number(row.position_ms) || 0,
            updatedAt: row.updated_at,
          })),
        );
        setReady(true);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : 'Could not load your library.');
        setReady(true);
      });

    return () => {
      active = false;
    };
  }, [client, user, nonce]);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    if (!client || !user) {
      pendingRef.current.clear();
      return;
    }
    const batch = [...pendingRef.current.values()];
    pendingRef.current.clear();

    for (const entry of batch) {
      void recordOwnPlayback(client, {
        mediaId: entry.mediaId,
        episodeNumber: entry.episodeNumber,
        positionMs: Math.round(entry.positionMs),
      }).catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Could not save playback progress.');
      });
    }
  }, [client, user]);

  const saveProgress = useCallback(
    (mediaId: string, episodeNumber: number, positionMs: number) => {
      if (!client || !user) return;
      if (!Number.isFinite(positionMs) || positionMs < MIN_RESUME_MS) return;

      // One pending write per media/episode; later positions overwrite earlier
      // ones so a 40-minute watch produces a handful of writes, not thousands.
      pendingRef.current.set(`${mediaId}#${episodeNumber}`, { mediaId, episodeNumber, positionMs });

      setHistory((current) => {
        const next = current.filter(
          (entry) => !(entry.mediaId === mediaId && entry.episodeNumber === episodeNumber),
        );
        next.unshift({ mediaId, episodeNumber, positionMs, updatedAt: new Date().toISOString() });
        return next.slice(0, 60);
      });

      if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(flush, PROGRESS_FLUSH_MS);
      }
    },
    [client, flush, user],
  );

  // Flush on unmount and when the tab is hidden, so closing the player does
  // not silently discard the last few minutes of progress.
  useEffect(() => {
    // Capture the ref objects (not their contents) so the cleanup closure does
    // not reach through a ref React may have repointed by then.
    const pending = pendingRef;
    const timer = flushTimerRef;
    const onHide = () => {
      if (pending.current.size > 0) flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (pending.current.size > 0) flush();
    };
  }, [flush]);

  const toggleWatchlist = useCallback(
    async (mediaId: string) => {
      if (!client || !user) return;
      const saved = watchlist.has(mediaId);

      // Optimistic, with rollback on failure.
      setWatchlist((current) => {
        const next = new Set(current);
        if (saved) next.delete(mediaId);
        else next.add(mediaId);
        return next;
      });

      try {
        if (saved) await removeFromOwnWatchlist(client, mediaId);
        else await addToOwnWatchlist(client, mediaId);
        setError('');
      } catch (caught: unknown) {
        setWatchlist((current) => {
          const next = new Set(current);
          if (saved) next.add(mediaId);
          else next.delete(mediaId);
          return next;
        });
        setError(caught instanceof Error ? caught.message : 'Could not update your list.');
      }
    },
    [client, user, watchlist],
  );

  const isSaved = useCallback((mediaId: string) => watchlist.has(mediaId), [watchlist]);

  const resumeFor = useCallback(
    (mediaId: string, episodeNumber: number) =>
      history.find((entry) => entry.mediaId === mediaId && entry.episodeNumber === episodeNumber)?.positionMs ?? 0,
    [history],
  );

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return { ready, watchlist, history, error, toggleWatchlist, isSaved, saveProgress, resumeFor, refresh };
}
