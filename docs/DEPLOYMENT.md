# Deployment checklist

## Runtime

- Use a Node.js server runtime. The HLS proxy, catalog, and poster routes are
  Node route handlers; do not publish this app as a static export.
- The home page is server-rendered with `revalidate = 60`. Catalog and server
  routes are `force-dynamic`.

## Catalog providers

- No API key is required. AniList and Jikan are public; the bundled offline
  seed needs no network at all.
- Allow outbound HTTPS to `graphql.anilist.co` and `api.jikan.moe`. If egress
  is blocked, the app silently degrades to the offline catalog and surfaces a
  `degraded` banner.
- Both providers rate-limit. Responses are cached in-process (5 min browse,
  15 min detail, 1 h genres). Behind multiple instances, consider a shared
  cache or a CDN in front of `/api/catalog`.

## Stream servers

- Set `ANIVERSE_MEDIA_ALLOWED_HOSTS` to approved media origins only, and
  enforce outbound network controls at the host/provider layer as well.
- Configure each server you intend to use with `ANIVERSE_SERVER_<ID>`, and
  supply an episode → file source map via `ANIVERSE_SOURCE_MAP_URL` or
  `ANIVERSE_SOURCE_MAP_INLINE`. See `docs/SERVERS.md`.
- Set `ANIVERSE_ENABLE_REFERENCE_STREAMS=false` (or leave it unset, which is
  the production default) once you are serving your own catalog. The
  Creative-Commons reference streams exist to validate the pipeline, not to
  ship to users.
- Verify with `GET /api/servers`: it reports enabled/configured/allowlisted
  state per server and the exact variable to set next. No secrets are exposed.
- Configure only sources you own or are licensed to distribute.

## Security headers

- Set `ANIVERSE_FRAME_ANCESTORS` in production (e.g. `'self'`) to enable a CSP
  `frame-ancestors` clickjacking policy. It is intentionally unset by default
  so hosted preview environments can iframe the dev server.
- `X-Content-Type-Options: nosniff` and `Referrer-Policy` are always applied.

## Supabase

- Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` at
  build/runtime when enabling Supabase.
- Apply the included migration and disable public Realtime channel access in
  Supabase Realtime settings, so clients must join private channels and pass
  the `realtime.messages` policies.
- Keep service-role keys, source tokens, and private credentials off client
  components and out of the repository.
- The middleware deliberately does **not** run on `/api/*`. Refreshing the
  session on every proxied media segment added a network round trip several
  times per second during playback.

## Assets

- `public/posters/` ships no artwork. Real titles use provider CDN images; the
  offline catalog renders SVG covers through `/api/poster`.
- If adding hover previews, use authorized WebM clips under `public/previews/`
  and set only their same-origin `/previews/<slug>.webm` paths.

## Verification

- Measure actual room drift and tail latency in the target region/device/
  network mix. Local unit tests validate clock math, not WebSocket delivery or
  real-world synchronization.
- `npm audit` currently reports a `postcss` advisory reachable only through
  `next@15.5.26`. Resolving it requires a `next@16` major upgrade.
