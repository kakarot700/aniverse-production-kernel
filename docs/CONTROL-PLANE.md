# The streaming control plane

This project always had multi-mirror failover: a worker raced candidate URLs
and remembered which ones hurt. That worked, but the memory lived in one
browser tab. Every viewer had to rediscover every outage personally, and the
"failover" the viewer experienced was an error followed by a restart.

Both halves of that are solved problems with published specifications. This
document describes adopting them.

```
          ┌──────────────────────────────────────────────┐
          │  players (hls.js, Shaka, AVPlayer, ExoPlayer) │
          └───────┬──────────────────────────────▲───────┘
                  │ CMCD on every segment        │ Steering Manifest
                  │ (CTA-5004)                   │ (RFC 8216bis §7)
                  ▼                              │
          ┌───────────────┐              ┌───────┴────────┐
          │  /api/proxy   │─ ingest ────▶│ /api/steering  │
          └───────────────┘              └───────┬────────┘
                                                 │ reads
                                   ┌─────────────▼─────────────┐
                                   │   control plane            │
                                   │   health book + QoE book   │
                                   └────────────────────────────┘
```

The loop: clients report what they are actually experiencing, the server
models it, and the server reorders everyone's pathways. **One viewer hitting a
dying mirror now protects the next viewer from it.**

---

## CMCD — Common Media Client Data (CTA-5004)

`lib/streams/cmcd.ts`

CMCD is how a player tells the delivery layer what it is experiencing: buffer
level, measured throughput, whether it just starved, which rendition it chose.
hls.js can already *emit* it. What essentially nobody ships is the other half —
a server that *reads* it and acts. This module is both directions.

Serialization rules that are easy to get wrong, all pinned by tests:

| Rule | Why |
| --- | --- |
| Keys sorted alphabetically | Spec item 9 — a fixed order shrinks the player's fingerprinting surface |
| `true` → bare key, `false` → omitted | `bs`, not `bs=true`; a false boolean is absent, not present-and-false |
| Strings quoted and escaped, tokens bare | `sid="x"` but `ot=v` |
| `bl`/`dl`/`mtp`/`rtp` rounded to the nearest 100 | Deliberate entropy reduction, again anti-fingerprinting |
| `v=1` and `pr=1` omitted | Defaults; sending them is noise |
| Query mode URL-encodes the whole payload | Header mode does not |

We emit in **query mode**, not headers. The spec is explicit about why: a
custom header triggers a CORS preflight per unique URL from a browser, which
would roughly double the request count against every segment.

### Parsing

The receiving side is deliberately lenient in the way section 5 demands of
servers: unknown keys are kept, malformed pairs are skipped. A player sending
one bad key must not cost us the other fifteen good ones.

Two parser details that a naive implementation gets wrong:

* **Splitting on `,` is not safe.** `nor` is a URL and can contain a comma. The
  splitter tracks quote state.
* **`Number()` is too permissive.** It happily accepts `Infinity`, `0x10` and
  `1e5`, none of which are valid structured-field integers. Values are matched
  against the grammar before conversion.

CMCD is also strippable (`stripCmcd`) so it never becomes part of a cache key.

### Distress

`readDistress()` turns a report into a 0–1 severity. `bs` (the buffer ran dry)
is unambiguous and scores 1. A *low* `bl` is the leading indicator and scores
proportionally — by the time `bs` arrives the viewer has already seen a
spinner, so steering that waits for `bs` is steering that is always too late.

---

## Content Steering (RFC 8216bis §7)

`lib/streams/steering.ts`, served by `GET /api/steering`

Content Steering is the standardised form of exactly what this repo
hand-rolled: group redundant sources into **Pathways** and let a server
dynamically reprioritise them while the player is running.

Adopting it means rerouting happens *inside* the player's own controller,
mid-playback, with no reload and no lost buffer — and that any conformant
player consumes our decisions with zero bespoke client code.

```json
{
  "VERSION": 1,
  "TTL": 150,
  "PATHWAY-PRIORITY": ["reference-apple-fmp4", "reference-mux-multibitrate"],
  "RELOAD-URI": "/api/steering?_HLS_pathway=reference-apple-fmp4"
}
```

Spec rules enforced in both directions:

* A Pathway ID must match `[a-zA-Z0-9.-_]+`. Registry ids are freeform, so
  `toPathwayId()` sanitises them — a conformant player ignores an illegal id
  **silently**, which is a miserable thing to debug.
* A Pathway ID must not appear twice, and several mirrors may share a pathway,
  so the ranked list is deduped.
* A manifest must contain at least one pathway; building one without is an
  error rather than an invalid document.
* A client must *refuse* an unrecognised (higher) `VERSION`. Misinterpreting
  steering is worse than not steering.
* Unrecognised keys are ignored, never fatal.

### RELOAD-URI is a trust boundary

`resolveReloadUri()` is stricter than it first appears, for two reasons found
by testing rather than by reading:

1. **`new URL('ht!tp://:::', base)` does not throw.** An invalid scheme makes
   the whole string resolve as a *relative path*, producing
   `https://ourhost/api/ht!tp://:::`. A try/catch alone silently accepts
   garbage and then reloads steering from a URL that 404s forever.
2. **The value is destined for a `fetch`.** `javascript:` and `data:` resolve
   perfectly happily. The moment a steering manifest comes from anyone but us,
   an unchecked scheme is a real vulnerability.

So anything that looks absolute must parse as a genuine absolute URL, and the
result must be `http(s)` either way.

### Pathway cloning

`applyUriReplacement()` implements `URI-REPLACEMENT`: swap `HOST`, inject or
revoke `PARAMS`, or override a specific variant/rendition outright. This is the
part of the spec that lets a steering server invent a new CDN at runtime that
the multivariant playlist never mentioned. Replacement applies to host and
query only — never to the path.

### Adaptive TTL

300 s when everything is healthy, down to 10 s while things are unstable. Both
cooldowns (our probes failed) and distress (probes pass but viewers are
starving) count — see the bug note below.

---

## QoE — Quality of Experience

`lib/streams/qoe.ts`

A pure state machine: feed it timestamped events, get the metrics the industry
actually measures. No timers and no clock of its own, so a two-hour session
replays and asserts in a millisecond.

| Metric | Definition |
| --- | --- |
| Video start time | first frame − play intent |
| Rebuffering ratio | rebuffer ÷ (rebuffer + watch) |
| Exit before video start | session ended, no error, first frame never arrived |
| Video start failure | session ended on a fatal error, first frame never arrived |

Three things a naive implementation gets wrong:

* **A deliberate pause is not a stall.** Counting paused time as rebuffering
  makes every session look broken; counting it as watch time makes the ratio
  look artificially good. It is excluded from both.
* **A stall before the first frame is startup, not rebuffering.** Otherwise the
  same delay is charged twice — once to start time, once to the ratio.
* **Bitrate must be time-weighted.** Two hours at 3000 kbps and four seconds at
  300 kbps did not average to 1650.

`scoreSession()` collapses a session to 0–100, weighted by how the metrics
correlate with abandonment. A **recovered error costs almost nothing** on
purpose: the failover layer doing its job is a success, and penalising it would
push the system toward hiding failovers instead of performing them.

---

## Two bugs this design produced, and what they taught

### A module-level singleton silently splits in two

`getControlPlane()` is pinned to `globalThis`, which looks like defensive
boilerplate and is not. Next.js bundles each route handler separately, so
`/api/steering` and `/api/servers` importing the same module got **different
instances**. The symptom was precise and misleading: steering rerouted
correctly while the status endpoint reported all zeros. Dev-mode recompiles
discarded the state on top of that.

Caught by querying both endpoints after the same burst of reports. The fix is
the pattern the Next.js docs prescribe for a database client.

### The reroute was right and nobody heard about it for five minutes

`chooseTtlSeconds()` originally looked only at circuit-breaker cooldowns. In a
live test, twelve viewers reported starvation: the pathways reordered
correctly, and the manifest still told every client `TTL: 300`. The decision
was correct and undeliverable.

Distress now counts toward instability alongside cooldowns. Same test now
returns `TTL: 150`.

---

## Verifying it end to end

With the dev server running:

```bash
# Baseline: the highest-priority mirror leads, relaxed TTL.
curl -s localhost:3000/api/steering

# Twelve viewers report a dry buffer on the leading pathway.
for i in $(seq 1 12); do
  curl -s -o /dev/null -X POST \
    'localhost:3000/api/steering?_HLS_pathway=reference-mux-multibitrate' \
    -H 'Content-Type: text/plain' \
    --data-binary "sid=\"v$i\",bs,bl=0
sid=\"v$i\",bs,bl=0"
done

# That pathway is now last, and the TTL has halved.
curl -s localhost:3000/api/steering

# The same control plane is visible to the status endpoint.
curl -s localhost:3000/api/servers | python3 -m json.tool
```

Observed: `reference-mux-multibitrate` moves from first to last, `TTL` drops
300 → 150, and `/api/servers` reports 12 active sessions, 36 reports, 12
starved, `distress: 1.0`. Forty healthy sessions later it returns to first
with `TTL: 300` — the rolling window forgives, so a recovered CDN is not held
to a grudge.

---

## Deployment note

The control plane is process-local. A single server instance is the unit of
memory: the maps are bounded, sessions expire after five minutes idle, and
nothing identifying is retained. Across multiple instances each would steer
from its own view — correct, just less informed.

Moving to shared state is a storage swap rather than a redesign; the model is
deliberately a key/value shape (`health` book keyed by mirror id, `qoe` book
keyed by pathway id) that maps onto Redis directly.
