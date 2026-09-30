# Advanced features

## Skip intro / skip outro (AniSkip)

`types/media.ts` has carried a `SkipTimestamps` shape since the first
revision and nothing ever filled it, so the player's skip button could never
appear. It is now populated from [AniSkip](https://api.aniskip.com/api-docs),
the crowd-sourced opening/ending index.

```
GET https://api.aniskip.com/v2/skip-times/{malId}/{episode}
    ?types=op&types=ed&types=recap&episodeLength={seconds}
```

Three things about that contract shape the implementation:

* **`episodeLength` is mandatory.** Omitting it returns `400`, and a value far
  from the real runtime returns `404` even for an indexed episode — AniSkip
  filters its index by proximity to the runtime you claim. So the lookup stays
  dormant until the player reports a duration, and the request key rounds the
  duration to 5 s so ordinary jitter does not re-request.
* **`404` is the normal answer.** Most episodes are not indexed. It is cached
  as a negative result rather than retried.
* **`mixed-op` is deliberately not requested.** An opening overlaid on story
  content is not a clean skip boundary; skipping it loses plot.

Normalisation rules (all unit tested in `tests/aniskip.test.ts`):

| Situation | Behaviour |
| --- | --- |
| `op` + `ed` | Straight mapping to intro / outro |
| `recap` but no `op` | The recap becomes the intro — both are "skippable material at the front" |
| Both `op` and `recap` | The real opening wins |
| Several `ed` entries | The **latest** wins; that is the real credits roll |
| Interval past the episode end | Dropped as stale data from a different cut |
| Interval overrunning the end | Clamped to the duration |
| Shorter than 3 s, inverted, non-numeric, or an "opening" over 3 min | Dropped |

`GET /api/skip/:malId/:episode?length=` caches results for 12 h in-process and
a day at the CDN, so the lookup is shared across viewers. The browser falls
back to calling AniSkip directly if this server has no outbound network —
the same degradation path the catalog already uses.

**Auto-skip** is a player toggle, remembered in `localStorage`. It jumps once
per segment: a viewer who deliberately seeks back into the opening is not
fought by the player.

## Recommendations

`lib/recommendations.ts` builds a taste profile from local history and scores
catalog titles against it. It runs entirely in the browser — nothing about
viewing habits is transmitted anywhere.

The score is a weighted overlap, not a black box:

| Signal | Weight | Notes |
| --- | --- | --- |
| Genre | 1.0 | Normalised by `√(candidate genre count)` |
| Studio | 0.6 | Also drives the "…· Studio A" reason text |
| Format | 0.25 | **Boost only** — never qualifies a title on its own |
| Recency | ×`2^(-age / 14 days)` | A two-week half life |
| A saved-but-unwatched title | ×0.5 | A weaker signal than something actually watched |
| Rating | ±~4% | A gentle nudge so equal matches are not ordered arbitrarily |

Two rules matter more than the weights:

* **Genre-count normalisation.** Without it, a title tagged with fifteen
  genres outranks a focused match purely by carpet-bombing the profile.
* **Format never qualifies.** "This is also a TV series" says nothing about
  taste. A candidate must match on genre or studio to be eligible at all;
  format only boosts something already eligible.

Watched and saved titles are never recommended back, and adult titles are
filtered regardless of match. Every recommendation carries a human-readable
`reason` so the row can explain itself.

## Playback statistics overlay

A **Stats** toggle in the player toolbar shows live telemetry: the winning
server and its probe latency, current resolution and bitrate, buffer ahead of
the playhead, dropped frames, and the number of renditions in the ladder.

Sampling runs on a 1 s interval **only while the overlay is open**, so it stays
off the hot path when nobody is looking. It is the fastest way to tell whether
a stutter is the network, the CDN, or the decoder.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` / `K` | Play / pause |
| `←` / `→` | ∓5 s |
| `J` / `L` | ∓10 s |
| `↑` / `↓` | Volume |
| `M` | Mute |
| `F` | Fullscreen |
| `0`–`9` | Jump to that tenth of the episode |

Guarded against firing while typing in an input, textarea, select or
contenteditable — the player lives in a modal, so a document-level listener is
safe, but scrubbing the video while someone types in the search box is not.

## Next-episode prefetch

2.5 s after an episode settles, the next episode's server list is warmed in the
background so pressing "next" resolves instantly. Fire-and-forget: a failure
costs nothing because the real request runs normally.

## Persisted preferences

| Key | Holds |
| --- | --- |
| `aniverse:preferred-server` | Last server that worked; tried first unless in cooldown |
| `aniverse:volume` | Volume and mute |
| `aniverse:auto-skip` | Auto-skip on/off |
| `aniverse:library:v1` | Continue-watching and watchlist, synced across tabs |
