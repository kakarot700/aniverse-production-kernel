import type { NextRequest } from 'next/server';
import { MAX_POSTER_TITLE_LENGTH, renderPosterSvg } from '@/lib/poster';

export const runtime = 'nodejs';

/** `GET /api/poster?title=...&seed=...` — locally generated SVG cover art. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const title = (params.get('title') ?? 'Untitled').slice(0, MAX_POSTER_TITLE_LENGTH);
  const seed = (params.get('seed') ?? title).slice(0, MAX_POSTER_TITLE_LENGTH);

  return new Response(renderPosterSvg(title, seed), {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
