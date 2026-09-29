# Reference sources

## Metadata providers

- **AniList GraphQL API** — <https://docs.anilist.co/>. Public, no API key.
  Used for `Page(media:)` browsing/search, `Media(id:)` detail,
  `GenreCollection`, and `externalLinks` (the "Watch officially" rail). Rate
  limited per IP; every query in `lib/anime/anilist.ts` is cached in-process
  and bounded by an 8 s timeout.
- **Jikan v4 (unofficial MyAnimeList API)** — <https://docs.api.jikan.moe/>.
  Public, no API key, ~3 requests/second. Used as the automatic fallback in
  `lib/anime/jikan.ts`, with request spacing and cached genre-id lookups.

Both are third-party services this project does not control. The bundled
offline seed exists precisely so their availability is not a hard dependency.

## Reference streams

- **Mux public HLS test streams** (`test-streams.mux.dev`) carry Blender
  Foundation open movies — *Big Buck Bunny* and *Tears of Steel* — released
  under **CC-BY 3.0**. They back the `open-cinema` server so the delivery path
  can be verified without shipping anyone else's copyrighted video.

## Supabase

Documentation reviewed on 2026-09-29:

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
- [Passwordless email logins](https://supabase.com/docs/guides/auth/auth-email-passwordless) —
  `signInWithOtp` sends a magic link; `emailRedirectTo` must be an allowed
  redirect URL in the project's auth settings.
- [Next.js Supabase quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs) —
  the App Router setup uses `@supabase/ssr` and public project URL/key
  environment settings.

These sources inform the code paths and SQL migration in this project. They do
not verify a live Supabase project, credentials, deployed Realtime settings, or
actual network delivery.
