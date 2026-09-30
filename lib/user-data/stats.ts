/**
 * Viewing statistics derived from the local library.
 *
 * Pure functions over `LibraryState`, so the profile page is a rendering of
 * data the viewer already owns — no extra request, nothing leaves the
 * browser, and every number here is testable without a DOM.
 */

import type { EpisodeProgress, LibraryState } from './library';

export interface ViewingStats {
  /** Episodes watched to completion. */
  episodesCompleted: number;
  /** Distinct titles with any recorded progress. */
  titlesStarted: number;
  /** Titles where every recorded episode is complete and at least one exists. */
  titlesCompleted: number;
  /** Titles with progress that is not finished. */
  inProgress: number;
  /** Total watch time in minutes, from recorded positions. */
  minutesWatched: number;
  /** Saved-for-later count. */
  watchlistSize: number;
  /** Most-watched genres, most frequent first. */
  topGenres: Array<{ name: string; count: number }>;
  /** Most-watched studios, most frequent first. */
  topStudios: Array<{ name: string; count: number }>;
}

export function computeStats(state: LibraryState | null): ViewingStats {
  const empty: ViewingStats = {
    episodesCompleted: 0,
    titlesStarted: 0,
    titlesCompleted: 0,
    inProgress: 0,
    minutesWatched: 0,
    watchlistSize: 0,
    topGenres: [],
    topStudios: [],
  };
  if (!state) return empty;

  const records = Object.values(state.progress ?? {});
  const byMedia = new Map<string, EpisodeProgress[]>();
  const genres = new Map<string, number>();
  const studios = new Map<string, number>();

  let episodesCompleted = 0;
  let millisecondsWatched = 0;

  for (const record of records) {
    if (!record || typeof record.mediaId !== 'string') continue;

    const list = byMedia.get(record.mediaId);
    if (list) list.push(record);
    else byMedia.set(record.mediaId, [record]);

    if (record.completed) episodesCompleted += 1;

    // Position, not duration: someone who stopped at four minutes watched
    // four minutes, and counting the full episode would inflate every total.
    // A completed episode counts its full duration because the stored
    // position often sits a little short of the end.
    const watched = record.completed && record.durationMs > 0 ? record.durationMs : record.positionMs;
    if (Number.isFinite(watched) && watched > 0) millisecondsWatched += watched;

    for (const genre of record.genres ?? []) {
      genres.set(genre, (genres.get(genre) ?? 0) + 1);
    }
    for (const studio of record.studios ?? []) {
      studios.set(studio, (studios.get(studio) ?? 0) + 1);
    }
  }

  let titlesCompleted = 0;
  for (const list of byMedia.values()) {
    if (list.length > 0 && list.every((record) => record.completed)) titlesCompleted += 1;
  }

  return {
    episodesCompleted,
    titlesStarted: byMedia.size,
    titlesCompleted,
    inProgress: byMedia.size - titlesCompleted,
    minutesWatched: Math.round(millisecondsWatched / 60_000),
    watchlistSize: Object.keys(state.watchlist ?? {}).length,
    topGenres: rank(genres, 6),
    topStudios: rank(studios, 4),
  };
}

function rank(counts: Map<string, number>, limit: number): Array<{ name: string; count: number }> {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    // Alphabetical tiebreak so equal counts produce a stable order rather
    // than whatever insertion order happened to be.
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** "12h 30m", "45m", "—". Hours are the useful unit once past one. */
export function formatWatchTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;

  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
  }
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}
