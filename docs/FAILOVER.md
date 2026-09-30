# Failover: how a stream gets picked

The goal is that a viewer never sees a dead player, and never waits on a dead
server. Two mechanisms do the work: a **hedged parallel race** and a
**health-aware attempt order**.

## Why not sequential

The original worker walked the mirror list one at a time with a 7 s probe
timeout. With twelve mirrors configured, a title whose first eleven servers
were down took up to 84 seconds to reach the one that worked — and every one
of those seconds was spent idle, waiting on a timeout that had already
effectively failed.

Sequential probing makes total time proportional to *the number of broken
servers*. That is exactly backwards: adding more mirrors, which should make
playback more reliable, made it slower.

## Hedged racing

`core/stream.worker.ts` now overlaps attempts:

```
t=0ms     launch mirror A
t=350ms   A still silent  ->  launch mirror B alongside it
t=700ms   both silent     ->  launch mirror C alongside them
t=820ms   B answers 200   ->  B wins; A and C are aborted
```

* `HEDGE_DELAY_MS` (350 ms) — head start a leading probe gets before the next
  is launched beside it. A healthy mirror normally answers inside this window,
  so the common case issues exactly one request and the race costs nothing.
* `MAX_PARALLEL_PROBES` (4) — ceiling on concurrent probes, to stay polite to
  origins and to the proxy.
* `PROBE_TIMEOUT_MS` (3 s) — much tighter than before, because a slow mirror
  now costs *concurrency*, not wall-clock time.
* A failed probe frees capacity and immediately pulls the next candidate
  forward rather than waiting for the hedge timer.

Worst-case time to a playable stream is now roughly one probe timeout plus the
hedge ramp, instead of one timeout per broken mirror.

### Unprobeable mirrors

A mirror with `requiresProxy: false` is fetched cross-origin by the browser and
cannot be probed without tripping CORS. Those are held back in an
`optimistic` queue and only handed to the player once every *verifiable*
mirror has failed — at which point real media errors drive further failover.
This keeps an unverifiable mirror from winning a race it never actually ran in.

## Health memory and the circuit breaker

`lib/streams/health.ts` is pure, isomorphic and unit-tested; the worker owns
the racing, this module owns the decisions.

Per mirror it tracks successes, failures, consecutive failures, and an
exponential moving average of probe latency. From that it produces an attempt
order:

| Signal | Effect on ordering |
| --- | --- |
| Registry `priority` | The backbone. Operator intent is never silently overturned. |
| Recent failure | Cooldown: `20 s`, doubling per consecutive failure, capped at `5 min`. Pushed decisively to the back. |
| Success | Clears the cooldown immediately — the mirror just proved itself. |
| Latency EMA | Worth at most ~5 priority points, so a fast mirror wins a near tie but never jumps a wide ranking gap. |
| Viewer preference | The last server that worked is tried first — **unless** it is cooling down. |

That last exception matters: a remembered favourite that just failed is
exactly how a viewer ends up staring at the one server that is currently down,
so the circuit breaker outranks the preference. There is a test for it.

Health is remembered for the lifetime of the worker, so switching episodes
carries forward everything learned about which servers work. Records older
than `HEALTH_TTL_MS` (30 min) are treated as unknown and pruned, so the book
cannot grow without bound and a server that was down an hour ago starts clean.

## Mid-playback failover

When a server dies *during* an episode, `components/MasterPlayer.tsx`:

1. captures `video.currentTime` **before** tearing the source down (after
   `load()` the element reports `0` and the position is gone);
2. asks the worker to resume the race over the remaining candidates, excluding
   the mirror that just failed;
3. re-arms a one-shot `loadedmetadata` seek back to that position, clamped to
   the new source's duration in case another mirror carries a shorter encode.

So a failover costs a buffering pause, not a restart from episode zero.

Before that escalates to a full server switch, hls.js handles the cheaper
cases in place: a network error retries with `startLoad()`, and a media error
gets up to `MAX_MEDIA_RECOVERIES` (2) decoder recoveries.

## Viewer-visible behaviour

* While racing: *"Racing 3 servers… 9 in reserve."*
* On connect: *"Studio CDN responded in 84 ms (won a 3-way race)."*
* On switch: *"This server stopped responding; switching to the next one…"*

An explicit pick from the server rail bypasses the race entirely and is honoured
immediately — the viewer asked for that server, so it is not made to wait on a
probe.

## Tuning

All four constants live at the top of `core/stream.worker.ts`. Raising
`MAX_PARALLEL_PROBES` shortens the ramp at the cost of more simultaneous
requests; lowering `HEDGE_DELAY_MS` below your origins' typical first-byte time
will start races you did not need.
