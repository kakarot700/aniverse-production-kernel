/**
 * Airing schedule: grouping and countdown logic.
 *
 * Every function takes `now` explicitly and returns plain data. That is not
 * fussiness — timezone code that reads the clock internally can only be tested
 * by mocking the clock, and timezone bugs are exactly the ones that survive
 * mocked tests and then show up for a viewer in a different hemisphere.
 *
 * The one rule that governs the whole module: **`airingAt` is an absolute Unix
 * timestamp, and everything else is derived in the viewer's local zone.**
 * AniList publishes absolute seconds, so a cached response stays correct no
 * matter when it is read; but "Today" and "Tuesday" are local concepts, and a
 * server in UTC grouping days for a viewer in Asia/Kolkata will put a show on
 * the wrong day roughly a quarter of the time.
 */

import type { AnimeSummary } from '@/types/anime';

export interface AiringEntry {
  media: AnimeSummary;
  episode: number;
  /** Absolute Unix seconds. */
  airingAt: number;
}

export interface ScheduleDay {
  /** Local midnight for this day, as epoch ms. Stable sort key. */
  dayStart: number;
  /** `Today`, `Tomorrow`, or a weekday name. */
  label: string;
  /** `2026-09-30`, for keys and `<time datetime>`. */
  isoDate: string;
  isToday: boolean;
  entries: AiringEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Local midnight for the day containing `timestamp`. */
export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * `YYYY-MM-DD` in local time.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that converts to UTC first,
 * so for anyone east of Greenwich in the evening it silently reports tomorrow.
 */
export function localIsoDate(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `Today` / `Tomorrow` / weekday name, relative to `now`. */
export function dayLabel(dayStart: number, now: number): string {
  const today = startOfLocalDay(now);
  // Calendar-day difference, not elapsed time: a DST shift makes a "day" 23 or
  // 25 hours long, and dividing elapsed ms by 24h would then be off by one.
  const diffDays = Math.round((startOfLocalDay(dayStart) - today) / DAY_MS);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  return WEEKDAYS[new Date(dayStart).getDay()];
}

export interface GroupOptions {
  /** How many days forward to include. Default 7. */
  days?: number;
  /** Include entries that already aired today. Default true. */
  includeEarlierToday?: boolean;
}

/**
 * Groups airing entries into consecutive local days starting today.
 *
 * Empty days are kept: a schedule with Wednesday missing entirely reads as a
 * data failure, whereas "nothing airing" is information.
 */
export function groupByLocalDay(
  entries: readonly AiringEntry[],
  now: number,
  options: GroupOptions = {},
): ScheduleDay[] {
  const days = Math.max(1, Math.min(14, options.days ?? 7));
  const includeEarlierToday = options.includeEarlierToday ?? true;
  const todayStart = startOfLocalDay(now);
  const horizon = todayStart + days * DAY_MS;

  const buckets = new Map<number, AiringEntry[]>();
  for (let index = 0; index < days; index += 1) {
    // Build from local midnight each time rather than adding 24h repeatedly,
    // so a DST boundary inside the window does not skew every later day.
    const cursor = new Date(todayStart);
    cursor.setDate(cursor.getDate() + index);
    buckets.set(startOfLocalDay(cursor.getTime()), []);
  }

  for (const entry of entries) {
    if (!Number.isFinite(entry.airingAt) || entry.airingAt <= 0) continue;
    const airingMs = entry.airingAt * 1000;
    if (airingMs >= horizon) continue;
    if (!includeEarlierToday && airingMs < now) continue;

    const bucketKey = startOfLocalDay(airingMs);
    const bucket = buckets.get(bucketKey);
    // A past day (or one beyond the horizon) has no bucket; skip rather than
    // inventing one, which would produce a day out of order.
    if (bucket) bucket.push(entry);
  }

  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([dayStart, dayEntries]) => ({
      dayStart,
      label: dayLabel(dayStart, now),
      isoDate: localIsoDate(dayStart),
      isToday: dayStart === todayStart,
      entries: dayEntries.sort((left, right) =>
        left.airingAt === right.airingAt
          ? left.media.title.localeCompare(right.media.title)
          : left.airingAt - right.airingAt,
      ),
    }));
}

/**
 * Compact countdown: `2d 4h`, `4h 12m`, `12m`, `now`.
 *
 * Two units maximum. `1d 4h 32m 11s` is precision nobody asked for and it
 * reflows the layout every second.
 */
export function formatCountdown(secondsUntil: number): string {
  if (!Number.isFinite(secondsUntil)) return '';
  if (secondsUntil <= 0) return 'now';

  const totalMinutes = Math.floor(secondsUntil / 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (totalMinutes > 0) return `${totalMinutes}m`;
  return 'under a minute';
}

/** `14:30` in the viewer's locale and zone. */
export function formatLocalTime(airingAt: number, locale?: string): string {
  return new Date(airingAt * 1000).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** True when the episode's air time has passed. */
export function hasAired(entry: AiringEntry, now: number): boolean {
  return entry.airingAt * 1000 <= now;
}

/**
 * How many episodes a viewer is behind on.
 *
 * `nextAiringEpisode` is the episode that has *not* aired yet, so the most
 * recent one available is that number minus one. A cached record whose air
 * time has since passed still counts as aired, which is why `now` is needed:
 * otherwise a stale cache under-reports and the viewer never sees the badge.
 */
export function unwatchedCount(entry: AiringEntry, watchedEpisode: number, now: number): number {
  const latestAired = hasAired(entry, now) ? entry.episode : entry.episode - 1;
  return Math.max(0, latestAired - Math.max(0, watchedEpisode));
}
