import { NextResponse, type NextRequest } from 'next/server';
import { getCatalogRecord } from '@/lib/anime';
import { getServerRuntimeConfig, getSourceMapConfig } from '@/lib/servers/config';
import { getEffectiveAllowedHosts } from '@/lib/servers/allowlist';
import { isReferenceStreamsEnabled } from '@/lib/servers/reference-streams';
import { loadSourceMap } from '@/lib/servers/source-map';
import { resolveEpisodeMirrors } from '@/lib/servers/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID_PATTERN = /^(anilist|mal|offline):[A-Za-z0-9._-]{1,80}$/;

/**
 * `GET /api/catalog/<id>?episode=<n>` — one title plus the resolved server
 * rail for a single episode.
 *
 * Mirrors are resolved for the requested episode only. Long-running series
 * (One Piece is >1100 episodes) would otherwise force a source-map lookup per
 * episode on every detail request.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Unrecognised catalog id.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const found = await getCatalogRecord(id);
  if (!found) {
    return NextResponse.json({ error: 'That title is not in the catalog.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const { record } = found;
  const requested = Number.parseInt(request.nextUrl.searchParams.get('episode') ?? '1', 10);
  const available = record.episodes.map((episode) => episode.episodeNumber);
  const episodeNumber = available.includes(requested) ? requested : (available[0] ?? 1);

  const sourceMapConfig = getSourceMapConfig();
  const mirrors = resolveEpisodeMirrors(record.id, episodeNumber, {
    servers: getServerRuntimeConfig(),
    sourceMap: await loadSourceMap(sourceMapConfig),
    allowedHosts: getEffectiveAllowedHosts(),
    referenceStreamsEnabled: isReferenceStreamsEnabled(),
  });

  // Attach to the matching episode so the client has one consistent shape.
  const episodes = record.episodes.map((episode) =>
    episode.episodeNumber === episodeNumber ? { ...episode, mirrors } : episode,
  );

  return NextResponse.json(
    {
      record: { ...record, episodes },
      episode: episodeNumber,
      mirrors,
      sourceMapConfigured: sourceMapConfig.present,
      degraded: found.degraded,
    },
    { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' } },
  );
}
