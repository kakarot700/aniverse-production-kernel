'use client';

/**
 * Browser persistence for the library.
 *
 * Deliberately local-first: continue-watching and the watchlist work on a
 * fresh checkout with no Supabase project, no account and no network. When
 * Supabase *is* configured the same state maps onto `playback_history` and
 * `watchlists` (see `lib/supabase/repositories.ts`) — local stays the
 * write-through cache so playback never waits on a round trip.
 */
import { emptyLibrary, parseLibrary, type LibraryState } from './library';

const STORAGE_KEY = 'aniverse:library:v1';

type Listener = (state: LibraryState) => void;

let cached: LibraryState | null = null;
const listeners = new Set<Listener>();

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadLibrary(): LibraryState {
  if (cached) return cached;
  if (!canUseStorage()) return emptyLibrary();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cached = raw ? parseLibrary(JSON.parse(raw)) : emptyLibrary();
  } catch {
    // Corrupt or unreadable storage must never break the app; start clean.
    cached = emptyLibrary();
  }
  return cached;
}

export function saveLibrary(state: LibraryState): void {
  cached = state;
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Quota or private mode: the in-memory copy still serves this session.
    }
  }
  for (const listener of listeners) listener(state);
}

/** Subscribes to library changes, including writes from another tab. */
export function subscribeLibrary(listener: Listener): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    try {
      cached = event.newValue ? parseLibrary(JSON.parse(event.newValue)) : emptyLibrary();
    } catch {
      cached = emptyLibrary();
    }
    listener(cached);
  };

  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}
