'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  continueWatching,
  isInWatchlist,
  recordProgress,
  resumePositionFor,
  toggleWatchlist,
  watchlistEntries,
  forgetTitle,
  type ContinueWatchingItem,
  type LibraryState,
  type RecordProgressInput,
  type WatchlistEntry,
} from '@/lib/user-data/library';
import { loadLibrary, saveLibrary, subscribeLibrary } from '@/lib/user-data/local-library';

export interface UseLibraryResult {
  ready: boolean;
  continueRow: ContinueWatchingItem[];
  watchlist: WatchlistEntry[];
  isSaved: (mediaId: string) => boolean;
  resumeFor: (mediaId: string, episodeNumber: number) => number;
  saveProgress: (input: RecordProgressInput) => void;
  toggleSaved: (entry: { mediaId: string; title: string; coverImage: string }) => void;
  forget: (mediaId: string) => void;
}

/**
 * Binds the library to React.
 *
 * The initial state is intentionally empty rather than read from storage
 * during render: the server has no `localStorage`, so seeding from it would
 * produce a hydration mismatch. The real state arrives in an effect and
 * `ready` tells the UI when it is safe to render the personalised rows.
 */
export function useLibrary(): UseLibraryResult {
  const [state, setState] = useState<LibraryState | null>(null);

  useEffect(() => {
    setState(loadLibrary());
    return subscribeLibrary(setState);
  }, []);

  const commit = useCallback((next: LibraryState) => {
    setState(next);
    saveLibrary(next);
  }, []);

  const saveProgress = useCallback(
    (input: RecordProgressInput) => {
      const current = state ?? loadLibrary();
      const next = recordProgress(current, input);
      if (next !== current) commit(next);
    },
    [commit, state],
  );

  const toggleSaved = useCallback(
    (entry: { mediaId: string; title: string; coverImage: string }) => {
      const current = state ?? loadLibrary();
      commit(toggleWatchlist(current, entry));
    },
    [commit, state],
  );

  const forget = useCallback(
    (mediaId: string) => {
      const current = state ?? loadLibrary();
      commit(forgetTitle(current, mediaId));
    },
    [commit, state],
  );

  const isSaved = useCallback((mediaId: string) => (state ? isInWatchlist(state, mediaId) : false), [state]);

  const resumeFor = useCallback(
    (mediaId: string, episodeNumber: number) => (state ? resumePositionFor(state, mediaId, episodeNumber) : 0),
    [state],
  );

  const continueRow = useMemo(() => (state ? continueWatching(state) : []), [state]);
  const watchlist = useMemo(() => (state ? watchlistEntries(state) : []), [state]);

  return {
    ready: state !== null,
    continueRow,
    watchlist,
    isSaved,
    resumeFor,
    saveProgress,
    toggleSaved,
    forget,
  };
}
