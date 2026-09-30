/**
 * AniSkip client — crowd-sourced opening/ending timestamps.
 *
 * `types/media.ts` has carried a `SkipTimestamps` shape since the first
 * revision and nothing ever populated it, so the player's skip button could
 * never appear. This fills it from AniSkip's public v2 API.
 *
 * Contract (https://api.aniskip.com/api-docs):
 *
 *   GET /v2/skip-times/{malId}/{episode}
 *       ?types=op&types=ed&types=recap&episodeLength={seconds}
 *
 *   200 { found: true, results: [{ interval: { startTime, endTime },
 *                                  skipType: 'op'|'ed'|'recap'|'mixed-op'|'mixed-ed',
 *                                  episodeLength }] }
 *   404 when the episode is not indexed — a normal, expected answer.
 *
 * `episodeLength` is **mandatory**: omitting it returns 400, and a value far
 * from the real runtime returns 404 even for an indexed episode. So the caller
 * must wait until the player knows the duration before asking.
 *
 * Parsing is separated from fetching so the interesting part — deciding which
 * intervals are trustworthy — is unit testable without a network.
 */
import type { SkipTimestamps } from '@/types/media';

export const ANISKIP_ENDPOINT = 'https://api.aniskip.com/v2/skip-times';

/** `mixed-op` is deliberately not requested: an opening overlaid on story
 *  content is not a clean skip boundary and skipping it loses plot. */
export const REQUESTED_SKIP_TYPES = ['op', 'ed', 'recap'] as const;

/** An opening longer than this is almost certainly a bad crowd submission. */
const MAX_INTRO_SECONDS = 180;

/** Ignore an interval shorter than this; it is not worth a button. */
const MIN_SEGMENT_SECONDS = 3;

interface AniSkipInterval {
  startTime?: unknown;
  endTime?: unknown;
}

interface AniSkipResult {
  interval?: AniSkipInterval;
  skipType?: unknown;
  episodeLength?: unknown;
}

function finiteSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Turns an AniSkip payload into the player's `SkipTimestamps`, dropping
 * anything implausible. Returns `null` when nothing usable survives, which the
 * caller caches as a negative result.
 */
export function parseSkipTimes(raw: unknown, episodeLengthSeconds: number): SkipTimestamps | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as { found?: unknown; results?: unknown };
  if (payload.found !== true || !Array.isArray(payload.results)) return null;

  const duration = finiteSeconds(episodeLengthSeconds) ?? 0;

  let intro: { start: number; end: number } | null = null;
  let recap: { start: number; end: number } | null = null;
  let outro: { start: number; end: number } | null = null;

  for (const entry of payload.results as AniSkipResult[]) {
    if (!entry || typeof entry !== 'object') continue;
    const skipType = typeof entry.skipType === 'string' ? entry.skipType.toLowerCase() : '';
    const start = finiteSeconds(entry.interval?.startTime);
    const end = finiteSeconds(entry.interval?.endTime);
    if (start === null || end === null) continue;
    if (end - start < MIN_SEGMENT_SECONDS) continue;
    // A segment past the end of the episode is stale data from a different cut.
    if (duration > 0 && start >= duration) continue;

    const clampedEnd = duration > 0 ? Math.min(end, duration) : end;
    if (clampedEnd <= start) continue;
    const segment = { start, end: clampedEnd };

    if (skipType === 'op' && clampedEnd - start <= MAX_INTRO_SECONDS) {
      // Prefer the earliest opening when several are submitted.
      if (!intro || segment.start < intro.start) intro = segment;
    } else if (skipType === 'ed' || skipType === 'mixed-ed') {
      // Prefer the latest ending: that is the real credits roll.
      if (!outro || segment.start > outro.start) outro = segment;
    } else if (skipType === 'recap' && clampedEnd - start <= MAX_INTRO_SECONDS) {
      if (!recap || segment.start < recap.start) recap = segment;
    }
  }

  // A recap stands in for the intro when no opening was submitted — both are
  // "skippable material at the front" as far as the player is concerned.
  const front = intro ?? recap;
  if (!front && !outro) return null;

  return {
    introStart: front?.start ?? 0,
    introEnd: front?.end ?? 0,
    outroStart: outro?.start ?? 0,
    outroEnd: outro?.end ?? 0,
  };
}

export function buildSkipTimesUrl(malId: number, episode: number, episodeLengthSeconds: number): string {
  const params = new URLSearchParams();
  for (const type of REQUESTED_SKIP_TYPES) params.append('types', type);
  // The API rejects more than three decimal places.
  params.set('episodeLength', episodeLengthSeconds.toFixed(3));
  return `${ANISKIP_ENDPOINT}/${malId}/${episode}?${params.toString()}`;
}

export interface FetchSkipTimesOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Fetches and normalizes skip times. Never throws: a missing episode, a
 * network failure and a malformed body all resolve to `null`, because a
 * missing skip button must never take playback down with it.
 */
export async function fetchSkipTimes(
  malId: number,
  episode: number,
  episodeLengthSeconds: number,
  options: FetchSkipTimesOptions = {},
): Promise<SkipTimestamps | null> {
  if (!Number.isSafeInteger(malId) || malId <= 0) return null;
  if (!Number.isSafeInteger(episode) || episode <= 0) return null;
  if (!Number.isFinite(episodeLengthSeconds) || episodeLengthSeconds <= 0) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? 6_000);

  try {
    const response = await fetchImpl(buildSkipTimesUrl(malId, episode, episodeLengthSeconds), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    // 404 simply means "not indexed" and is the most common answer.
    if (!response.ok) return null;
    return parseSkipTimes(await response.json(), episodeLengthSeconds);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
