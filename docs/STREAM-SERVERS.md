# Stream servers

Playback is driven by a **server registry**: an ordered list of real media
origins that the app probes, ranks and fails over between. Servers are
configuration, not code — you never edit a TypeScript file to add one.

```
catalog title + episode number
        │
        ▼
 lib/streams/definitions.ts   expand {tokens} in each server's URL template
        │                     drop anything that is not a safe public HTTPS URL
        ▼
 lib/streams/registry.ts      sort by priority, dedupe, derive proxy allowlist
        │
        ▼
 GET /api/watch/:id/:episode  ranked StreamMirrorNode[]
        │
        ▼
 core/stream.worker.ts        probe each mirror, report the first that answers
        │
        ▼
 components/MasterPlayer.tsx  hls.js attach, error recovery, automatic failover
```

## What ships by default

A fresh checkout has no licensed servers, so the registry falls back to five
**reference servers** — public test streams published by their owners for
exactly this purpose:

| Server | Source |
| --- | --- |
| Reference · Mux (multi-bitrate) | Mux public test stream (Big Buck Bunny, Blender Foundation, CC-BY) |
| Reference · Apple fMP4 | Apple HLS advanced example stream |
| Reference · Unified Streaming | Unified Streaming demo (Tears of Steel, Blender Foundation, CC-BY) |
| Reference · Mux VOD | Mux public VOD test asset |
| Reference · Progressive MP4 | Google-hosted Big Buck Bunny MP4 |

They exist so HLS playback, mirror failover, the media proxy and watch-room
sync are verifiable before you plug anything in. They are **not** anime, they
always rank last (priority ≥ 900), and the UI labels them under a `Reference`
group with a notice on the player. Turn them off once real servers exist:

```sh
ANIVERSE_ENABLE_REFERENCE_STREAMS=false
```

## Quick start: paste your URL

The zero-config way needs no environment variable at all:

1. Open **`config/stream-servers.json`** in the project root. It ships with
   placeholder brackets; the app auto-detects it. (If your URLs contain
   signing paths you would rather keep out of git, add the file to
   `.gitignore` in your own deployment — the app does not care either way.)
2. Paste your stream URL into a `template` bracket.
3. Restart the app. The registry is read once per process.
4. Open **`/servers`** in the app (or `GET /api/servers`) and confirm your
   server is listed with no issues.

```json
[
  {
    "id": "my-anime",
    "name": "My Anime Server",
    "group": "Licensed",
    "language": "sub",
    "kind": "hls",
    "priority": 10,
    "enabled": true,
    "template": "https://your-cdn.example.com/anime/{slug}/{episode}/index.m3u8"
  }
]
```

A bare URL with no tokens serves that one video for every episode — exactly
what the reference streams do. Tokens (`{slug}`, `{episode}`, …) make the URL
per-episode; the full table is below.

A URL that is not a public HTTPS endpoint (an unfilled bracket, `http://`, an
IP literal, `localhost`) is rejected with a reason on `/servers`, so a typo
can never silently produce a dead mirror.

## Adding your own servers

Set `ANIVERSE_STREAM_SERVERS` to a JSON array, or point
`ANIVERSE_STREAM_SERVERS_FILE` at a JSON file with the same shape (see
`config/stream-servers.example.json`). Or use neither: a file at the
auto-detected `config/stream-servers.json` is picked up with zero environment
configuration, as described in the quick start above.

```json
[
  {
    "id": "studio-cdn-sub",
    "name": "Studio CDN",
    "group": "Licensed",
    "language": "sub",
    "kind": "hls",
    "priority": 10,
    "requiresProxy": true,
    "scope": "universal",
    "quality": "1080p",
    "template": "https://media.example.com/anime/{slug}/e{episode3}/master.m3u8"
  },
  {
    "id": "partner-dub",
    "name": "Partner CDN (dub)",
    "group": "Licensed",
    "language": "dub",
    "priority": 20,
    "requiresProxy": false,
    "scope": "mapped",
    "titles": {
      "anilist:21": "https://dub.example.com/one-piece/{episode3}/index.m3u8",
      "anilist:16498": "https://dub.example.com/aot/s1/{episode2}/index.m3u8"
    }
  }
]
```

### Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable slug, unique across the registry |
| `name` | — | Label shown on the server button (defaults to `id`) |
| `group` | — | UI grouping header (default `Licensed`) |
| `language` | — | `sub` \| `dub` \| `raw` \| `mixed` (default `sub`) |
| `kind` | — | `hls` \| `mp4` (default `hls`) |
| `priority` | — | Lower tries first; reference streams sit at 900+ |
| `requiresProxy` | — | `true` (default) routes through `/api/proxy`; `false` needs permissive CORS on the origin |
| `scope` | — | `universal` (template works for every title) or `mapped` (only ids in `titles`) |
| `template` | for `universal` | URL template |
| `titles` | for `mapped` | `{ "<title key>": "<url template>" }` — overrides `template` for that title |
| `quality` | — | Free-text badge, e.g. `1080p` |
| `note` | — | Tooltip text |
| `enabled` | — | `false` keeps the definition but hides it |

Title keys accepted in `titles`: `anilist:<id>`, `mal:<id>`, the bare AniList
id, or the title's slug.

### Template tokens

| Token | Example |
| --- | --- |
| `{anilistId}` | `21` |
| `{malId}` | `21` |
| `{slug}` | `one-piece` |
| `{title}` | `One%20Piece` |
| `{year}` | `1999` |
| `{season}` | `fall` |
| `{episode}` | `7` |
| `{episode2}` | `07` |
| `{episode3}` | `007` |

Tokens are URL-encoded as a single component, so a slug can never add path
segments or traverse out of where your template placed it. A template that
needs an identifier the title does not have (for example `{malId}` on an
AniList-only record) simply produces no mirror instead of a broken URL.

## Validation and safety

* A definition is dropped — with a reason reported on `GET /api/servers` and
  on the `/servers` page — if it has no `id`, duplicates one, is missing a
  `template`, declares `scope: "mapped"` with an empty `titles` map, or its
  `template`/`titles` URL is not a public HTTPS endpoint (an unfilled paste
  bracket, `http://`, an IP literal, credentials, a `.local` name). One bad
  entry never takes the registry down.
* Expanded URLs must be HTTPS, on port 443, credential-free, and not a
  loopback/IP/`.local`/`.internal` host.
* The media proxy allowlist is **derived**: it is
  `ANIVERSE_MEDIA_ALLOWED_HOSTS` plus the static hostname of every configured
  server. You do not have to keep two lists in sync, and a host that is not in
  the registry cannot be fetched through `/api/proxy`.
* `GET /api/servers` never returns URL templates, so signed paths stay
  server-side.

## Licensing

The registry is deliberately empty of content servers. Configure only origins
you own, operate, or are licensed to distribute from. Pointing `template` at a
third-party file host you do not have rights to would make this deployment a
redistribution endpoint for someone else's copyrighted work — that is on the
operator, and nothing in this repository ships such a configuration.

For discovery of where a title is *legally* streamable, the catalog already
surfaces AniList's `streamingEpisodes` links (Crunchyroll, Netflix, Hulu, …)
on each episode, plus the official trailer.

## Checking your configuration

```sh
curl -s localhost:3000/api/servers | jq
curl -s "localhost:3000/api/watch/anilist:21/7" | jq '.mirrors[] | {serverName, manifestUrl, requiresProxy}'
```

`GET /api/servers` reports `config.issues` for every rejected definition,
`config.allowedProxyHosts` for the derived allowlist, and
`config.loadedFrom` (`env` / `file` / `none`).
