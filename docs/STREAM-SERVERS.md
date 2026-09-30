# Stream servers

Playback is driven by an ordered registry of HTTPS HLS or MP4 media origins.
The player probes them in priority order and automatically fails over. Server
definitions are configuration, so adding a mirror does not require changing
React or TypeScript.

```text
catalog title + episode
        │
        ▼
lib/streams/definitions.ts   expand URL tokens or select an exact episode URL
        │                    reject unsafe/non-HTTPS endpoints
        ▼
lib/streams/registry.ts      sort, dedupe, derive the proxy allowlist
        │
        ▼
GET /api/watch/:id/:episode  return ranked StreamMirrorNode[]
        │
        ▼
core/stream.worker.ts        probe and fail over off the main thread
        │
        ▼
components/MasterPlayer.tsx  hls.js/native MP4 playback
```

## Fastest setup: 12 URL slots

Copy the environment file and paste a licensed HLS/MP4 URL or URL template into
any of the 12 prepared slots:

```sh
cp .env.example .env.local
```

```dotenv
ANIVERSE_SERVER_01_URL=https://media.example.com/anime/{slug}/e{episode3}/master.m3u8
ANIVERSE_SERVER_02_URL=https://backup.example.com/{anilistId}/{episode}/index.m3u8
# ...through ANIVERSE_SERVER_12_URL
ANIVERSE_ENABLE_REFERENCE_STREAMS=false
```

A non-empty slot activates on restart. Nothing else is required. Quick slots
are named `Anime Server 01` … `Anime Server 12`, use the `Licensed` group,
default to mixed audio and proxy through this app. A URL ending in `.mp4` is
automatically marked as progressive MP4; every other quick URL is HLS.

A literal URL is valid but serves the same asset for every selection. To serve
a catalog, use template tokens or the mapped configuration below.

## Zero-config setup: the paste file

Even faster: no environment file at all. The tracked
`config/stream-servers.json` already contains the brackets:

1. Open **`config/stream-servers.json`** in the project root. It ships with
   four `PASTE-…-HERE` brackets (sub, dub, backup, MP4).
2. Paste your stream URL into a `template` bracket.
3. Restart the app. The registry is read once per process.
4. Open **`/servers`** in the app (or `GET /api/servers`) and confirm your
   server is listed and the bracket's reminder issue is gone.

```json
[
  {
    "id": "my-anime-sub",
    "name": "My Anime Server (Sub)",
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

A URL that is not a public HTTPS endpoint (`http://`, an IP literal,
`localhost`, credentials) is rejected with a visible reason on `/servers`, so
a typo can never silently produce a dead mirror. Empty `PASTE-…` brackets
stay visible as reminders until filled; `[bracketed]` slots marked
`"placeholder": true` — the style used by `config/stream-servers.example.json`
— stay silent instead. Both activate the moment a real URL is pasted.

## Full-control JSON setup

`config/stream-servers.json` ships with four active `PASTE-…-HERE` brackets
(sub, dub, backup, MP4). The tracked example file adds **12 dormant bracketed
slots** with every field spelled out; copy it over if you prefer that layout:

```sh
cp config/stream-servers.example.json config/stream-servers.json
```

`config/stream-servers.json` is auto-discovered and its empty brackets are
committed on purpose, so a fresh checkout always has a visible place to paste.
If your URLs contain signing paths you would rather keep out of source
control, add the file to `.gitignore` in your own deployment — the app does
not care either way. You may instead set:

- `ANIVERSE_STREAM_SERVERS` to an inline JSON array; or
- `ANIVERSE_STREAM_SERVERS_FILE` to another JSON file path.

Detailed JSON definitions and quick environment slots can be used together.
A detailed definition wins if it uses the same id as a quick slot.

### Universal URL template

Use this when your storage keys follow one convention:

```json
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
}
```

### Per-title URL template

Use `titles` when each title has a different base path but episode files still
follow a pattern:

```json
{
  "id": "partner-dub",
  "name": "Partner CDN (dub)",
  "group": "Licensed",
  "language": "dub",
  "kind": "hls",
  "priority": 20,
  "requiresProxy": true,
  "scope": "mapped",
  "titles": {
    "anilist:21": "https://dub.example.com/one-piece/{episode3}/index.m3u8",
    "anilist:16498": "https://dub.example.com/aot/s1/{episode2}/index.m3u8"
  }
}
```

### Exact per-episode URLs

Mux, Cloudflare Stream, Bunny Stream and similar video platforms normally give
each uploaded episode a random playback id. Use `episodes` to paste those URLs
directly; exact episode entries take precedence over a `titles` fallback:

```json
{
  "id": "managed-video",
  "name": "Managed video library",
  "group": "Licensed",
  "language": "mixed",
  "kind": "hls",
  "priority": 5,
  "requiresProxy": true,
  "scope": "mapped",
  "episodes": {
    "anilist:21": {
      "1": "https://stream.mux.com/PASTE_PLAYBACK_ID.m3u8",
      "2": "https://customer-PASTE.cloudflarestream.com/PASTE_UID/manifest/video.m3u8",
      "3": "https://PASTE_PULL_ZONE.b-cdn.net/PASTE_VIDEO_ID/playlist.m3u8"
    }
  }
}
```

The example values are URL formats, not bundled videos. Replace every `PASTE_*`
component with a playback URL for media you control.

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable slug, unique across the registry |
| `name` | — | Label shown on the server button (defaults to `id`) |
| `group` | — | UI grouping header (default `Licensed`) |
| `language` | — | `sub` \| `dub` \| `raw` \| `mixed` (default `sub`) |
| `kind` | — | `hls` \| `mp4` (default `hls`) |
| `priority` | — | Lower tries first; reference streams sit at 900+ |
| `requiresProxy` | — | `true` (default) uses `/api/proxy`; `false` requires permissive origin CORS |
| `scope` | — | `universal` or `mapped` |
| `template` | universal | URL or URL template that works for any title |
| `titles` | mapped option | `{ "<title key>": "<url template>" }` |
| `episodes` | mapped option | `{ "<title key>": { "<episode>": "<exact url>" } }` |
| `quality` | — | Free-text badge, for example `1080p` or `Adaptive` |
| `note` | — | Server tooltip text |
| `enabled` | — | `false` keeps a completed definition hidden |
| `placeholder` | — | Allows an empty/bracketed template slot without a validation warning |

Mapped title keys can be `anilist:<id>`, `mal:<id>`, a bare AniList id, or the
title slug. Exact episode numbers must be from 1 to 5000.

## Template tokens

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

Tokens are encoded as one URL component, so title metadata cannot add path
segments. A template requiring an unavailable id resolves to no mirror rather
than producing a malformed URL.

## What ships by default

A fresh checkout has no licensed anime media. It therefore includes five
clearly labelled **reference streams** from Mux, Apple, Unified Streaming and
the Blender Foundation. They verify HLS, MP4, proxying and failover, but they
are not anime and always rank last. Disable them after adding real media:

```dotenv
ANIVERSE_ENABLE_REFERENCE_STREAMS=false
```

See [REFERENCE-SOURCES.md](REFERENCE-SOURCES.md) for provenance.

## Validation and proxy safety

- Bad entries are dropped individually and reported by `GET /api/servers` and
  the in-app `/servers` page. Unfilled `PASTE-…-HERE` brackets stay visible as
  reminders until a URL is pasted; `[bracketed]` `placeholder` slots stay
  silent.
- Expanded URLs must be HTTPS on the default TLS port, credential-free, and
  must not target literal IPs, loopback, `.local` or `.internal` hosts.
- The proxy allowlist is derived from configured templates, title maps and
  exact episode maps. Add `ANIVERSE_MEDIA_ALLOWED_HOSTS` only for a separate
  segment/key/redirect CDN that is not visible in those URLs.
- `/api/proxy` re-checks every redirect hop and rewrites HLS child playlists,
  segments, encryption keys and init maps through the same allowlist.
- `GET /api/servers` never returns templates or playback URLs.

Run these checks after configuration:

```sh
curl -s localhost:3000/api/servers | jq
curl -s "localhost:3000/api/watch/anilist:21/7" | jq '.mirrors[] | {serverName, manifestUrl, requiresProxy}'
```

## Licensing boundary

Only configure media you own, operate, or are licensed to distribute. Consumer
services such as Crunchyroll, Netflix and HIDIVE expose watch pages for their
own players; a subscriber account does not grant permission to extract and
retransmit their manifests through another app. Aniverse surfaces legal
external episode links supplied by AniList instead of scraping those services.

The research and supported managed-video URL formats are documented in
[STREAM-SERVER-RESEARCH.md](STREAM-SERVER-RESEARCH.md).
