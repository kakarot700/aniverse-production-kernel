# Presentation and timing notes

- The shell uses a pearl-ivory surface (`#F8FAFC`) with slow CSS mesh gradients
  in holographic lavender (`#EDE9FE`) and soft mint (`#D1FAE5`).
- Catalog cards are 2:3 portrait frames sized for real anime cover art, laid
  out on an `auto-fill` grid so the column count follows the viewport instead
  of a fixed breakpoint ladder. Each card uses a CSS `perspective: 1200px`
  scene, cursor-normalized tilt and spring physics; reduced-motion preferences
  disable tilt and animation.
- Remote artwork degrades gracefully: a failed cover swaps to a bundled poster
  via `onError`, and the loading state renders shimmer skeletons at the same
  aspect ratio so the grid never reflows.
- Title dialogs stack a banner, metadata, the player, the server rail and the
  episode grid in one scroll column with the watch-room panel beside it. Body
  scroll is locked while the dialog is open and focus returns to the trigger on
  close.
- The server rail groups mirrors by tier (`Licensed`, `Self-hosted`,
  `Reference`) and marks language, quality, container and whether the mirror is
  proxied or direct, so a viewer can see why a source was chosen.
- Episode lists switch presentation by content: numbered chips for shows whose
  episodes have no published titles, a titled list when they do, and blocks of
  100 for long runs.
- Watch rooms exchange playback state on private Supabase Broadcast topics
  shaped as `aniverse:watch-room:<uuid>`. Room UUIDs are bearer invites. RLS
  limits topics to that exact format; profile/watchlist/history records are
  separately limited by `auth.uid()`.
- Drift correction has a 10 ms tolerance target, uses bounded playback-rate
  changes for small offsets and seeks for large ones. Publishing is driven by
  play/pause/seek events plus a 4 s heartbeat rather than every `timeupdate`,
  and a short suppression window after applying a remote correction stops two
  clients echoing each other. It is not a claim that end-to-end network
  alignment will be below 10 ms.
