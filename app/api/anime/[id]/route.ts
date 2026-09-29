import { NextResponse, type NextRequest } from 'next/server';
import { getAnimeDetail, parseMediaId } from '@/lib/anime';
import { getEpisodeMirrors } from '@/lib/streams/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/anime/:id`
 *
 * `:id` accepts `anilist:<n>`, `mal:<n>`, a bare AniList numeric id, or an
 * offline sample id. Returns the normalized detail record plus a summary of
 * which stream servers can serve the title.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const reference = parseMediaId(id);
  if (!reference) {
    return NextResponse.json({ error: 'Unrecognized media id.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const detail = await getAnimeDetail(reference, { signal: request.signal });
  if (!detail) {
    return NextResponse.json({ error: 'Title not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const firstEpisode = detail.episodes[0]?.number ?? 1;
  const mirrors = getEpisodeMirrors(detail, firstEpisode);

  return NextResponse.json(
    {
      anime: detail,
      servers: {
        total: mirrors.length,
        licensed: mirrors.filter((mirror) => !mirror.isReference).length,
        reference: mirrors.filter((mirror) => mirror.isReference).length,
        names: mirrors.map((mirror) => mirror.serverName),
      },
    },
    {
      headers: {
        'Cache-Control': detail.source === 'offline'
          ? 'no-store'
          : 'public, max-age=120, s-maxage=900, stale-while-revalidate=3600',
        'X-Aniverse-Catalog-Source': detail.source,
      },
    },
  );
}
