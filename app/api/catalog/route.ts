import { NextResponse, type NextRequest } from 'next/server';
import { browseCatalog, getCatalogRecords, parseCatalogQuery } from '@/lib/anime';

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
const ID_PATTERN = /^(anilist|mal|offline):[A-Za-z0-9._-]{1,80}$/;

export async function GET(request: NextRequest) {
  // Batch mode: `?ids=anilist:1,offline:akira` resolves specific records for
  // shelves built from stored ids, instead of running a browse query.
  const rawIds = request.nextUrl.searchParams.get('ids');
  if (rawIds) {
    const ids = rawIds.split(',').map((id) => id.trim()).filter((id) => ID_PATTERN.test(id));
    if (ids.length === 0) {
      return NextResponse.json(
        { items: [], page: 1, perPage: 0, hasNextPage: false, total: 0, source: 'offline' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const items = await getCatalogRecords(ids);
    return NextResponse.json(
      { items, page: 1, perPage: items.length, hasNextPage: false, total: items.length, source: items[0]?.source ?? 'offline' },
      { headers: { 'Cache-Control': 'private, max-age=30' } },
    );
  }

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
