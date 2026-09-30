/**
 * Airing-schedule source.
 *
 * A deliberate choice about *which* AniList query to use:
 *
 * AniList exposes a raw `AiringSchedule` feed you can page through by
 * timestamp. It is the obvious thing to reach for and it is the wrong thing.
 * That feed carries thousands of entries per week, overwhelmingly obscure web
 * shorts and regional ONAs nobody is waiting for, and paging it takes many
 * round trips to assemble one week.
 *
 * Instead we ask for popular anime with `status: RELEASING` and read each
 * one's `nextAiringEpisode`. One request covers the week, every result is a
 * show somebody actually follows, and the response is small enough to cache
 * whole.
 *
 * The tradeoff, stated plainly: this returns each show's *next* episode only,
 * so a series airing twice in one week appears once. For a "what's on this
 * week" calendar that is the right shape; for a broadcast log it would not be.
 */

import { requestJson } from './http';
import { ANILIST_ENDPOINT, mapAniListMedia, type AniListMedia } from './anilist';
import type { AiringEntry } from '@/lib/schedule';

const AIRING_QUERY = `
query AniverseAiring($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, status: RELEASING, sort: POPULARITY_DESC, isAdult: false) {
      id
      idMal
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large medium color }
      bannerImage
      genres
      seasonYear
      season
      format
      status
      episodes
      duration
      averageScore
      popularity
      isAdult
      studios(isMain: true) { nodes { name } }
      trailer { id site thumbnail }
      nextAiringEpisode { episode airingAt timeUntilAiring }
    }
  }
}`;

interface AiringResponse {
  data?: { Page?: { media?: Array<AniListMedia | null> | null } | null } | null;
  errors?: Array<{ message?: string }>;
}

export const AIRING_PER_PAGE = 50;

/**
 * Fetches this week's airing entries.
 *
 * Returns `[]` rather than throwing on any upstream trouble: a schedule page
 * that renders "nothing scheduled" is a far better failure than one that
 * takes down the whole route, and the caller cannot do anything useful with
 * the error anyway.
 */
export async function fetchAiringSchedule(
  perPage = AIRING_PER_PAGE,
  signal?: AbortSignal,
): Promise<AiringEntry[]> {
  const payload = await requestJson<AiringResponse>(
    ANILIST_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: AIRING_QUERY,
        variables: { page: 1, perPage: Math.max(1, Math.min(50, perPage)) },
      }),
      signal,
    },
  );

  return parseAiringResponse(payload);
}

/**
 * Maps a raw response into entries, dropping anything without a usable next
 * episode. Split out from the fetch so the mapping is testable against
 * recorded shapes without a network.
 *
 * Takes `unknown` on purpose. This is the boundary where untrusted JSON
 * becomes typed data, and a parameter typed as the shape we hope for would
 * be asserting the very thing this function exists to establish.
 */
export function parseAiringResponse(payload: unknown): AiringEntry[] {
  const media = (payload as AiringResponse | null | undefined)?.data?.Page?.media ?? [];
  const entries: AiringEntry[] = [];

  for (const node of media) {
    if (!node) continue;
    // Typed as non-nullable numbers by the schema, checked anyway: the
    // schema is a claim about the server, not a guarantee about the bytes.
    const next = node.nextAiringEpisode;
    const airingAt: unknown = next?.airingAt;
    const episode: unknown = next?.episode;

    // A RELEASING show with no `nextAiringEpisode` is usually one on an
    // unannounced break. It belongs in a catalog, not on a calendar.
    if (typeof airingAt !== 'number' || !Number.isFinite(airingAt) || airingAt <= 0) continue;
    if (typeof episode !== 'number' || !Number.isFinite(episode) || episode <= 0) continue;

    try {
      // `AiringMediaNode` extends the catalog shape, so the mapper takes it
      // directly and simply ignores the extra field.
      entries.push({ media: mapAniListMedia(node), episode, airingAt });
    } catch {
      // One malformed record must not cost the whole week.
      continue;
    }
  }

  return entries;
}
