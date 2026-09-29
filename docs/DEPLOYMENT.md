# Deployment checklist

- Use a Node.js server runtime (the HLS proxy uses a Node route handler); do not publish this app as a static export.
- Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` at build/runtime when enabling Supabase.
- Apply the included migration and disable public Realtime channel access in Supabase Realtime settings so clients must join private channels and pass the `realtime.messages` policies.
- Set `ANIVERSE_MEDIA_ALLOWED_HOSTS` only to approved media origins. Also enforce outbound network controls at the host/provider layer for defense in depth.
- Keep service-role keys, source tokens, and private credentials off client components and out of the repository.
- The supplied archive contains poster images only. If adding hover previews, use real authorized WebM clips under `public/previews/` and set only their same-origin `/previews/<slug>.webm` paths in the catalog; no generated or transcoded clips are included.
- The sample catalog has no HLS mirrors. Playback needs authorized catalog mirror URLs plus matching allowlisted hosts.
- Measure actual room drift and tail latency in the target region/device/network mix; local unit tests validate clock math, not WebSocket delivery or real-world synchronization.
