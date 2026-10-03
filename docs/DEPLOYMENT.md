# Deployment checklist

## Runtime

- Use a Node.js server runtime. The media proxy and every catalog route are
  Node route handlers; do not publish this app as a static export.
- The home page is `force-dynamic` and the catalog routes send
  `s-maxage`/`stale-while-revalidate`, so put a CDN in front of
  `/api/catalog` and `/api/anime/*` if you expect traffic. `/api/watch/*` and
  `/api/proxy` are `private` and must not be shared between users.

## Catalog sources

- No credentials are required. AniList and Jikan are public.
- The in-process TTL cache (5 min for catalog pages, 30 min for details) plus
  request coalescing covers a single instance; add a shared cache or CDN for
  multi-instance deployments.
- Outbound HTTPS to `graphql.anilist.co` and `api.jikan.moe` must be allowed
  from the server. Without it the catalog reports `degraded: true` and only
  browsers that can reach AniList themselves will see the full library.
- Artwork is hot-linked from `s4.anilist.co` and `cdn.myanimelist.net`. If you
  enforce a CSP, allow those in `img-src`.

## Stream servers

- Add stream origins in `config/stream-servers.json` (auto-detected, has ready
  brackets), or use
  the `ANIVERSE_SERVER_01_URL` … `ANIVERSE_SERVER_12_URL` quick slots,
  `ANIVERSE_STREAM_SERVERS`, or `ANIVERSE_STREAM_SERVERS_FILE`. See
  `docs/STREAM-SERVERS.md`.
- Set `ANIVERSE_ENABLE_REFERENCE_STREAMS=false` once real servers exist so the
  public test streams stop appearing in the server rail.
- Verify with `GET /api/servers`: `config.issues` must be empty and
  `config.allowedProxyHosts` must list exactly the origins you expect.
- `ANIVERSE_MEDIA_ALLOWED_HOSTS` is only needed for hosts a template cannot
  express (for example a redirect target on a different CDN). Server hosts are
  added to the allowlist automatically.
- Pair the application allowlist with network egress restrictions and
  provider-side rate limits. The proxy blocks literal IPs, loopback and
  `.local`/`.internal` names, but it cannot see a DNS rebind on its own.

## Supabase (optional)

- Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` at
  build/runtime when enabling rooms or user data.
- Apply the included migration and disable public Realtime channel access in
  Supabase Realtime settings so clients must join private channels and pass the
  `realtime.messages` policies.
- Keep service-role keys, source tokens and private credentials off client
  components and out of the repository.

## Security headers

- `next.config.ts` sets `X-Content-Type-Options` and `Referrer-Policy`
  globally and deliberately does **not** set `X-Frame-Options`, so hosted dev
  previews stay embeddable. Add a `frame-ancestors` CSP at your edge/CDN for
  production clickjacking protection.

## Measuring room sync

Measure actual room drift and tail latency in the target region/device/network
mix. The unit tests validate clock math, not WebSocket delivery or real-world
synchronization.
