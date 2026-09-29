# Catalog sources

The catalog is the full public anime database, not a hand-written list. Every
request walks a source chain and the chain never throws — something always
renders.

```
AniList GraphQL  ──fail──▶  Jikan (MyAnimeList)  ──fail──▶  bundled offline sample
   primary                     mirror                          degraded: true
```

| Source | Endpoint | Auth | Used for |
| --- | --- | --- | --- |
| AniList | `https://graphql.anilist.co` | none | Everything: browse, search, detail, episode lists, official streaming links, trailers |
| Jikan (MyAnimeList) | `https://api.jikan.moe/v4` | none | Fallback browse/search/detail when AniList errors or rate-limits |
| Offline sample | bundled | — | Last resort; six original demo titles using the repository's own poster art |

## Normalization

`lib/anime/anilist.ts` and `lib/anime/jikan.ts` map their payloads into the
shared types in `types/anime.ts`, so the UI never branches on which provider
answered:

* `AnimeSummary` — grid/card data
* `AnimeDetail` — synopsis, tags, relations, `episodes[]`
* `CatalogPage` — items plus `pageInfo`, `source` and `degraded`

Descriptions are flattened to plain text (`lib/anime/text.ts`) because AniList
returns inline HTML even with `asHtml: false`. Nothing from an upstream source
is ever injected as markup.

## Episode lists

AniList publishes `episodes` (the count), `nextAiringEpisode` (how far a
currently-airing show has got) and `streamingEpisodes` (official watch links
with inconsistent `Episode N -` title prefixes). `buildEpisodeList` reconciles
all three into a dense, numbered list where each entry knows whether it has
aired and where it can be watched legally. Titles with 1000+ episodes are
chunked into blocks of 100 in the UI.

## Caching and rate limits

AniList allows a limited number of requests per minute per IP, so:

* catalog pages are cached for 5 minutes, details for 30 minutes
  (`lib/anime/cache.ts`);
* concurrent identical misses are coalesced into one upstream call, which also
  neutralizes React Strict Mode's double effect in development;
* a degraded (offline) answer is cached for only 30 seconds so recovery is
  quick, and a `null` detail is never cached at all;
* `requestJson` applies a hard timeout, one retry, and honours `Retry-After`.

If you expect real traffic, put a shared cache (Redis, or your CDN via the
`s-maxage` headers the routes already send) in front of `/api/catalog`.

## Degraded mode and the browser fallback

When the server cannot reach any live source it answers with the offline
sample and `degraded: true`. The client notices this and **re-issues the same
query directly from the browser** against AniList, which sends permissive CORS
headers. A viewer on a normal connection therefore still gets the complete
catalog even if the app server is sandboxed, firewalled, or offline. Only if
both paths fail does the offline banner stay on screen.

The same applies to title details: `useAnimeDetail` falls back to
`fetchAniListDetail` in the browser, and `/api/watch/:id/:episode` accepts
`slug`, `title`, `year`, `season`, `malId` and `episodes` hints so stream
servers still resolve while server-side metadata is unavailable.

## Testing against real responses

`tests/fixtures/jikan-real-response.json` is a response **recorded from the
live Jikan v4 API** (2026-09-29), and `tests/jikan-live-shape.test.ts` runs the
real mapper over it.

This exists because hand-written stubs only prove that a mapper agrees with the
test author's guess at the API. Recording the real payload immediately exposed
three defects that the stub-based tests had passed over:

| Real field | What actually comes back | Defect it caused |
| --- | --- | --- |
| `status` | `"Finished Airing"` | a substring test for `airing` matched the finished case, so every completed series was labelled *releasing* |
| `trailer.youtube_id` | `null`, with the id only inside `trailer.embed_url` | no title ever produced a trailer |
| `year` / `season` | both `null` on movies; the date lives at `aired.prop.from.year` | films showed no year |

If Jikan changes shape, **re-record the fixture** rather than relaxing the
assertions - the point of the file is that it is not invented.

AniList has no equivalent fixture yet: its endpoint is POST-only and the
sandbox this was built in had no egress to it. The AniList mapper is therefore
still covered only by hand-written cases, and is the most likely place for a
similar shape mismatch to be hiding. Recording one is the obvious next step.

## Attribution and terms

AniList and Jikan/MyAnimeList data is used under their public API terms.
Credit them in your UI (the footer already does), keep request volume within
their published limits, and do not mirror their databases wholesale.

Artwork is hot-linked from the AniList CDN (`s4.anilist.co`) and the MAL CDN.
`<img>` tags use `referrerPolicy="no-referrer"` and fall back to a bundled
poster if a remote image fails.
