# How to add your anime servers

Everything happens in **one file**: `config/stream-servers.json`. It ships with
**12 dormant slots**. Paste a URL into a slot's `template`, restart, done — no
code changes, no environment variables, no rebuild of the player.

Open **`/servers`** in the running app at any time to see exactly which slots
are live, which were rejected, and why.

---

## 1. The fastest possible version

Open `config/stream-servers.json`, find slot 1, and replace the bracket:

```diff
-    "template": "[PASTE YOUR HTTPS HLS/MP4 URL OR TEMPLATE HERE]",
+    "template": "https://cdn.example.com/anime/{slug}/ep{episode}/master.m3u8",
```

Restart (`npm run dev`). That slot is now live for **every title in the
catalog** — the tokens fill themselves in per episode.

A bare URL with no tokens also works; it just serves the same video for every
episode, which is handy for testing:

```json
"template": "https://cdn.example.com/test/master.m3u8"
```

---

## 2. Tokens

Tokens are replaced per title and per episode. Values are URL-encoded, so a
slug or title can never break out of the path you put it in.

| Token | Example value |
| --- | --- |
| `{slug}` | `one-piece` |
| `{anilistId}` | `21` |
| `{malId}` | `21` |
| `{title}` | `One%20Piece` |
| `{year}` | `1999` |
| `{season}` | `fall` |
| `{episode}` | `7` |
| `{episode2}` | `07` |
| `{episode3}` | `007` |

If a template needs a token the title does not have (`{malId}` on a title with
no MAL id), that mirror is simply skipped for that title — it does not error.

---

## 3. The three shapes a server can take

### Universal — one pattern covers the whole catalog

```json
{
  "id": "my-cdn",
  "name": "My CDN",
  "group": "Licensed",
  "language": "sub",
  "kind": "hls",
  "priority": 10,
  "scope": "universal",
  "template": "https://cdn.example.com/anime/{slug}/e{episode3}/master.m3u8"
}
```

### Per-title — different path per show

```json
{
  "id": "my-cdn-mapped",
  "name": "My CDN (mapped)",
  "scope": "mapped",
  "titles": {
    "anilist:21":      "https://cdn.example.com/onepiece/{episode3}.m3u8",
    "anilist:16498":   "https://cdn.example.com/aot/s1/{episode2}/index.m3u8",
    "cowboy-bebop":    "https://cdn.example.com/bebop/{episode}/master.m3u8"
  }
}
```

Keys may be `anilist:<id>`, `mal:<id>`, or the title's slug.

### Exact per-episode — for platforms with unpredictable ids

```json
{
  "id": "managed-platform",
  "name": "Managed platform",
  "scope": "mapped",
  "episodes": {
    "anilist:21": {
      "1": "https://cdn.example.com/a8f3c1/master.m3u8",
      "2": "https://cdn.example.com/b2d9e7/master.m3u8"
    }
  }
}
```

Resolution order is **exact episode → per-title → universal template**.

---

## 4. Every field

| Field | Required | Default | What it does |
| --- | --- | --- | --- |
| `id` | ✅ | — | Unique, `[a-z0-9-]`. Also the health-tracking key. |
| `name` | — | `id` | Shown on the server rail. |
| `template` | ✅ for `universal` | — | The URL, with optional tokens. |
| `scope` | — | `universal` | `universal` or `mapped`. |
| `titles` / `episodes` | ✅ for `mapped` | — | Per-title / per-episode URLs. |
| `priority` | — | `100+index` | **Lower is tried first.** |
| `language` | — | `sub` | `sub` · `dub` · `raw` · `mixed`. |
| `kind` | — | `hls` | `hls` or `mp4`. |
| `group` | — | `Licensed` | Rail heading, e.g. `Licensed`, `Self-hosted`. |
| `quality` | — | — | Free text badge: `1080p`, `Adaptive`. |
| `note` | — | — | Tooltip on the rail. |
| `enabled` | — | `true` | Set `false` to park a slot without deleting it. |
| `requiresProxy` | — | `true` | See below. |

### `requiresProxy`

* **`true` (default)** — the browser only ever talks to `/api/proxy`, which
  validates the host, follows redirects safely and rewrites the manifest. Use
  this unless you have a reason not to.
* **`false`** — the browser fetches your origin directly. Only do this if your
  origin sends permissive CORS headers. Direct mirrors **cannot be probed**
  (CORS blocks it), so the race can't verify them — they're held back and only
  used after every proxied mirror fails.

---

## 5. Rules a URL must satisfy

A template is dropped, with the reason shown on `/servers`, unless it is:

* `https://` — not `http://`
* on port 443 (the default) — no `:8080`
* a real hostname — no IP literals, `localhost`, `.local`, or `.internal`
* free of embedded credentials — no `user:pass@`

A home server therefore needs a real hostname and certificate in front of it.
A reverse proxy (Caddy, nginx + Let's Encrypt) or a tunnel (Cloudflare Tunnel,
Tailscale Funnel) gets you there; point the slot at the public hostname.

The proxy allowlist is **derived automatically** from the static hostname of
every enabled slot, so you do not maintain it separately. Only add
`ANIVERSE_MEDIA_ALLOWED_HOSTS` when a redirect lands on a *different* host than
the template shows.

---

## 6. Ordering, and how failover uses it

`priority` is your ranking and it stays the backbone — but the player also
learns. See [`docs/FAILOVER.md`](FAILOVER.md) for the detail; the short version:

* Mirrors are **raced in parallel**, not tried one at a time. First healthy
  response wins.
* A mirror that fails gets an exponential cooldown (20 s → 5 min cap) and drops
  down the order until it recovers.
* A consistently fast mirror climbs at most ~5 priority points, so a wide gap
  you set deliberately is never overturned.
* The last server that worked is tried first next time — unless it's in
  cooldown.

Practical consequence: **more slots is strictly better.** They cost nothing
when healthy (the race usually resolves on the first one) and every extra slot
is another parallel candidate when something breaks.

---

## 7. Other ways to configure

Precedence, highest first:

1. `ANIVERSE_STREAM_SERVERS` — inline JSON array
2. `ANIVERSE_STREAM_SERVERS_FILE` — path to a JSON file
3. **`config/stream-servers.json`** — auto-detected, the zero-config default
4. `ANIVERSE_SERVER_01_URL` … `ANIVERSE_SERVER_12_URL` — quick slots, merged in
5. Built-in public reference streams

Quick slots are the least typing of all — one URL per variable in `.env.local`:

```sh
ANIVERSE_SERVER_01_URL=https://cdn.example.com/anime/{slug}/{episode}/master.m3u8
```

Turn the bundled demo streams off once you have real ones:

```sh
ANIVERSE_ENABLE_REFERENCE_STREAMS=false
```

---

## 8. Checking your work

```sh
npm run dev
```

1. Open **`/servers`**. Your slot should appear with status **On**. If it was
   rejected, the exact reason is printed under *Configuration status*.
2. Open any title. The **Servers** rail lists your mirror under its group.
3. The player status line reports which server answered and how fast:
   *"My CDN responded in 84 ms."*
4. `curl localhost:3000/api/servers` gives the same thing as JSON.

Remember: **the registry is read once per process — restart after editing.**

> Configure only origins you own, operate, or are licensed to distribute from.
