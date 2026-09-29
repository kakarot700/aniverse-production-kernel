# Aniverse Production Kernel

A Next.js 15 App Router application for browsing the full anime catalog,
playing HLS through a configurable multi-server delivery path, and watching in
sync with someone else over Supabase Realtime.

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

A fresh clone works with **no configuration at all**: the catalog falls back
through AniList → Jikan → a bundled offline dataset, and the open-tier
`open-cinema` server streams Creative-Commons reference video so playback,
failover, and room sync are verifiable immediately.

## Catalog

Metadata comes from a three-step provider chain, each step best-effort:

| Provider | Role | Notes |
| --- | --- | --- |
| **AniList** (GraphQL) | primary | ~21k titles, no API key, official artwork, episode lists, licensed-streaming links |
| **Jikan** (MyAnimeList v4) | fallback | used when AniList errors, rate-limits, or times out |
| **Offline seed** | last resort | bundled real-anime dataset with locally generated SVG covers |

A provider failure downgrades to the next one and reports a `degraded` note
the UI shows as a banner, rather than producing an error page.

Search, genre/format filters, five sort orders, and paging all run against the
full database. See [docs/CATALOG.md](docs/CATALOG.md) for the API surface.

## Stream servers

`lib/servers/registry.ts` holds a fixed registry of streaming providers. Each
entry is a **slot** — an id, a display name, a host, and a URL shape — filled
at request time from your configuration and source map.

Thirteen servers ship in four tiers:

- **Open** — `Aniverse Origin` (your own licensed HLS origin) and
  `Open Cinema (CC-BY)` (Creative-Commons reference streams, zero config).
- **Premium** — Vidstream / Vidplay, MyCloud (MCloud), Filemoon.
- **Scaled** — DoodStream, Streamtape, Voe.sx, Streamwish, Vidhide.
- **Legacy** — Mp4Upload, Netu.tv, Mixdrop.

Every server produces exactly one mirror slot per episode with an honest
status — `ready`, `unmapped`, `unconfigured`, `disabled`, or `blocked` — so the
UI shows the complete list instead of hiding servers that are not usable yet.
`GET /api/servers` reports the live state and the exact environment variable to
set next.

> Aniverse does not scrape or reverse-engineer third-party players to discover
> stream URLs. You supply an episode → file source map for content you are
> authorized to distribute. Format and configuration:
> **[docs/SERVERS.md](docs/SERVERS.md)**.

Playback runs through `/api/proxy`, which enforces an HTTPS allowlist, rejects
redirects to non-allowlisted hosts, and rewrites nested playlist, segment, and
key URLs back through the same origin. `core/stream.worker.ts` probes mirrors
off the main thread with a 6 second deadline, reports per-server latency, and
fails over automatically.

## Supabase setup

1. Create a Supabase project and copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   (a legacy anon key is also accepted).
3. Apply `supabase/migrations/20260929_001_user_data_rls.sql`.
4. Configure authentication before using the user-data repository helpers.
   They call `auth.getUser()` and scope reads/writes to the verified user;
   there is no service-role client in this project.

The migration enables and forces RLS on `profiles`, `watchlists`, and
`playback_history`. Policies and grants are restricted to `authenticated` and
require `auth.uid()` ownership. Anonymous access is not granted.

Broadcast rooms use private channels and a separate `realtime.messages` policy
restricted to UUID-shaped room topics. Anyone holding a room link can join, so
treat that link as a bearer invite and do not put sensitive data in broadcast
payloads. Disable public Realtime channel access in the project's Realtime
settings before using rooms.

## Watch-room timing

Room playhead messages use WebSocket Broadcast, peer clock-offset samples,
sequence checks, and drift correction. The 10 ms figure is a **correction
target/tolerance**, not a service-level guarantee: Internet latency, queueing,
browser scheduling, device clocks, media buffering, and Supabase region
placement are outside this app's control. The UI reports observed drift and
round-trip estimates; a real deployment must measure its own distribution.

Sync requires an HLS or progressive server. A cross-origin embedded player
cannot be read or driven by the parent page, and the panel says so explicitly
when one is selected.

## Structure

- `app/` — App Router shell; catalog, detail, servers, genres, poster, and
  proxy route handlers
- `components/` — discovery grid, cards, player, server rail, episode rail,
  watch-room controls
- `core/` — dedicated worker for bounded mirror probing and failover
- `hooks/` — paged catalog reader, Realtime room lifecycle and playhead sync
- `lib/anime/` — AniList / Jikan / offline providers, normalisation, caching
- `lib/servers/` — server registry, runtime config, source map, resolver
- `lib/supabase/` — browser/server SSR clients and user-scoped data access
- `supabase/migrations/` — PostgreSQL schema and RLS policies
- `tests/` — deterministic parsing, resolver, catalog, poster, and clock tests

## Documentation

- [docs/SERVERS.md](docs/SERVERS.md) — server registry, source map, failover
- [docs/CATALOG.md](docs/CATALOG.md) — provider chain and API endpoints
- [docs/BUGFIXES.md](docs/BUGFIXES.md) — what was broken and how it was fixed
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deployment checklist
- [docs/ROOM-SYNC.md](docs/ROOM-SYNC.md) — synchronisation model and limits
- [docs/PREVIEW-ASSETS.md](docs/PREVIEW-ASSETS.md) — optional hover previews
