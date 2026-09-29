# Presentation and timing notes

## Surface

- Pearl-ivory surface (`#F8FAFC`) with slow CSS mesh gradients in holographic
  lavender (`#EDE9FE`) and soft mint (`#D1FAE5`).
- Catalog cards use a CSS `perspective: 1200px` scene, cursor-normalized tilt,
  and spring physics; reduced-motion preferences disable tilt and animations.
- Posters are 2:3 portrait, matching the aspect ratio AniList and MyAnimeList
  publish. The grid is `auto-fill` so it reflows from six columns down to two
  without breakpoint-specific column counts.
- Cards carry a score badge and an airing-status pill; both are omitted rather
  than shown empty when the provider has no value.
- Skeleton cards hold layout during the first fetch, so opening the page does
  not produce a collapse-then-expand.

## Player surface

- The player dialog is a native `<dialog>` with `showModal()`, focus
  restoration, and `onCancel` wired to the close handler.
- The server rail lists **every** registry server, including ones that are not
  usable, with a status chip and measured latency. Hiding unusable servers
  would make a configuration mistake indistinguishable from a provider outage.
- The episode rail pages into blocks of 100 so a 1100-episode series stays
  navigable.
- Embedded third-party players mount in a sandboxed iframe and explicitly
  disable watch-room sync, because a cross-origin document cannot be read or
  driven by the parent page.

## Timing

- If an authorized local WebM is configured, the preview mounts as an
  absolutely stacked muted video over a fixed poster frame after a 300 ms
  hover/focus debounce; the poster remains visible until the video can play.
- Search input is debounced 350 ms before it reaches the network. Stale
  responses are discarded by request token, so fast typing cannot interleave
  two result sets.
- Mirror probes have a 6 second deadline; the proxy has a 12 second connect
  deadline that is released once a body starts streaming.
- Watch rooms exchange playback state on private Supabase Broadcast topics
  shaped as `aniverse:watch-room:<uuid>`. Room UUIDs are bearer invites. RLS
  limits topics to that exact format; profile/watchlist/history records are
  separately limited by `auth.uid()`.
- Drift correction has a 10 ms tolerance target, uses lightweight
  playback-rate changes for smaller offsets and seeks for large offsets. It is
  not a claim that end-to-end network alignment will be below 10 ms.
