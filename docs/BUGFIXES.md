# Bug fixes

Findings from a full read of the repository, and what was done about each.
The build, typecheck, lint, and test suite were all green *before* this pass —
every bug below is a behavioural one that static analysis could not see.

## Feature-breaking

### 1. `/api/catalog` was dead code

`app/page.tsx` rendered `lib/catalog.ts` — five fictional, poster-only titles
with `mirrors: []`. Nothing in the application ever fetched `/api/catalog`, so
the "server catalog matrix" was unreachable at runtime and the only test
covering it called the route handler directly.

**Fixed:** the catalog is now a real provider chain (AniList → Jikan → bundled
offline seed) wired into the page, with search, genre/format filters, sorting,
and paging. `lib/catalog.ts` is gone.

### 2. Every server mirror was guaranteed to fail

All eleven mirrors used the provider's **homepage** as `manifestUrl`:

```ts
{ serverName: 'Filemoon', manifestUrl: 'https://filemoon.sx', requiresProxy: true }
```

`/api/proxy` fetches the URL and rejects anything whose body does not start
with `#EXTM3U`. A homepage returns HTML, so the proxy answered `502`, the
worker's probe failed, and it fell through to the next mirror — which failed
identically. Every playback attempt ended at "All configured stream mirrors are
unavailable", 100% of the time.

**Fixed:** servers are now a registry of configurable slots resolved through an
operator source map, with real per-server status. No server was removed. See
[SERVERS.md](./SERVERS.md).

### 3. `requiresProxy: false` was ignored

`types/media.ts` documented `requiresProxy` as a real tier hint, and two
mirrors (Mp4Upload, Netu.tv) declared `false`. But `MasterPlayer` flattened
mirrors to `episode.mirrors.map((m) => m.manifestUrl)` — a bare `string[]` —
and `core/stream.worker.ts` unconditionally rewrote every entry to
`/api/proxy?url=…`. The flag had no effect anywhere in the codebase.

**Fixed:** the worker takes `{ serverId, url, requiresProxy }` descriptors and
probes direct mirrors at their own origin, validating them by sniffing
`#EXTM3U` instead of the proxy's marker header.

### 4. Only the first episode was reachable

`PlayerDialog` hardcoded `item.episodes[0]`. There was no episode selector, so
a multi-episode series could only ever play episode 1.

**Fixed:** `EpisodeRail` renders the full list, paged into blocks of 100 so a
1100-episode series stays usable. Changing episode re-resolves mirrors.

### 5. Crash on a record with no episodes

`MasterPlayer` received `item.episodes[0]` and immediately read
`episode.mirrors`. With the old fixed catalog every record happened to have one
episode, but any record with an empty `episodes` array threw
`TypeError: Cannot read properties of undefined`. With a real provider-backed
catalog — where unaired titles legitimately have no episodes — this would have
fired constantly.

**Fixed:** a fallback episode is substituted and the player renders an honest
empty state.

## Performance

### 6. Supabase session refresh on every media segment

The middleware matcher excluded static assets but **not** `/api/*`. Every HLS
segment fetched through `/api/proxy` therefore triggered
`supabase.auth.getClaims()` — an extra network round trip, several times per
second during playback, on the critical path of video delivery.

**Fixed:** the matcher now excludes `api/`. API routes that need a user build
their own client.

### 7. Browse responses carried full episode lists

`MediaCatalogRecord.episodes` was serialised for every card. One Piece alone is
1100+ episode objects, repeated on every page containing it.

**Fixed:** `browseCatalog` strips episodes; `episodeCount` carries what the
card displays. A 24-card page went from hundreds of kilobytes to ~14 kB.

### 8. Infinite-scroll observer rebuilt on every render

The `IntersectionObserver` effect depended on the whole `catalog` object, which
is a fresh reference each render, so the observer was torn down and recreated
continuously.

**Fixed:** it depends on `hasNextPage` and `loadMore` only.

### 9. hls.js in the initial bundle

`MasterPlayer` imports hls.js at module scope and sat in the main client
chunk, so ~130 kB of player code was downloaded by everyone who merely looked
at the grid.

**Fixed:** the player dialog is a `next/dynamic` import, loaded when a title is
opened.

## Correctness and leaks

### 10. Hover-preview timer leaked

`CatalogCard` set a 300 ms `setTimeout` on hover/focus but never cleared it on
unmount. Paging the grid unmounts cards constantly, each potentially leaving a
pending timer that calls `setState` on a dead component.

**Fixed:** a cleanup effect clears the timer.

### 11. Playback restarted on unrelated re-renders

The `MasterPlayer` effect listed `[episode, onProgress, videoRef]`. `episode`
is an object and `onProgress` a callback; any parent state change that produced
new references tore down the worker, destroyed the hls.js instance, and
restarted the stream from scratch.

**Fixed:** callbacks live in a ref, and the effect keys off a primitive derived
from the episode number and mirror list.

### 12. Late worker failures leaked into new requests

`fail()` read the module-level `requestId`. A probe that failed after a
`CANCEL_STREAM` — or after a new `INITIALIZE_STREAM` reused the worker — could
post `STREAM_CRITICAL_FAILURE` tagged with the *current* request id, surfacing a
stale error in an unrelated playback session.

**Fixed:** `fail()` takes the request id its chain started with and drops the
message if it is no longer current.

### 13. Probe loop raced on a shared `connecting` flag

`probeCurrentMirror` guarded re-entry with a module-level `connecting` boolean
that its own `finally` block cleared while the surrounding `while` loop was
still iterating, then set again at the bottom of the loop.

**Fixed:** the chain captures its generation at entry and re-checks it after
every await. No shared mutable "am I connecting" state.

### 14. Proxy timeout vs. streaming bodies

The 12 second connect deadline was cleared before returning a streamed body
(correct), but nothing cancelled the upstream fetch when the *browser*
disconnected mid-segment, leaving the connection to run to completion.

**Fixed:** the request's abort signal is wired to the upstream controller, and
is deliberately kept attached for streaming responses while only the connect
deadline is cleared.

### 15. Playhead display broke past one hour

`formatPlaybackPosition` computed `${minutes}:${seconds}` with no hour
component, so a 1h48m film showed `108:23`.

**Fixed:** hours are rendered when non-zero.

### 16. Signed shift produced invalid poster colours

*(New code, caught by its own regression test.)* The SVG poster generator
derives hue, saturation, radii, and the motif index from a 32-bit FNV hash
using `>>`. JavaScript's `>>` is **signed**, so every hash ≥ 2³¹ — about half
of them — yielded negative percentages, negative radii, and negative array
indices, which browsers render as a blank rectangle.

**Fixed:** unsigned `>>>` throughout, plus `tests/poster.test.ts` asserting no
negative values or `NaN` across 400 seeds and that all three motifs are
reachable.

## Hardening and environment

### 17. `X-Frame-Options` would have broken hosted previews

A `SAMEORIGIN` header blocks the iframe used by Codespaces, e2b/Arena
sandboxes, and similar preview environments.

**Fixed:** clickjacking protection is expressed as CSP `frame-ancestors` and
is opt-in via `ANIVERSE_FRAME_ANCESTORS`, so it can be locked down in
production without breaking development.

### 18. Next 15 rejected cross-origin dev requests

Any proxied preview host was refused by the dev server.

**Fixed:** `allowedDevOrigins` covers common preview hosts and is extensible
through `ANIVERSE_DEV_ORIGINS`.

### 19. Proxy gaps

- No `HEAD` handler, so range-probing clients got a 405.
- No `User-Agent`/`Referer` passthrough, which many CDNs and hotlink-protected
  origins require. Now configurable via `ANIVERSE_MEDIA_USER_AGENT` and
  `ANIVERSE_MEDIA_REFERER`.
- `etag`/`last-modified` were dropped, defeating conditional requests.
- `Accept-Encoding: identity` is now sent so segment bytes are not
  double-compressed.
- The redundant `!response.ok && response.status !== 206` check was simplified
  (`ok` already covers 206).

### 20. Watch room bound to a `<video>` that did not exist yet

`useWatchRoom` captured `videoRef.current` once when its effect ran. The effect
only runs for a valid room id, but the player renders a loading state before
its mirrors resolve — so joining a room during that window bound listeners to
`null` and silently never synchronised.

**Fixed:** the hook takes a `videoEpoch` that changes when the element mounts.
The panel also reports an explicit reason when sync is impossible, such as a
cross-origin embedded player the parent page cannot read or control.

### 21. Unused artwork with unverified licensing

`public/posters/*.jpg` were, by their own `ASSET-NOTES.txt`, "collected from
visual-search results" with licensing "not independently verified". After the
catalog rewrite nothing referenced them.

**Fixed:** removed. Real titles use provider CDN art; the offline catalog
renders deterministic SVG covers locally through `/api/poster`.

### 22. Dead reference

`AniverseExperience` declared a `searchRef`, attached it to the search input,
and never read it.

**Fixed:** removed.

## Second pass: completing the unfinished halves

### 23. Watch-room invites could open different titles for each peer

`?room=<uuid>` opened `items[0]` — whatever happened to be first in the
*trending* list at that moment. Trending changes hourly and differs by
provider, so two peers opening the same invite could land on different titles,
and the same peer could get a different one an hour later. The room would
connect and dutifully synchronise playheads across two unrelated videos.

**Fixed:** the dialog is addressable by id. `?title=<catalog-id>&ep=<n>` is
written on open and on every episode change, and restored on load, so an
invite link resolves to exactly one title and episode.

### 24. The entire Supabase user-data layer was unreachable

`lib/supabase/repositories.ts` exported seven functions —
`getOwnProfile`, `updateOwnProfile`, `listOwnWatchlist`, `addToOwnWatchlist`,
`removeFromOwnWatchlist`, `recordOwnPlayback`, `listOwnPlaybackHistory` — with
**zero callers** anywhere in the codebase. There was also no sign-in UI, so no
authenticated client could ever exist. The `watchlists` and `playback_history`
tables, and every RLS policy written for them, were dead weight.

**Fixed:** passwordless email sign-in (`AccountPanel`), a watchlist toggle, a
"Your list" shelf, playback-progress recording, resume-on-open, and a
"Continue watching" shelf. See `docs/CATALOG.md`.

### 25. `skipTimestamps` was declared but never populated — and auto-seeked

`MediaEpisodePayload.skipTimestamps` existed in the types and `MasterPlayer`
implemented handling for it, but nothing in the codebase ever set it, so the
code was unreachable. Worse, when it *did* fire it silently moved the playhead:
indistinguishable from a stream glitch, and impossible to decline.

**Fixed:** the source map can supply per-episode intro/outro windows, validated
so a reversed or partial block is dropped. The player now shows a **Skip
intro** / **Skip outro** button instead of seeking on the viewer's behalf.

### 26. Season filtering was parsed, supported, and unreachable

`parseCatalogQuery` validated `season`, and both AniList and Jikan providers
accepted it, but no UI control ever set it.

**Fixed:** season and year selects, plus a "Clear filters" control. The offline
provider documents that it ignores `season` — the seed has release years but
no airing season, and returning an empty grid would look like a broken filter.

### 27. No route-level error, loading, or 404 boundaries

An exception in a server component produced Next's default error screen.

**Fixed:** `app/error.tsx`, `app/loading.tsx`, and `app/not-found.tsx` in the
app's own visual language.

### 28. Shelf and progress hooks re-ran on every render

`CatalogShelf` receives an array of ids, whose identity changes on every parent
render; a naive effect dependency would refetch continuously. Progress writes
had the same shape of problem.

**Fixed:** the shelf keys its effect off a joined primitive, and progress
writes are debounced and de-duplicated into a pending map.

## Known, not fixed

- `npm audit` reports a high-severity advisory in `postcss`, reachable only as
  a transitive dependency of `next@15.5.26`. The fix requires `next@16`, a
  major upgrade with breaking changes. Flagged rather than forced.
- `estimatePeerClockOffset`, `predictPlayheadSeconds`, and
  `planPlaybackCorrection` were reviewed against the NTP four-timestamp
  formula and found correct; their tests were kept as-is.
