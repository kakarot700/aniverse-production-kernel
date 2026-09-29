import { NextResponse, type NextRequest } from 'next/server';
import { getAnimeDetail, parseMediaId, type MediaReference } from '@/lib/anime';
import { slugify } from '@/lib/anime/text';
import { getEpisodeMirrors, getRegistry } from '@/lib/streams/registry';
import { ANIME_SEASONS, type AnimeDetail, type AnimeEpisode } from '@/types/anime';
import type { WatchPayload } from '@/types/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Client-supplied hints are only ever used as *identifiers* inside the
 * operator's own URL templates, and the expanded URL is still re-validated and
 * allowlist-checked before the proxy will fetch it. They are sanitized hard
 * anyway so nothing surprising ends up in a path.
 */
function readHints(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const clean = (value: string | null, maxLength: number) =>
    (value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);

  const year = Number.parseInt(clean(params.get('year'), 8), 10);
  const season = clean(params.get('season'), 10).toUpperCase();
  const malId = Number.parseInt(clean(params.get('malId'), 12), 10);

  return {
    slug: slugify(clean(params.get('slug'), 120)),
    title: clean(params.get('title'), 120),
    year: Number.isFinite(year) && year >= 1900 && year <= 2200 ? year : null,
    season: (ANIME_SEASONS as readonly string[]).includes(season) ? season : null,
    malId: Number.isSafeInteger(malId) && malId > 0 ? malId : null,
    episodeCount: Math.min(5000, Math.max(0, Number.parseInt(clean(params.get('episodes'), 6), 10) || 0)),
  };
}

/**
 * Mirror resolution only needs the title's identifiers, so a catalog outage on
 * this server must not take playback down when the client already knows which
 * title it is looking at.
 */
function synthesizeRecord(
  reference: MediaReference,
  hints: ReturnType<typeof readHints>,
  episodeNumber: number,
): AnimeDetail {
  const title = hints.title || (reference.anilistId ? `AniList #${reference.anilistId}` : 'Unknown title');
  return {
    id: reference.raw,
    anilistId: reference.anilistId,
    malId: reference.malId ?? hints.malId,
    slug: hints.slug !== 'untitled' ? hints.slug : slugify(title),
    title,
    titles: { romaji: title, english: null, native: null },
    synopsis: '',
    coverImage: '/posters/aurora.jpg',
    bannerImage: null,
    accentColor: null,
    genres: [],
    year: hints.year,
    season: hints.season,
    format: 'TV',
    status: 'FINISHED',
    episodeCount: hints.episodeCount || null,
    durationMinutes: null,
    averageScore: null,
    popularity: null,
    studios: [],
    isAdult: false,
    trailer: null,
    source: 'offline',
    synonyms: [],
    tags: [],
    countryOfOrigin: null,
    startDate: null,
    endDate: null,
    nextAiringEpisode: null,
    relations: [],
    episodes: Array.from(
      { length: Math.max(hints.episodeCount, episodeNumber) },
      (_unused, index): AnimeEpisode => ({
        number: index + 1,
        title: `Episode ${index + 1}`,
        thumbnail: null,
        officialUrl: null,
        officialSite: null,
        aired: true,
      }),
    ),
  };
}

/**
 * `GET /api/watch/:id/:episode`
 *
 * Resolves the ranked stream-server list for one episode. Mirror URLs come
 * from the operator-configured registry only — the client can never inject a
 * media URL, and every proxied mirror is checked against the derived host
 * allowlist before `/api/proxy` will fetch it.
 *
 * Optional query hints (`slug`, `title`, `year`, `season`, `malId`,
 * `episodes`) let the client keep playback working while the server's catalog
 * sources are unavailable.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; episode: string }> },
) {
  const { id, episode } = await context.params;
  const reference = parseMediaId(id);
  if (!reference) {
    return NextResponse.json({ error: 'Unrecognized media id.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const episodeNumber = Number.parseInt(episode, 10);
  if (!Number.isSafeInteger(episodeNumber) || episodeNumber < 1 || episodeNumber > 5000) {
    return NextResponse.json({ error: 'Episode must be a positive integer.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const hints = readHints(request);
  const resolved = await getAnimeDetail(reference, { signal: request.signal });
  const detail = resolved ?? synthesizeRecord(reference, hints, episodeNumber);
  const catalogUnavailable = resolved === null;

  const fallbackEpisode: AnimeEpisode = {
    number: episodeNumber,
    title: detail.format === 'MOVIE' ? 'Feature' : `Episode ${episodeNumber}`,
    thumbnail: null,
    officialUrl: null,
    officialSite: null,
    aired: true,
  };
  const record = detail.episodes.find((entry) => entry.number === episodeNumber) ?? fallbackEpisode;

  const mirrors = getEpisodeMirrors(detail, episodeNumber);
  const registry = getRegistry();
  const referenceOnly = mirrors.length > 0 && mirrors.every((mirror) => mirror.isReference);

  const payload: WatchPayload = {
    animeId: detail.id,
    title: detail.title,
    poster: detail.coverImage,
    episode: record,
    episodeCount: detail.episodes.length || detail.episodeCount || hints.episodeCount || 1,
    mirrors,
    referenceOnly,
    notice:
      mirrors.length === 0
        ? registry.configuredCount === 0
          ? 'No stream servers are configured. Add them with ANIVERSE_STREAM_SERVERS (see docs/STREAM-SERVERS.md).'
          : 'No configured server can serve this title yet.'
        : referenceOnly
          ? catalogUnavailable
            ? 'Catalog metadata is unavailable on the server, so only the public reference streams could be matched.'
            : 'No licensed server is mapped to this title, so the public reference streams are playing instead.'
          : null,
  };

  return NextResponse.json(payload, {
    headers: {
      // Mirror lists are cheap to rebuild and must not be shared between users
      // once signed or tokenized URLs are in play.
      'Cache-Control': 'private, max-age=30',
      'X-Aniverse-Mirror-Count': String(mirrors.length),
    },
  });
}
