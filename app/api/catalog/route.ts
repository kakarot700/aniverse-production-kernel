import { NextResponse } from 'next/server';
import { getPublicCatalog } from '@/lib/catalog';

/**
 * GET /api/catalog
 *
 * Serves the catalog that `lib/catalog.ts` defines, projected through
 * `getPublicCatalog()` so mirror manifest URLs never reach a client-visible
 * payload. Mirror URLs must come from the application's trusted catalog source
 * and be resolved server-side; see README "Authorized HLS sources".
 */
export async function GET() {
  const items = getPublicCatalog();

  return NextResponse.json(
    { items, count: items.length },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  );
}
