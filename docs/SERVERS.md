# Stream servers

Aniverse ships a **server registry** (`lib/servers/registry.ts`): a fixed list
of streaming providers, each with a stable id, a display name, a canonical
host, and the URL shape that provider uses.

A registry entry is a *slot*, not a stream. Slots are filled at request time by
`lib/servers/resolve.ts`, which combines:

1. **Runtime config** — is this server enabled, and what base URL does it use?
2. **The source map** — which file id / manifest URL does this server hold for
   this specific episode?
3. **The proxy allowlist** — may `/api/proxy` fetch from that host?

Every server always produces exactly one mirror slot per episode, with an
honest status, so the UI can show the full list instead of silently hiding
servers that are not usable yet.

## What changed, and why

The previous build hardcoded eleven mirrors whose `manifestUrl` was the
provider's **homepage**:

```ts
{ serverName: 'Filemoon', manifestUrl: 'https://filemoon.sx', requiresProxy: true }
```

That can never play. `/api/proxy` fetches the URL and requires the body to
start with `#EXTM3U`; a homepage returns HTML, so the proxy answered `502` and
the failover worker marked the mirror dead. All eleven failed on every request,
100% of the time — the player only ever showed "All configured stream mirrors
are unavailable."

**No server was removed.** All eleven are still in the registry, plus two
open-tier additions. What changed is that they now resolve through real
configuration instead of a URL that could not work.

## The eleven original servers

| Tier | Server | id | Kind | Host |
| --- | --- | --- | --- | --- |
| Premium | Vidstream / Vidplay | `vidplay` | embed | `vidplay.online` |
| Premium | MyCloud (MCloud) | `mcloud` | embed | `mcloud.to` |
| Premium | Filemoon | `filemoon` | embed | `filemoon.sx` |
| Scaled | DoodStream Node | `doodstream` | embed | `doodstream.com` |
| Scaled | Streamtape Mirror | `streamtape` | embed | `streamtape.com` |
| Scaled | Voe.sx Cluster | `voe` | embed | `voe.sx` |
| Scaled | Streamwish Node | `streamwish` | embed | `streamwish.to` |
| Scaled | Vidhide Secure Node | `vidhide` | embed | `vidhide.com` |
| Legacy | Mp4Upload High-Bitrate | `mp4upload` | embed | `mp4upload.com` |
| Legacy | Netu.tv Resilient Core | `netu` | embed | `netu.io` |
| Legacy | Mixdrop Alternative Path | `mixdrop` | embed | `mixdrop.co` |

Plus the open tier, which needs no third-party configuration:

| Tier | Server | id | Kind | Host |
| --- | --- | --- | --- | --- |
| Open | Aniverse Origin | `aniverse-origin` | hls | *your origin* |
| Open | Open Cinema (CC-BY) | `open-cinema` | hls | `test-streams.mux.dev` |

`tests/servers.test.ts` asserts every original server name is still present, so
a future refactor cannot drop one by accident.

## Mirror statuses

| Status | Meaning | Fix |
| --- | --- | --- |
| `ready` | Resolved and attachable | — |
| `unmapped` | Server is configured, but this episode has no source-map entry | Add the episode to your source map |
| `unconfigured` | No base URL for this server | Set `ANIVERSE_SERVER_<ID>` |
| `disabled` | Switched off by the operator | Remove it from `ANIVERSE_SERVERS_DISABLED` |
| `blocked` | Resolved, but its host is not on the proxy allowlist | Add the host to `ANIVERSE_MEDIA_ALLOWED_HOSTS` |

`GET /api/servers` reports all of this live, including the exact environment
variable to set next. Check it first when a server is not lighting up.

## Delivery kinds

- **`hls`** — an `.m3u8` manifest. Fetched through `/api/proxy`, which rewrites
  nested playlist/segment/key URLs back through the same origin, then played by
  hls.js. Supports the watch-room, the failover worker, and drift correction.
- **`progressive`** — a direct `.mp4`/`.webm`. Same proxy path, played natively.
- **`embed`** — the provider's own player page, mounted in a sandboxed iframe.
  Not proxied, not probeable, and **not** synchronised by the watch-room: the
  parent page cannot read or control a cross-origin `<video>`.

The kind is inferred from the resolved URL's extension, falling back to the
registry default. A source map entry pointing at an `.m3u8` on `filemoon` will
be treated as HLS, not as an embed.

## Configuration

| Variable | Purpose |
| --- | --- |
| `ANIVERSE_SERVER_<ID>` | https base origin for that server (`-` → `_`, uppercased). Example: `ANIVERSE_SERVER_FILEMOON=https://filemoon.sx` |
| `ANIVERSE_SERVERS_DISABLED` | Comma-separated server ids to switch off |
| `ANIVERSE_SOURCE_MAP_URL` | https endpoint returning the source map |
| `ANIVERSE_SOURCE_MAP_INLINE` | Inline JSON source map |
| `ANIVERSE_MEDIA_ALLOWED_HOSTS` | Proxy allowlist (exact host, or `*.example.com`) |
| `ANIVERSE_MEDIA_USER_AGENT` | `User-Agent` sent upstream, for CDNs that require one |
| `ANIVERSE_MEDIA_REFERER` | `Referer`/`Origin` sent upstream, for hotlink-protected origins |
| `ANIVERSE_ENABLE_REFERENCE_STREAMS` | Force the CC reference streams on/off (default: on outside production) |

Only `https` base URLs are accepted; an `http://` override is ignored and the
server falls back to its canonical host.

## The source map

Aniverse **does not scrape or reverse-engineer third-party players** to
discover stream URLs. You supply the mapping, for content you are authorised to
distribute, and the app resolves it.

```json
{
  "version": 1,
  "entries": {
    "anilist:16498": {
      "1": [
        {
          "server": "aniverse-origin",
          "url": "https://cdn.example.com/aot/01/master.m3u8",
          "quality": "1080p",
          "audio": "sub"
        },
        { "server": "filemoon", "fileId": "k2m9xq1p", "quality": "720p" }
      ],
      "2": [{ "server": "aniverse-origin", "url": "https://cdn.example.com/aot/02/master.m3u8" }]
    }
  }
}
```

Entries may also carry intro/outro markers, which surface as a **Skip intro** /
**Skip outro** button over the player:

```json
{
  "server": "aniverse-origin",
  "url": "https://cdn.example.com/aot/01/master.m3u8",
  "skip": { "introStart": 0, "introEnd": 90, "outroStart": 1320, "outroEnd": 1400 }
}
```

All four values are required, in seconds, and each window must be non-empty and
forward-ordered; a partial or reversed block is dropped without invalidating
the mirror it was attached to. The first entry that declares `skip` for an
episode wins.

- Keys are catalog ids (`anilist:<id>`, `mal:<id>`, `offline:<slug>`) → episode
  number → a list of entries in priority order.
- `url` takes precedence over `fileId`. It must be `https`.
- `fileId` is substituted into the server's template and is restricted to
  `[A-Za-z0-9._~-]{1,128}`, so a malformed entry cannot escape the template and
  point at another origin.
- Unknown server ids, malformed URLs, and bad audio hints are dropped
  individually; one bad entry never invalidates the whole map.
- Remote maps are cached for 60 seconds and fail *open* — an unreachable
  endpoint degrades to "no mappings", not to a broken page.

Serve it from an endpoint you control:

```sh
ANIVERSE_SOURCE_MAP_URL=https://internal.example.com/aniverse/sources.json
```

…or inline it for a small deployment:

```sh
ANIVERSE_SOURCE_MAP_INLINE='{"version":1,"entries":{"anilist:16498":{"1":[{"server":"aniverse-origin","url":"https://cdn.example.com/aot/01/master.m3u8"}]}}}'
```

## Verifying the pipeline end to end

The `open-cinema` server resolves with zero configuration to Creative-Commons
open movies published as public HLS test streams. It exists so you can confirm
the proxy, manifest rewriting, hls.js attachment, latency probing, automatic
failover, and watch-room sync all work *before* wiring up a real source.

Two mirrors are synthesised per episode (a primary and an `· alt`), chosen
deterministically from the title id, so the failover path is exercised too.

Reference streams are **on by default outside production** and must be opted
into with `ANIVERSE_ENABLE_REFERENCE_STREAMS=true` in production. Their single
host is merged into the proxy allowlist automatically while enabled.

## Failover

`core/stream.worker.ts` runs off the main thread and walks mirrors in order:

1. Ready mirrors sort ahead of unusable ones, then by tier.
2. Each is probed with a 6 second deadline. Proxied mirrors are validated by
   the proxy's `X-Aniverse-Proxy-Kind: manifest` marker; direct mirrors by
   sniffing `#EXTM3U`.
3. A `MIRROR_PROBED` message reports per-server health and latency, which the
   server rail renders.
4. The first mirror that answers is attached. A fatal hls.js error triggers
   `TRY_NEXT_MIRROR`.
5. Picking a server manually moves it to the front of the chain, so failover
   continues from your choice rather than restarting at tier 0.

## Legal note

Configure only sources you own or are licensed to distribute. The file hosts in
the scaled and legacy tiers are general-purpose providers; supplying ids for
content you do not hold rights to is copyright infringement, and this project
gives you no tooling to discover such ids. Pair the application allowlist with
network egress restrictions at the host/provider layer for defence in depth.
