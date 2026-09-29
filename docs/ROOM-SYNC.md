# Watch-room synchronization

## What is exchanged

Each client joins a private Supabase Broadcast channel named after the room
UUID and exchanges two message types:

* **Playback snapshots** — sender peer id, a monotonic sequence number, the
  playhead position in seconds, whether the video is playing, the playback
  rate, and the wall-clock send timestamp.
* **Clock ping/pong** — a four-timestamp exchange (`localSentAt`,
  `peerReceivedAt`, `peerSentAt`, `localReceivedAt`) used to estimate the
  offset between the two machines' clocks.

## When a snapshot is published

Snapshots are **event-driven, not continuous**. A publish happens on `play`,
`pause`, `seeked` and `ratechange`, plus a 4 s heartbeat while the video is
playing (`HEARTBEAT_MS`). An earlier revision published on every `timeupdate`,
which fires 4–66 times a second per client and flooded the channel with
redundant state; the heartbeat carries the same information at a fixed cost.

Two guards keep clients from echoing each other:

* `MIN_PUBLISH_GAP_MS` (180 ms) throttles non-forced publishes.
* `REMOTE_APPLY_WINDOW_MS` (120 ms) suppresses the local publisher while a
  remote correction is being applied, so applying a peer's seek does not
  immediately re-broadcast that seek back. This is a single timestamp
  (`suppressUntilRef`), not a timer — overlapping corrections extend the
  window instead of the earlier one clearing it early.

Snapshots older than the last sequence seen from that peer are dropped, so
out-of-order delivery cannot rewind a room.

## Clock offset estimation

`estimatePeerClockOffset` turns each ping/pong into an `{ offsetMs, rttMs }`
sample. The last 7 samples per peer are kept. The estimate used is the median
of the **three lowest-RTT** samples, which resists jitter spikes — a sample
delayed by a congestion burst carries a badly skewed offset, and low RTT is
the cheapest available proxy for "this exchange was not delayed".

## Applying a correction

`predictPlayheadSeconds` advances the peer's reported position by the time
elapsed since they sent it, corrected by the clock offset, so the target is
where the peer *is now* rather than where they were. `planPlaybackCorrection`
then picks one of three actions against a tolerance (default 10 ms):

| Drift | Action |
| --- | --- |
| within tolerance | nothing; reset `playbackRate` to 1 if it was nudged |
| moderate | bounded `playbackRate` nudge, reset to 1 after 1.5 s |
| large | seek, clamped to `duration - 0.03` so it cannot run off the end |

Play/pause state is applied after the position correction. If the browser
blocks autoplay the room surfaces a message rather than silently desyncing.

The pure functions live in `lib/watch-sync.ts` and are unit-tested in
`tests/watch-sync.test.ts`; the React glue lives in `hooks/useWatchRoom.ts`.

## Element lifetime

The hook resolves `videoRef.current` **at event time**, not once at listener
setup. The player remounts its `<video>` when the mirror or episode changes,
and an earlier revision captured the first element and then silently
synchronized a detached node for the rest of the session.

## Limits and honest caveats

The 10 ms figure is an **algorithmic correction tolerance, not a demonstrated
end-to-end synchronization guarantee.** What a viewer actually perceives is
subject to WebSocket delivery, browser and device timers, decode/render
pipeline latency, network RTT and jitter, congestion, and the physical
distance to the Supabase region.

Validate with at least two real clients in the intended deployment region and
report measured median and tail drift before making any performance claim.

Room links are **bearer invites**: anyone holding the UUID can join. They are
random v4 UUIDs, but there is no per-room authorization beyond that. Do not
put sensitive data in a room, and see `docs/DEPLOYMENT.md` for the RLS
policies that must be enabled on `realtime.messages` before this is exposed
publicly.
