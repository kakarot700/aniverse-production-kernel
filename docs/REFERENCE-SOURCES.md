# Reference sources

## Catalog APIs

- [AniList API v2 (GraphQL) documentation](https://docs.anilist.co/) — public,
  unauthenticated GraphQL endpoint at `https://graphql.anilist.co`; `Page`
  supports `pageInfo` plus `media(type: ANIME, …)` filtering by `search`,
  `genre`, `season`, `seasonYear`, `format`, `status` and `sort`; `Media`
  exposes `streamingEpisodes`, `nextAiringEpisode`, `relations` and `trailer`.
  Per-IP rate limits apply, so responses are cached and coalesced here.
- [Jikan v4 (unofficial MyAnimeList REST API)](https://docs.api.jikan.moe/) —
  used as the secondary source: `/anime`, `/top/anime`, `/seasons/{year}/{season}`,
  `/seasons/now`, `/anime/{id}/full` and `/anime/{id}/episodes`.

Both are third-party services with their own terms and rate limits. Credit
them in the UI, keep request volume reasonable, and do not mirror their
databases wholesale.

## Reference media streams

The bundled reference servers point at demo assets their owners publish for
integration testing:

- Mux public test streams (`test-streams.mux.dev`, `stream.mux.com`).
- Apple's HLS example streams (`devstreaming-cdn.apple.com`).
- Unified Streaming's public demo of *Tears of Steel*
  (`demo.unified-streaming.com`) — Blender Foundation, CC-BY.
- Google-hosted *Big Buck Bunny* MP4
  (`commondatastorage.googleapis.com/gtv-videos-bucket`) — Blender Foundation,
  CC-BY.

They exist to verify HLS playback, failover, the proxy and room sync. They are
not anime and are not a content source.

## Supabase

Supabase documentation reviewed on 2026-09-29:

- [Creating a Supabase client for SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client) —
  server and browser clients use public project configuration; the Next.js
  server client reads/writes cookie sessions via `getAll`/`setAll`; call an
  auth claims method in the request lifecycle before returning a response so
  refreshed cookies and no-cache headers are preserved.
- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) —
  private Realtime channel access is controlled by RLS policies on
  `realtime.messages`; topic and extension checks can narrow policies.
  Production must disable public channel access in project Realtime settings.
- [Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast) —
  clients use private channels, listen for named Broadcast events, and publish
  via the channel `send` API.
- [Next.js Supabase quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs) —
  the App Router setup uses `@supabase/ssr` and public project URL/key
  environment settings.

These sources inform the code paths and the SQL migration. They do not verify
a live Supabase project, credentials, deployed Realtime settings, or actual
network delivery.
