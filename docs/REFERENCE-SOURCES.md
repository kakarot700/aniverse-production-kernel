# Reference sources

Supabase documentation reviewed on 2026-09-29:

- [Creating a Supabase client for SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client) — server and browser clients use public project configuration; the Next.js server client reads/writes cookie sessions via `getAll`/`setAll`; call an auth claims method in the request lifecycle before returning a response so refreshed cookies and no-cache headers are preserved.
- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) — private Realtime channel access is controlled by RLS policies on `realtime.messages`; topic and extension checks can narrow policies. Production must disable public channel access in project Realtime settings.
- [Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast) — clients use private channels, listen for named Broadcast events, and publish via the channel `send` API.
- [Next.js Supabase quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs) — the App Router setup uses `@supabase/ssr` and public project URL/key environment settings.

These sources inform the code paths and SQL migration in this starter. They do not verify a live Supabase project, credentials, deployed Realtime settings, or actual network delivery.
