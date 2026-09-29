# Presentation and timing notes

- The catalog uses a pearl-ivory surface (`#F8FAFC`) with slow CSS mesh gradients in holographic lavender (`#EDE9FE`) and soft mint (`#D1FAE5`).
- Catalog cards use a CSS `perspective: 1200px` scene, cursor-normalized tilt, and spring physics; reduced-motion preferences disable tilt and animations.
- If an actual local WebM is configured, the preview mounts as an absolutely stacked muted video over a fixed 16:9 poster frame after a 300 ms hover/focus debounce; the poster remains visible until the video can play. The supplied archive has no clips, so its catalog currently stays poster-only.
- Watch rooms exchange playback state on private Supabase Broadcast topics shaped as `aniverse:watch-room:<uuid>`. Room UUIDs are bearer invites. RLS limits topics to that exact format; profile/watchlist/history records are separately limited by `auth.uid()`.
- Drift correction has a 10 ms tolerance target, uses lightweight playback-rate changes for smaller offsets and seeks for large offsets. It is not a claim that end-to-end network alignment will be below 10 ms.
