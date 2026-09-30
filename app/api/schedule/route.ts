import { NextResponse } from 'next/server';
import { fetchAiringSchedule } from '@/lib/anime/airing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/schedule`
 *
 * This week's airing entries: `{ entries: AiringEntry[] }`.
 *
 * Deliberately returns absolute Unix timestamps and does no grouping. Days
 * and countdowns are local-timezone concepts and the server does not know the
 * viewer's timezone — grouping here would bake the server's zone into the
 * response and make the cache unshareable between viewers.
 */
export async function GET(request: Request) {
  try {
    const entries = await fetchAiringSchedule(50, request.signal);
    return NextResponse.json(
      { entries },
      {
        headers: {
          // Safe to cache: timestamps are absolute, so a shared copy stays
          // correct for every viewer regardless of where they are.
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=1800',
        },
      },
    );
  } catch {
    // An empty week renders as "nothing scheduled", which is a far better
    // failure than a broken page.
    return NextResponse.json({ entries: [], degraded: true }, { status: 200 });
  }
}
