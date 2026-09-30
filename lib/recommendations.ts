/**
 * Taste profile and recommendations.
 *
 * Deliberately not a black box: the score is a weighted overlap of genres,
 * studios and format between a candidate title and what the viewer has
 * actually watched, with a recency weight so last week's binge counts for more
 * than something abandoned months ago. Every part is pure and testable, and
 * the reason a title was recommended can be shown in the UI — "because you
 * watched X" beats an unexplained row.
 *
 * It runs entirely on locally stored history. Nothing about the viewer's
 * habits leaves the browser.
 */
import type { LibraryState } from '@/lib/user-data/library';
import type { AnimeSummary } from '@/types/anime';

/** Signals older than this contribute nothing. */
export const RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

const GENRE_WEIGHT = 1;
const STUDIO_WEIGHT = 0.6;
const FORMAT_WEIGHT = 0.25;

/** A saved-but-unwatched title is a weaker signal than a watched one. */
const WATCHLIST_WEIGHT = 0.5;

export interface TasteProfile {
  genres: Map<string, number>;
  studios: Map<string, number>;
  formats: Map<string, number>;
  /** Ids already watched or saved — never recommend these back. */
  known: Set<string>;
  /** Most recently watched titles, for "because you watched…" copy. */
  recentTitles: Array<{ mediaId: string; title: string; weight: number }>;
  strength: number;
}

export interface ProfileSource {
  mediaId: string;
  title: string;
  genres: string[];
  studios: string[];
  format: string | null;
  updatedAt: number;
  weight: number;
}

function decay(updatedAt: number, now: number): number {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 0.1;
  const age = Math.max(0, now - updatedAt);
  // Exponential decay with a two-week half life.
  return 2 ** (-age / RECENCY_HALF_LIFE_MS);
}

function bump(map: Map<string, number>, key: string, amount: number): void {
  const normalized = key.trim();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) ?? 0) + amount);
}

export function buildTasteProfile(sources: readonly ProfileSource[], now = Date.now()): TasteProfile {
  const genres = new Map<string, number>();
  const studios = new Map<string, number>();
  const formats = new Map<string, number>();
  const known = new Set<string>();
  const recent: Array<{ mediaId: string; title: string; weight: number }> = [];

  for (const source of sources) {
    known.add(source.mediaId);
    const weight = source.weight * decay(source.updatedAt, now);
    if (weight <= 0) continue;

    for (const genre of source.genres) bump(genres, genre, weight * GENRE_WEIGHT);
    for (const studio of source.studios) bump(studios, studio, weight * STUDIO_WEIGHT);
    if (source.format) bump(formats, source.format, weight * FORMAT_WEIGHT);

    recent.push({ mediaId: source.mediaId, title: source.title, weight });
  }

  recent.sort((left, right) => right.weight - left.weight);
  const strength = [...genres.values()].reduce((total, value) => total + value, 0);

  return { genres, studios, formats, known, recentTitles: recent.slice(0, 8), strength };
}

/** Reads a profile straight out of stored library state. */
export function profileFromLibrary(state: LibraryState, now = Date.now()): TasteProfile {
  const sources: ProfileSource[] = [];

  for (const entry of Object.values(state.progress)) {
    sources.push({
      mediaId: entry.mediaId,
      title: entry.title,
      genres: entry.genres ?? [],
      studios: entry.studios ?? [],
      format: entry.format ?? null,
      updatedAt: entry.updatedAt,
      weight: 1,
    });
  }

  for (const entry of Object.values(state.watchlist)) {
    sources.push({
      mediaId: entry.mediaId,
      title: entry.title,
      genres: entry.genres ?? [],
      studios: entry.studios ?? [],
      format: entry.format ?? null,
      updatedAt: entry.addedAt,
      weight: WATCHLIST_WEIGHT,
    });
  }

  return buildTasteProfile(sources, now);
}

export interface ScoredRecommendation {
  item: AnimeSummary;
  score: number;
  /** Human-readable justification, e.g. "Action · Fantasy". */
  reason: string;
}

/**
 * Scores one candidate. Overlap is normalized by the candidate's own genre
 * count so a title tagged with fifteen genres cannot outrank a focused match
 * purely by carpet-bombing the profile.
 */
export function scoreCandidate(item: AnimeSummary, profile: TasteProfile): ScoredRecommendation | null {
  if (profile.strength <= 0) return null;
  if (profile.known.has(item.id)) return null;
  if (item.isAdult) return null;

  let score = 0;
  const matchedGenres: string[] = [];

  for (const genre of item.genres) {
    const weight = profile.genres.get(genre);
    if (weight) {
      score += weight;
      matchedGenres.push(genre);
    }
  }
  if (item.genres.length > 0) score /= Math.sqrt(item.genres.length);

  let matchedStudio: string | null = null;
  for (const studio of item.studios) {
    const weight = profile.studios.get(studio);
    if (weight) {
      score += weight;
      matchedStudio ??= studio;
    }
  }

  // Format alone is not a recommendation — "this is also a TV series" says
  // nothing about taste. It only boosts a title that already matched on
  // genre or studio.
  if (matchedGenres.length === 0 && !matchedStudio) return null;

  const formatWeight = profile.formats.get(item.format);
  if (formatWeight) score += formatWeight;

  if (score <= 0) return null;

  // A gentle quality nudge so two equally on-taste titles are not ordered
  // arbitrarily. Deliberately small: taste dominates popularity.
  if (item.averageScore != null) score *= 1 + (item.averageScore - 70) / 500;

  const reason = matchedStudio
    ? `${matchedGenres.slice(0, 2).join(' · ') || 'Similar'} · ${matchedStudio}`
    : matchedGenres.slice(0, 3).join(' · ') || 'Similar to your list';

  return { item, score, reason };
}

export interface RecommendOptions {
  limit?: number;
  /** Ids to exclude beyond the profile's own known set. */
  exclude?: Iterable<string>;
}

export function recommend(
  candidates: readonly AnimeSummary[],
  profile: TasteProfile,
  options: RecommendOptions = {},
): ScoredRecommendation[] {
  const limit = options.limit ?? 12;
  const excluded = new Set(options.exclude ?? []);
  const seen = new Set<string>();
  const scored: ScoredRecommendation[] = [];

  for (const item of candidates) {
    if (excluded.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const result = scoreCandidate(item, profile);
    if (result) scored.push(result);
  }

  return scored
    .sort((left, right) => (right.score === left.score ? left.item.id.localeCompare(right.item.id) : right.score - left.score))
    .slice(0, limit);
}

/** Top genres by weight, for a "your taste" summary line. */
export function topGenres(profile: TasteProfile, limit = 3): string[] {
  return [...profile.genres.entries()]
    .sort((left, right) => (right[1] === left[1] ? left[0].localeCompare(right[0]) : right[1] - left[1]))
    .slice(0, limit)
    .map(([genre]) => genre);
}
