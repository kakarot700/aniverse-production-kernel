/**
 * Continue-watching and watchlist state.
 *
 * Pure and storage-agnostic on purpose: this module decides *what* the library
 * contains, `lib/user-data/local-library.ts` decides where it is persisted, and
 * `hooks/useLibrary.ts` binds it to React. That split keeps the interesting
 * rules — when a resume is offered, when an episode counts as finished, when a
 * series leaves the continue row — unit testable without a browser.
 *
 * The shape mirrors the `playback_history` and `watchlists` tables in
 * `supabase/migrations/`, so a signed-in sync is a field mapping rather than a
 * rewrite.
 */

export const LIBRARY_VERSION = 1;

/** Below this, a resume prompt is noise — the viewer barely started. */
export const MIN_RESUME_MS = 15_000;

/** Within this much of the end, treat the episode as finished. */
export const COMPLETION_RATIO = 0.92;

/** Hard cap on stored episode rows; the oldest are pruned first. */
export const MAX_PROGRESS_ENTRIES = 400;

export interface EpisodeProgress {
  mediaId: string;
  episodeNumber: number;
  positionMs: number;
  /** 0 when the source never reported a duration. */
  durationMs: number;
  completed: boolean;
  updatedAt: number;
  title: string;
  coverImage: string;
  /** Total episodes when known, so a finished series can leave the row. */
  episodeCount: number | null;
  /** Taste signals for `lib/recommendations.ts`; absent on older records. */
  genres?: string[];
  studios?: string[];
  format?: string | null;
}

export interface WatchlistEntry {
  mediaId: string;
  title: string;
  coverImage: string;
  addedAt: number;
  genres?: string[];
  studios?: string[];
  format?: string | null;
}

export interface LibraryState {
  version: number;
  /** Keyed by `progressKey(mediaId, episodeNumber)`. */
  progress: Record<string, EpisodeProgress>;
  /** Keyed by media id. */
  watchlist: Record<string, WatchlistEntry>;
}

export interface ContinueWatchingItem {
  mediaId: string;
  title: string;
  coverImage: string;
  /** The episode to open — the next one when the last was finished. */
  episodeNumber: number;
  /** Where to seek, in ms. Always 0 when moving on to a new episode. */
  resumeMs: number;
  /** 0–1 through the episode being resumed; 0 for a fresh next episode. */
  progressRatio: number;
  updatedAt: number;
}

export function emptyLibrary(): LibraryState {
  return { version: LIBRARY_VERSION, progress: {}, watchlist: {} };
}

export function progressKey(mediaId: string, episodeNumber: number): string {
  return `${mediaId}::${episodeNumber}`;
}

function isCompleted(positionMs: number, durationMs: number): boolean {
  if (durationMs <= 0) return false;
  return positionMs >= durationMs * COMPLETION_RATIO;
}

export interface RecordProgressInput {
  mediaId: string;
  episodeNumber: number;
  positionMs: number;
  durationMs?: number;
  title: string;
  coverImage: string;
  episodeCount?: number | null;
  genres?: string[];
  studios?: string[];
  format?: string | null;
  now?: number;
}

/**
 * Records a playhead. Returns a new state object; the input is never mutated,
 * so React sees a genuine change and storage writes stay atomic.
 */
export function recordProgress(state: LibraryState, input: RecordProgressInput): LibraryState {
  const mediaId = input.mediaId.trim();
  if (!mediaId || !Number.isSafeInteger(input.episodeNumber) || input.episodeNumber < 1) return state;

  const now = input.now ?? Date.now();
  const positionMs = Math.max(0, Math.floor(input.positionMs));
  const durationMs = Math.max(0, Math.floor(input.durationMs ?? 0));
  const key = progressKey(mediaId, input.episodeNumber);

  const entry: EpisodeProgress = {
    mediaId,
    episodeNumber: input.episodeNumber,
    positionMs,
    durationMs,
    completed: isCompleted(positionMs, durationMs),
    updatedAt: now,
    title: input.title,
    coverImage: input.coverImage,
    episodeCount: input.episodeCount ?? state.progress[key]?.episodeCount ?? null,
    genres: input.genres ?? state.progress[key]?.genres,
    studios: input.studios ?? state.progress[key]?.studios,
    format: input.format ?? state.progress[key]?.format ?? null,
  };

  return prune({ ...state, progress: { ...state.progress, [key]: entry } });
}

/**
 * Where playback should resume for one episode, or 0 to start from the top.
 * A barely-started or already-finished episode restarts rather than dropping
 * the viewer at the credits.
 */
export function resumePositionFor(state: LibraryState, mediaId: string, episodeNumber: number): number {
  const entry = state.progress[progressKey(mediaId, episodeNumber)];
  if (!entry) return 0;
  if (entry.completed) return 0;
  if (entry.positionMs < MIN_RESUME_MS) return 0;
  return entry.positionMs;
}

export function latestEpisodeFor(state: LibraryState, mediaId: string): EpisodeProgress | null {
  let latest: EpisodeProgress | null = null;
  for (const entry of Object.values(state.progress)) {
    if (entry.mediaId !== mediaId) continue;
    if (!latest || entry.updatedAt > latest.updatedAt) latest = entry;
  }
  return latest;
}

/**
 * The continue-watching row: one entry per title, most recent first.
 *
 * A finished episode advances to the next one. A finished *final* episode
 * drops the series entirely — leaving a completed show pinned to the top of
 * the row is the single most irritating thing a resume list can do.
 */
export function continueWatching(state: LibraryState, limit = 20): ContinueWatchingItem[] {
  const byMedia = new Map<string, EpisodeProgress>();
  for (const entry of Object.values(state.progress)) {
    const current = byMedia.get(entry.mediaId);
    if (!current || entry.updatedAt > current.updatedAt) byMedia.set(entry.mediaId, entry);
  }

  const items: ContinueWatchingItem[] = [];
  for (const entry of byMedia.values()) {
    if (entry.completed) {
      const next = entry.episodeNumber + 1;
      if (entry.episodeCount !== null && next > entry.episodeCount) continue;
      items.push({
        mediaId: entry.mediaId,
        title: entry.title,
        coverImage: entry.coverImage,
        episodeNumber: next,
        resumeMs: 0,
        progressRatio: 0,
        updatedAt: entry.updatedAt,
      });
      continue;
    }

    if (entry.positionMs < MIN_RESUME_MS) continue;
    items.push({
      mediaId: entry.mediaId,
      title: entry.title,
      coverImage: entry.coverImage,
      episodeNumber: entry.episodeNumber,
      resumeMs: entry.positionMs,
      progressRatio: entry.durationMs > 0 ? Math.min(1, entry.positionMs / entry.durationMs) : 0,
      updatedAt: entry.updatedAt,
    });
  }

  return items.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, limit);
}

export function isInWatchlist(state: LibraryState, mediaId: string): boolean {
  return Boolean(state.watchlist[mediaId]);
}

export function toggleWatchlist(
  state: LibraryState,
  entry: {
    mediaId: string;
    title: string;
    coverImage: string;
    genres?: string[];
    studios?: string[];
    format?: string | null;
  },
  now = Date.now(),
): LibraryState {
  const mediaId = entry.mediaId.trim();
  if (!mediaId) return state;

  const watchlist = { ...state.watchlist };
  if (watchlist[mediaId]) {
    delete watchlist[mediaId];
  } else {
    watchlist[mediaId] = {
      mediaId,
      title: entry.title,
      coverImage: entry.coverImage,
      addedAt: now,
      genres: entry.genres,
      studios: entry.studios,
      format: entry.format ?? null,
    };
  }
  return { ...state, watchlist };
}

export function watchlistEntries(state: LibraryState): WatchlistEntry[] {
  return Object.values(state.watchlist).sort((left, right) => right.addedAt - left.addedAt);
}

export function forgetTitle(state: LibraryState, mediaId: string): LibraryState {
  const progress: Record<string, EpisodeProgress> = {};
  for (const [key, entry] of Object.entries(state.progress)) {
    if (entry.mediaId !== mediaId) progress[key] = entry;
  }
  return { ...state, progress };
}

/** Keeps the stored row count bounded by dropping the least recently touched. */
export function prune(state: LibraryState, maxEntries = MAX_PROGRESS_ENTRIES): LibraryState {
  const entries = Object.entries(state.progress);
  if (entries.length <= maxEntries) return state;

  const kept = entries
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, maxEntries);
  return { ...state, progress: Object.fromEntries(kept) };
}

/**
 * Accepts anything that came out of storage and returns a valid state. Stored
 * JSON is user-writable and may be from an older build, so every field is
 * re-checked rather than trusted.
 */
function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0).slice(0, 30);
  return items.length > 0 ? items : undefined;
}

export function parseLibrary(raw: unknown): LibraryState {
  if (!raw || typeof raw !== 'object') return emptyLibrary();
  const source = raw as Partial<LibraryState>;

  const progress: Record<string, EpisodeProgress> = {};
  if (source.progress && typeof source.progress === 'object') {
    for (const [key, value] of Object.entries(source.progress as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Partial<EpisodeProgress>;
      if (typeof entry.mediaId !== 'string' || !entry.mediaId) continue;
      if (!Number.isSafeInteger(entry.episodeNumber) || (entry.episodeNumber ?? 0) < 1) continue;
      if (!Number.isFinite(entry.positionMs) || (entry.positionMs ?? -1) < 0) continue;

      progress[key] = {
        mediaId: entry.mediaId,
        episodeNumber: entry.episodeNumber as number,
        positionMs: Math.floor(entry.positionMs as number),
        durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.floor(entry.durationMs as number)) : 0,
        completed: entry.completed === true,
        updatedAt: Number.isFinite(entry.updatedAt) ? (entry.updatedAt as number) : 0,
        title: typeof entry.title === 'string' ? entry.title : 'Untitled',
        coverImage: typeof entry.coverImage === 'string' ? entry.coverImage : '',
        episodeCount: Number.isSafeInteger(entry.episodeCount) ? (entry.episodeCount as number) : null,
        genres: stringArray(entry.genres),
        studios: stringArray(entry.studios),
        format: typeof entry.format === 'string' ? entry.format : null,
      };
    }
  }

  const watchlist: Record<string, WatchlistEntry> = {};
  if (source.watchlist && typeof source.watchlist === 'object') {
    for (const [key, value] of Object.entries(source.watchlist as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Partial<WatchlistEntry>;
      if (typeof entry.mediaId !== 'string' || !entry.mediaId) continue;
      watchlist[key] = {
        mediaId: entry.mediaId,
        title: typeof entry.title === 'string' ? entry.title : 'Untitled',
        coverImage: typeof entry.coverImage === 'string' ? entry.coverImage : '',
        addedAt: Number.isFinite(entry.addedAt) ? (entry.addedAt as number) : 0,
        genres: stringArray(entry.genres),
        studios: stringArray(entry.studios),
        format: typeof entry.format === 'string' ? entry.format : null,
      };
    }
  }

  return prune({ version: LIBRARY_VERSION, progress, watchlist });
}
