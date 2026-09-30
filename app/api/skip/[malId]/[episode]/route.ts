import { NextResponse, type NextRequest } from 'next/server';
import { fetchSkipTimes } from '@/lib/anime/aniskip';
import { TtlCache } from '@/lib/anime/cache';
import type { SkipTimestamps } from '@/types/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Skip times are immutable crowd data, so they cache hard and for a long
 * time. Negative results are cached too — most episodes are simply not
 * indexed, and re-asking on every play would be the dominant request pattern.
 */
const SKIP_TTL_MS = 12 * 60 * 60 * 1000;
const skipCache = new TtlCache<SkipTimestamps | null>(SKIP_TTL_MS, 1_000);

/**
 * `GET /api/skip/:malId/:episode?length=<seconds>`
 *
 * Server-side AniSkip lookup. The browser can call `lib/anime/aniskip.ts`
 * directly too — this route exists so the result is shared and cached across
 * every viewer instead of each one asking AniSkip themselves.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ malId: string; episode: string }> },
) {
  const { malId: rawMalId, episode: rawEpisode } = await context.params;

  const malId = Number.parseInt(rawMalId, 10);
  const episode = Number.parseInt(rawEpisode, 10);
  const length = Number.parseFloat(request.nextUrl.searchParams.get('length') ?? '');

  if (!Number.isSafeInteger(malId) || malId <= 0 || malId > 1_000_000_000) {
    return NextResponse.json({ error: 'A positive MyAnimeList id is required.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!Number.isSafeInteger(episode) || episode < 1 || episode > 5_000) {
    return NextResponse.json({ error: 'Episode must be a positive integer.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  // AniSkip filters by proximity to the real runtime, so a wild value is
  // worse than no request at all.
  if (!Number.isFinite(length) || length <= 0 || length > 6 * 60 * 60) {
    return NextResponse.json({ error: 'A positive episode length in seconds is required.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  // Bucket the length so trivially different durations share a cache entry.
  const cacheKey = `${malId}:${episode}:${Math.round(length / 5)}`;
  const skip = await skipCache.resolve(cacheKey, () =>
    fetchSkipTimes(malId, episode, length, { signal: request.signal }),
  );

  return NextResponse.json(
    { skip },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
        'X-Aniverse-Skip-Found': skip ? 'yes' : 'no',
      },
    },
  );
}
