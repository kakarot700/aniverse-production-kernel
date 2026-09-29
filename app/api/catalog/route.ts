import { NextResponse } from 'next/server';
import type { MediaCatalogRecord } from '@/types/media';
import { catalog } from '@/lib/catalog';

const catalogDatabaseMock: MediaCatalogRecord[] = catalog;

export async function GET() {
  return new NextResponse(JSON.stringify(catalogDatabaseMock), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120'
    }
  });
}
