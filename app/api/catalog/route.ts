import { NextResponse, type NextRequest } from 'next/server';
import { getCatalogPage, normalizeCatalogQuery } from '@/lib/anime';
import { ANIME_FORMATS, ANIME_GENRES, ANIME_SEASONS, CATALOG_MODES } from '@/types/anime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/catalog`
 *
 * Browse or search the full anime catalog.
 *
 * Query parameters
 *   mode     trending | popular | top | seasonal | upcoming | search  (default: trending)
 *   q        search term (implies mode=search)
 *   genre    AniList genre name, e.g. "Action"
 *   format   TV | TV_SHORT | MOVIE | OVA | ONA | SPECIAL
 *   season   WINTER | SPRING | SUMMER | FALL
 *   year     season year
 *   page     1-based page (default 1)
 *   perPage  1–50 (default 24)
 *
 * The response is always a `CatalogPage`; `degraded: true` means every live
 * source failed and the bundled offline sample answered instead.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = normalizeCatalogQuery({
    mode: params.get('mode'),
    q: params.get('q'),
    genre: params.get('genre'),
    format: params.get('format'),
    season: params.get('season'),
    year: params.get('year'),
    page: params.get('page'),
    perPage: params.get('perPage'),
  });

  const page = await getCatalogPage(query, { signal: request.signal });

  return NextResponse.json(
    {
      ...page,
      query,
      filters: {
        modes: CATALOG_MODES,
        genres: ANIME_GENRES,
        formats: ANIME_FORMATS,
        seasons: ANIME_SEASONS,
      },
    },
    {
      headers: {
        'Cache-Control': page.degraded
          ? 'no-store'
          : 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
        'X-Aniverse-Catalog-Source': page.source,
      },
    },
  );
}
