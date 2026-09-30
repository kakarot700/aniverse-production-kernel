/**
 * Recent searches, stored locally.
 *
 * Same principle as the rest of the library layer: this is the viewer's data,
 * it works with no account, and it never leaves the browser.
 */

const KEY = 'aniverse:recent-searches';
const MAX_ENTRIES = 8;
const MAX_LENGTH = 80;

/** Pure: newest first, de-duplicated case-insensitively, bounded. */
export function mergeRecent(existing: readonly string[], term: string): string[] {
  const trimmed = term.trim().slice(0, MAX_LENGTH);
  if (!trimmed) return [...existing].slice(0, MAX_ENTRIES);

  // Case-insensitive de-dupe, but keep the casing the viewer just typed --
  // "naruto" then "Naruto" should be one entry showing the newer spelling.
  const rest = existing.filter((entry) => entry.toLowerCase() !== trimmed.toLowerCase());
  return [trimmed, ...rest].slice(0, MAX_ENTRIES);
}

/** Pure: validates whatever was in storage. */
export function parseRecent(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, MAX_LENGTH))
    .slice(0, MAX_ENTRIES);
}

export function readRecentSearches(): string[] {
  try {
    return parseRecent(JSON.parse(window.localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

export function addRecentSearch(term: string): string[] {
  try {
    const next = mergeRecent(readRecentSearches(), term);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

export function clearRecentSearches(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage disabled; nothing to clear.
  }
}
