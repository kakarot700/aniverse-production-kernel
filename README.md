# Aniverse Production Kernel

A Next.js 15 App Router application for browsing the **complete public anime
catalog**, playing it through a ranked **stream-server registry** with
automatic failover, and watching in sync with other people.

## Run and validate

Requirements: Node.js 20+.

```sh
npm ci
npm run dev
```

Quality checks:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

No configuration is needed to start: the catalog is live on first run and the
bundled reference streams give you working playback immediately.

To connect licensed anime media, copy `.env.example` to `.env.local` and paste
an HLS/MP4 URL or template into any of the 12 `ANIVERSE_SERVER_XX_URL` slots.
The slot activates on restart; no player code change is required.

## What is here

| Area | Behaviour |
| --- | --- |
| Catalog | AniList GraphQL → Jikan/MyAnimeList → bundled offline sample. Browse trending / popular / top rated / seasonal / upcoming, search, and filter by genre, format, season and year. |
| Titles | Synopsis, studios, score, tags, relations, full episode lists (chunked for 1000+ episode shows), official streaming links and trailers. |
| Playback | Ranked mirror list per episode, off-main-thread probing, hls.js with network/media error recovery, automatic failover, manual server switching, quality selection. |
| Media proxy | Same-origin HLS gateway with a derived host allowlist, per-hop redirect re-checks, manifest rewriting, range and content-encoding correctness. |
| Watch rooms | Private Supabase Broadcast channels, four-timestamp clock sync, drift correction. |

Deeper notes: [`docs/ANIME-SOURCES.md`](docs/ANIME-SOURCES.md),
[`docs/STREAM-SERVERS.md`](docs/STREAM-SERVERS.md),
[`docs/STREAM-SERVER-RESEARCH.md`](docs/STREAM-SERVER-RESEARCH.md),
[`docs/ROOM-SYNC.md`](docs/ROOM-SYNC.md), and
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Catalog

The catalog is **not** a hard-coded list. `GET /api/catalog` queries AniList,
which covers every anime series, film, OVA, ONA and special in the public
database. If AniList errors or rate-limits, the same query is retried against
the Jikan (MyAnimeList) mirror. If both fail, a bundled six-title offline
sample answers with `degraded: true` and the UI says so — and the browser then
retries AniList directly, since it sends permissive CORS headers and a normal
client connection usually succeeds even when the server's does not.

```
GET /api/catalog?mode=trending|popular|top|seasonal|upcoming|search
                &q=&genre=&format=&season=&year=&page=&perPage=
GET /api/anime/:id                    # anilist:<n> | mal:<n> | <n> | offline:<slug>
GET /api/watch/:id/:episode           # ranked stream servers for one episode
GET /api/servers                      # registry state + config diagnostics
GET|HEAD /api/proxy?url=<https url>   # same-origin media gateway
```

## Stream servers

A server is a real media origin described by data, never by code. The registry
expands each server's URL template for the requested title and episode, drops
anything that is not a safe public HTTPS endpoint, sorts by priority, and hands
the result to the player, which probes each mirror and fails over on error.

Configure your own with any of the **12 ready URL slots**
(`ANIVERSE_SERVER_01_URL` … `ANIVERSE_SERVER_12_URL`), with
`ANIVERSE_STREAM_SERVERS` (inline JSON), or with an auto-discovered
`config/stream-servers.json`. The registry supports universal templates,
per-title templates, and exact per-episode URLs for managed platforms whose
playback ids are random. See [`docs/STREAM-SERVERS.md`](docs/STREAM-SERVERS.md),
[`docs/STREAM-SERVER-RESEARCH.md`](docs/STREAM-SERVER-RESEARCH.md), and the 12
bracketed slots in `config/stream-servers.example.json`.

**Out of the box** the registry contains five public reference streams — Mux
and Apple developer test streams plus the Blender Foundation's CC-BY open
movies via Unified Streaming — so HLS playback, failover, the proxy and room
sync are all verifiable before you plug anything in. They rank last, are
grouped and labelled as `Reference` in the UI, and switch off with
`ANIVERSE_ENABLE_REFERENCE_STREAMS=false`.

> Configure only sources you own, operate, or are licensed to distribute from.
> This repository deliberately ships no content servers and no extractors for
> third-party file hosts. For discovering where a title is legally streamable,
> the catalog surfaces AniList's official `streamingEpisodes` links and
> trailers on each episode.

## Media proxy

`/api/proxy` is the only way a browser reaches a media origin for mirrors with
`requiresProxy: true` (the default). It:

* rejects non-HTTPS URLs, credentials, non-443 ports, loopback/IP/`.local`/
  `.internal` hosts, and any host outside the allowlist;
* re-checks the allowlist on **every** redirect hop (max 3);
* rewrites nested playlist, segment, key and `EXT-X-MAP` URLs back through
  itself, resolved against the *final* URL after redirects;
* forwards only well-formed `Range` headers and preserves `Content-Range` /
  `Accept-Ranges` — but never ranges a playlist, and re-fetches one in full if
  an origin returns `206` anyway, because a truncated manifest cannot be
  rewritten;
* requests `Accept-Encoding: identity` and drops a stale `Content-Length` if
  the upstream still content-encoded the body (forwarding it truncates
  segments in the browser);
* streams segment bodies without a read timeout, while still aborting upstream
  when the client disconnects.

The allowlist is derived: `ANIVERSE_MEDIA_ALLOWED_HOSTS` **plus** the static
hostname of every configured server, so the two can never drift apart.

## Supabase setup (optional)

Watch rooms and user data are off until Supabase is configured.

1. Create a Supabase project and copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   (a legacy anon key is also accepted).
3. Apply `supabase/migrations/20260929_001_user_data_rls.sql`.
4. Configure authentication before using the user-data repository helpers.
   They call `auth.getUser()` and scope reads/writes to the verified user;
   there is no service-role client in this project.

The migration enables and forces RLS on `profiles`, `watchlists` and
`playback_history`, restricted to `authenticated` with `auth.uid()` ownership.
Broadcast rooms use private channels and a separate `realtime.messages` policy
limited to UUID-shaped room topics; anyone holding a room link can join, so
treat that link as a bearer invite and keep sensitive data out of broadcast
payloads. Disable public Realtime channel access in the project's Realtime
settings before using rooms.

## Watch-room timing

Room playhead messages use WebSocket Broadcast, peer clock-offset samples,
sequence checks and drift correction. The 10 ms figure is a **correction
target/tolerance**, not a service-level guarantee: Internet latency, queueing,
browser scheduling, device clocks, media buffering and Supabase region
placement are outside this app's control. The UI reports observed drift and
round-trip estimates; a real deployment must measure its own distribution.

## Structure

- `app/` — App Router shell plus the catalog, detail, watch, servers and proxy routes
- `components/` — discovery grid, title dialog, episode grid, server rail, player, watch room
- `core/stream.worker.ts` — off-main-thread mirror probing and failover state machine
- `hooks/` — catalog/detail/watch data loading and Realtime room lifecycle
- `lib/anime/` — AniList and Jikan clients, normalization, TTL cache, offline sample
- `lib/streams/` — server definitions, template engine, runtime registry
- `lib/supabase/` — browser/server SSR clients and user-scoped data access
- `supabase/migrations/` — PostgreSQL schema and RLS policies
- `tests/` — deterministic unit tests for parsing, registry, proxy and clock math
