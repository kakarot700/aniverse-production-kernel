# Catalog

The catalog covers the full anime database through a three-step provider
chain. Every step is best-effort; a failure downgrades to the next provider and
records why, so the grid keeps working during an outage instead of showing an
error page.

```
AniList (GraphQL)  →  Jikan / MyAnimeList (REST)  →  bundled offline seed
```

## Providers

### AniList — primary

`https://graphql.anilist.co`. Free, no API key, ~21,000 anime entries.

Supplies cover art, banners, synopses, genres, episode counts, studios, scores,
airing status, trailers, per-episode thumbnails (`streamingEpisodes`), and
`externalLinks`, which is where the "Watch officially" links come from.

Queried with an 8 second timeout. Browse results are cached in-process for
5 minutes, detail records for 15, the genre vocabulary for an hour.

### Jikan — fallback

`https://api.jikan.moe/v4`. Unofficial MyAnimeList API, used when AniList
errors, rate-limits, or times out.

Jikan is itself rate limited (~3 req/s), so requests are spaced by a 400 ms
gate and cached on the same schedule. Genre filtering needs numeric MAL genre
ids, which are fetched once and cached for six hours.

### Offline seed — last resort

`lib/anime/offline-seed.ts`. A bundled dataset of real anime with factual
metadata, used when both network providers are unreachable (air-gapped CI, an
offline dev box, a total provider outage).

Artwork is **generated locally** by `/api/poster` rather than hotlinked —
deterministic SVG covers derived from a hash of the title. Nothing in
`public/` is required and no third-party image is copied into the repository.

## Record shape

All three providers normalise to `MediaCatalogRecord` (`types/media.ts`). Ids
are namespaced so they round-trip safely through URLs and cache keys:

- `anilist:16498`
- `mal:5114`
- `offline:cowboy-bebop`

## Endpoints

### `GET /api/catalog`

Browse and search.

| Param | Values |
| --- | --- |
| `q` | free-text search, ≤120 chars |
| `genre` | single genre name, e.g. `Adventure` |
| `season` | `WINTER` \| `SPRING` \| `SUMMER` \| `FALL` |
| `year` | 1900–2100 |
| `format` | `TV` \| `TV_SHORT` \| `MOVIE` \| `SPECIAL` \| `OVA` \| `ONA` \| `MUSIC` |
| `sort` | `trending` \| `popular` \| `score` \| `newest` \| `title` |
| `page` | 1–200 |
| `perPage` | 1–50, default 24 |

Every numeric input is clamped and the search term is bounded before it
reaches a third-party API. Unknown values fall back rather than erroring.

Responses carry `source` (`anilist` \| `jikan` \| `offline`) and, when a
provider had to be skipped, a human-readable `degraded` note that the UI shows
as a banner.

**Episode lists are stripped from browse responses.** Grid cards only need
`episodeCount`; including the real list would mean shipping 1100+ episode
objects for One Piece on every page that contains it.

### `GET /api/catalog/<id>?episode=<n>`

One title, its full episode list, and the resolved server rail for a single
episode. Mirrors are resolved per requested episode rather than for all of
them, so a long-running series does not force thousands of source-map lookups
per request.

Returns `{ record, episode, mirrors, sourceMapConfigured, degraded }`.

### `GET /api/genres`

The genre vocabulary for the filter rail, from whichever provider answers.

### `GET /api/poster?title=…&seed=…`

Deterministic SVG cover art. Immutable-cached; the title is escaped, so a
crafted query cannot inject markup.

### `GET /api/servers`

Operator-facing server registry state. See [SERVERS.md](./SERVERS.md).

## Client behaviour

`hooks/useCatalog.ts` handles paging. Filter changes reset to page 1 and
replace the list; `loadMore` appends. Every request is abortable and stale
responses are discarded by comparing a request token, so fast typing in the
search box cannot interleave two result sets. The search input is debounced by
350 ms.

The home page server-renders page 1 for the default view by calling
`browseCatalog` **in process** — not by fetching its own `/api/catalog` over
HTTP, which would require an absolute origin and can deadlock a single-worker
dev server. The client skips its first fetch when that server-rendered page is
still the active view.
