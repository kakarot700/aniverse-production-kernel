# Aniverse Production Kernel

An independent Next.js 15 App Router starter for a light, editorial animation catalog, HLS playback, and optional Supabase-backed user data / watch-room sync. The existing NEXUS project is not part of this package.

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

The archive includes poster artwork but no video clips. The catalog is intentionally poster-only until a real, owned/licensed WebM preview is added; `previewUrl` is optional, and the card keeps the poster without requesting a missing file when it is omitted. When a valid `/previews/<slug>.webm` is supplied, the muted looping preview mounts after a 300 ms hover/focus debounce while preserving the same poster frame. The catalog also has no HLS mirror URLs, so playback is clearly shown as unconfigured rather than claiming that a stream is available.

## Supabase setup

1. Create a Supabase project and copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (a legacy anon key is also accepted).
3. Apply `supabase/migrations/20260929_001_user_data_rls.sql` in the project SQL editor or through your migration runner.
4. Configure authentication in Supabase before using the user-data repository helpers. They call `auth.getUser()` and scope reads/writes to the verified user; there is no service-role client in this project.

The migration enables and forces RLS on `profiles`, `watchlists`, and `playback_history`. Policies and grants are restricted to `authenticated` and require `auth.uid()` ownership. Anonymous access is not granted. Broadcast rooms use private channels and a separate `realtime.messages` policy restricted to UUID-shaped room topics; anyone holding a room link can join, so treat that link as a bearer invite and do not put sensitive data in broadcast payloads. Disable public Realtime channel access in the project’s Realtime settings before using rooms.

## Authorized HLS sources

The proxy rejects non-HTTPS URLs and any hostname not matched by `ANIVERSE_MEDIA_ALLOWED_HOSTS`. Use exact hostnames where practical; wildcard entries must be written as `*.example.com`. It rejects redirects to non-allowlisted hosts and rewrites nested playlist/segment/key URLs back through the same-origin proxy. Configure only sources you own or are authorized to access. For high-assurance deployment, pair the application allowlist with network egress restrictions and provider-specific rate limits.

Catalog mirror URLs should be supplied by the application’s trusted catalog source; never accept arbitrary user-submitted mirror URLs. The proxy does not strip content from manifests.

## Watch-room timing

Room playhead messages use WebSocket Broadcast, peer clock-offset samples, sequence checks, and drift correction. The 10 ms figure is a **correction target/tolerance**, not a service-level guarantee: Internet latency, queueing, browser scheduling, device clocks, media buffering, and Supabase region placement are outside this app’s control. The UI reports observed drift/round-trip estimates when available; a real deployment must measure its own end-to-end distribution.

## Structure

- `app/`: App Router shell and catalog/proxy routes
- `components/`: discovery UI, preview cards, player and watch-room controls
- `core/`: dedicated worker for bounded mirror probing and failover
- `hooks/`: Realtime room lifecycle and playhead synchronization
- `lib/supabase/`: browser/server SSR clients and user-scoped data access
- `supabase/migrations/`: PostgreSQL schema and RLS policies
- `tests/`: deterministic parsing and clock math tests
