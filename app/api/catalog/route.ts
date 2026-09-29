import { NextResponse, type NextRequest } from 'next/server';
import { browseCatalog, parseCatalogQuery } from '@/lib/anime';

export const runtime = 'nodejs';
// Query-string driven and provider-backed, so never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * `GET /api/catalog` — browse/search the whole anime database.
 *
 * Query parameters:
 *   q        free-text search (AniList `SEARCH_MATCH`)
 *   genre    single genre name, e.g. `Adventure`
 *   season   WINTER | SPRING | SUMMER | FALL
 *   year     four-digit season year
 *   format   TV | TV_SHORT | MOVIE | SPECIAL | OVA | ONA | MUSIC
 *   sort     trending | popular | score | newest | title
 *   page     1-based page index (max 200)
 *   perPage  1-50, default 24
 *
 * Responses carry `source` (`anilist` | `jikan` | `offline`) and, when a
 * provider had to be skipped, a human-readable `degraded` note.
 *
 * Mirrors are intentionally *not* resolved here: the browse grid does not
 * need them, and resolving them per card would multiply source-map lookups.
 * `GET /api/catalog/<id>` returns the full mirror rail for one title.
 */
export async function GET(request: NextRequest) {
  const query = parseCatalogQuery(request.nextUrl.searchParams);

  try {
    const page = await browseCatalog(query);
    return NextResponse.json(page, {
      headers: {
        // Short shared cache; providers are already memoised in-process.
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Catalog lookup failed.';
    return NextResponse.json(
      { error: message, items: [], page: query.page, perPage: query.perPage, hasNextPage: false, total: 0, source: 'offline' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
