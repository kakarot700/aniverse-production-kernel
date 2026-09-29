import { NextResponse } from 'next/server';
import { listGenres } from '@/lib/anime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `GET /api/genres` — the genre vocabulary the filter rail renders. */
export async function GET() {
  const { genres, source } = await listGenres();
  return NextResponse.json(
    { genres, source },
    { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } },
  );
}
