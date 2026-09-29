# Aniverse Production Kernel — full repository read

Read of every tracked file (52 files, ~2,100 lines of source excluding `package-lock.json`), plus a verification run of the project's own quality gates.

**Verified on this checkout (Node 22.22.3):** `typecheck` ✅ · `lint` ✅ (0 warnings) · `test` ✅ (14/14) · `build` ✅.

---

## 1. What this project is

A Next.js 15.5 App Router starter for an animation catalog with three feature pillars:

1. **Editorial catalog UI** — a poster grid with 3D tilt cards and an optional hover preview loop.
2. **HLS playback** — an allowlist-gated same-origin media proxy plus a Web Worker that probes mirrors and fails over.
3. **Watch rooms** — Supabase Realtime Broadcast carrying playback snapshots with NTP-style clock offset estimation and drift correction.

There is no auth UI, no database-backed page, and no playable media in the box. It is a scaffold, and the documentation is unusually honest about that.

### Layout

| Area | Files | Lines | Role |
|---|---|---|---|
| `app/` | 6 | 606 | Router shell, `globals.css` (394 lines), catalog + proxy route handlers |
| `components/` | 4 | 500 | Discovery shell, tilt card, HLS player, watch-room panel |
| `core/` | 1 | 120 | `stream.worker.ts` — mirror probing / failover |
| `hooks/` | 1 | 209 | `useWatchRoom` — Realtime lifecycle + drift correction |
| `lib/` | 10 | 350 | Catalog data, proxy URL logic, clock math, Supabase clients/repos |
| `types/` | 1 | 42 | Shared media + snapshot types |
| `tests/` | 5 | 152 | `node:test` unit tests over the pure functions |
| `supabase/` | 1 | 87 | Schema + RLS migration |
| `docs/` | 4 | 30 | Deployment, preview assets, reference sources, room sync |

Git history is a single squashed commit (`905a21a`), so there's no incremental history to learn intent from — only the code and docs.

### Request flow

```
app/page.tsx  →  lib/catalog.ts (5 poster-only records)
    └─ AniverseExperience (client)  — search / genre filter / <dialog> modal
         ├─ CatalogCard              — framer-motion tilt, 300 ms debounced preview
         ├─ MasterPlayer             — spawns core/stream.worker.ts
         │     └─ worker → GET /api/proxy?url=…  (allowlist, redirect re-check, m3u8 rewrite)
         │           └─ hls.js attaches the *proxy* URL, so nested URIs stay same-origin
         └─ WatchRoomPanel → useWatchRoom
               └─ supabase.channel('aniverse:watch-room:<uuid>', { private: true })
                    events: clock-ping / clock-pong / playback
```

---

## 2. The headline finding: two contradictory catalogs

This is the one thing worth acting on, and it's easy to miss because the file is never imported by the app.

**`lib/catalog.ts`** — what the app actually renders. Five invented titles (*Where the Clouds Rest*, *Tideglass*, …), every `episodes[].mirrors` is `[]`, no `previewUrl`. The UI therefore shows "No authorized HLS stream source is attached to this demo title." `tests/catalog.test.ts` locks that in.

**`app/api/catalog/route.ts`** — a second, unreferenced catalog serving one record: **"Bleach: Thousand-Year Blood War"** — a real, in-copyright Tite Kubo / Studio Pierrot property, with a real plot synopsis — backed by 11 "mirror tiers" grouped under comment headers like `🏆 1. The Premium "Big 3" High-Throughput Media Servers`:

```
vidplay.online · mcloud.to · filemoon.sx · doodstream.com · streamtape.com
voe.sx · streamwish.to · vidhide.com · mp4upload.com · netu.io · mixdrop.co
```

These are widely-known unauthorized streaming/file-host domains — the standard backend set behind pirate anime aggregators. This sits in direct tension with the rest of the repo, which repeats "owned or licensed", "authorized", "sources you own or are authorized to access" in the README, `DEPLOYMENT.md`, `PREVIEW-ASSETS.md`, and `ASSET-NOTES.txt`.

Three things make it worse than a stray file:

- **It ships.** The build output lists `ƒ /api/catalog` as a live server-rendered route. It's a public endpoint in production, not dead-stripped.
- **A test pins it in place.** `tests/server-catalog.test.ts` asserts all 11 names *in exact order* and comments: *"If a server is intentionally removed or re-ordered, update this list on purpose."* That converts cleanup into a deliberate, friction-laden act.
- **The poster is a decoy.** `public/posters/bleach-tybw.jpg` is a generic AI-generated hooded-swordsman image (I inspected it) — not Bleach art. `ASSET-NOTES.txt` discloses this accurately. So the *artwork* was handled carefully while the *title, synopsis, and mirror list* were not.

**Mitigating facts** (this is not currently a working piracy path):

- The URLs are bare site origins (`https://vidplay.online`), not `.m3u8` manifests. The proxy requires the body to start with `#EXTM3U` or it returns 502, and the worker requires the `x-aniverse-proxy-kind: manifest` header. The matrix fails closed.
- Nothing reaches it. No component fetches `/api/catalog`; the grep is clean apart from the test.
- The proxy would 403 every one of these hosts unless an operator explicitly added them to `ANIVERSE_MEDIA_ALLOWED_HOSTS`.

So it reads as aspirational scaffolding rather than a shipped feature — but it's a legal and reputational liability sitting in a public repo, and the test comment signals it's meant to stay. **Recommendation: delete `app/api/catalog/route.ts`, `tests/server-catalog.test.ts`, and `public/posters/bleach-tybw.jpg`.** If a server-side catalog endpoint is genuinely wanted, re-add it serving `lib/catalog.ts` with licensed sources.

One loose end either way: `requiresProxy` is declared in `types/media.ts`, set on all 11 mirrors, and asserted by the test — but **no runtime code ever reads it**. `MasterPlayer` and the worker route everything through `/api/proxy` unconditionally, so `requiresProxy: false` on Mp4Upload and Netu.tv does nothing.

---

## 3. Security review

### Media proxy (`lib/media-proxy.ts` + `app/api/proxy/route.ts`) — strong

Genuinely well-built SSRF defense, better than most hand-rolled proxies:

- HTTPS only; rejects embedded credentials; rejects any port but 443.
- Blocks `localhost`, `*.localhost`, `*.local`, `*.internal`, bare IPv4 literals, and anything with `:` in the hostname (catches `[::1]`) — **even if** the operator puts them in the allowlist. Tested explicitly.
- Wildcard `*.example.com` refuses to match the bare suffix *and* refuses suffix-confusion (`edge.media.example.attacker.test`). Both are tested.
- `redirect: 'manual'` with **every hop re-validated** against the allowlist, capped at 3.
- 1.5 MB manifest cap with streaming abort, 12 s request timeout, `#EXTM3U` content sniffing.
- Manifests are rewritten so child playlists, segments, *and* `URI="…"` key attributes all return through `/api/proxy` — keeping AES key fetches same-origin. Non-HTTP schemes (`data:`) are left alone.
- `Range` is forwarded only when it matches `^bytes=\d*-\d*$`.

Residual risks, roughly in priority order:

1. **Allowlist is by hostname, not IP.** DNS rebinding, or an allowlisted host that resolves to an internal address, still gets through. `DEPLOYMENT.md` explicitly calls for network egress controls as the compensating layer — correct advice, worth honoring.
2. **No authentication or rate limiting.** Anyone who can reach the deployment can drive arbitrary traffic to allowlisted hosts through your bandwidth. README mentions "provider-specific rate limits" but nothing is implemented.
3. **`X-Content-Type-Options: nosniff` is set on the media branch but not the manifest branch** (route.ts:96–100 vs 105–110). Low impact given the fixed `application/vnd.apple.mpegurl` type, but inconsistent.
4. **The 12 s timeout is cleared before the body is streamed** (route.ts:104), so a slow upstream can hold a connection open indefinitely once headers arrive.
5. No `Content-Security-Policy` or other security headers anywhere — `next.config.ts` only sets `reactStrictMode` and `poweredByHeader: false`. For an app that proxies third-party media into a video element, a CSP is worth adding.

### Supabase RLS (`supabase/migrations/20260929_001_user_data_rls.sql`) — strong

- `enable` **and** `force` row level security on all three tables (force also binds the table owner).
- `revoke all … from public, anon`, then grants only to `authenticated`. No `delete` grant on `profiles` or `playback_history`.
- Every policy uses the `(select auth.uid())` wrapped-subquery form Supabase recommends for planner caching.
- Realtime policy is narrow: `extension = 'broadcast'` **and** an exact regex on the topic shape. It correctly does *not* `ALTER realtime.messages`.
- Sensible column constraints (`char_length` bounds, `episode_number > 0`, `position_ms >= 0`) and the right unique keys to back the `onConflict` upserts in `repositories.ts`.

Gaps:

- **Rooms are open to `anon`.** The Realtime policies grant `select`/`insert` to `anon, authenticated` for *any* topic matching the UUID pattern. Anyone with the link joins — documented as a "bearer invite", which is a legitimate design, but it means room membership is unauthenticated and unbounded. There's no participant cap, no presence check, and no server-side validation of payloads.
- **No `profiles` bootstrap.** Nothing inserts a row on signup — no trigger on `auth.users`, and no code path calls insert. `getOwnProfile()` returns `null` for every new user forever, and `updateOwnProfile()` will update zero rows. A `handle_new_user()` trigger is the missing piece.
- **`updated_at` is never maintained on `profiles`.** No trigger, and `updateOwnProfile` doesn't set it (its `Update` type allows it, but the caller passes only `display_name`/`avatar_url`). `recordOwnPlayback` sets it manually — inconsistent.
- Cosmetic: line 63 has a stray leading space before `drop policy`.

`lib/supabase/repositories.ts` is careful — every function calls `requireUserId()` via `auth.getUser()` (server-verified, not a decoded JWT) and scopes by `user_id`, belt-and-braces with the RLS. Input lengths and integer ranges are validated before hitting the DB. There is no service-role client anywhere, which is the right call. Note the whole module is currently **unused** — nothing imports it.

`middleware.ts` is correct for `@supabase/ssr` 0.12: the two-argument `setAll(cookiesToSet, headers)` form (which propagates the no-cache headers) matches the installed package's documented signature — I checked it against `node_modules/@supabase/ssr/dist/main/types.d.ts`. `auth.getClaims()` exists on the installed `auth-js`.

---

## 4. Watch-room synchronization

The clock math is legitimately good, and the docs are refreshingly candid that "10 ms" is a correction tolerance, not a delivery guarantee.

**What's right:**

- `estimatePeerClockOffset` is a textbook four-timestamp NTP estimate, with RTT floored at 0.
- Sample selection in `onPong` takes the **3 lowest-RTT samples of the last 7, then the median offset** — the standard trick for rejecting jitter outliers.
- `predictPlayheadSeconds` extrapolates elapsed time *only while the remote is playing*, which is correct.
- Correction ladder: ≤10 ms → nothing; <300 ms → playback-rate nudge clamped to ±3%; ≥300 ms or paused → seek. Rate nudges auto-reset to 1.0 after 1.5 s.
- Per-peer monotonic `sequence` checks drop out-of-order snapshots. Every inbound payload goes through a real type guard (`isPlaybackSnapshot` checks `Number.isSafeInteger`, finiteness, and non-negativity — not just `typeof`).
- Seeks are clamped to `duration - 0.03` to avoid firing `ended`.

**The significant gap — no leader election.** Every peer both publishes (on `timeupdate`, throttled to 180 ms) *and* corrects toward every other peer. With two active peers, A chases B while B chases A. The only damping is the 90 ms `applyingRemoteRef` window — and a seek's `seeked` event frequently fires *after* that window closes, which re-publishes a snapshot derived from the correction you just applied. Expect oscillation, especially on the rate-nudge path where corrections are continuous. A host/controller role (one publisher, N followers) or a timestamp-priority tiebreak would resolve this. `docs/ROOM-SYNC.md` is honest about network variance but doesn't mention this.

**Smaller notes:**

- `onPing` computes `peerReceivedAt` and `peerSentAt` from two back-to-back `Date.now()` calls, so the "subtract remote processing time" term in the NTP formula is always ~0. Harmless, just inert.
- In `onPong`, `samples.push(sample)` mutates the array already held in the map, then stores `samples.slice(-7)`; `bestSamples` is computed from the untrimmed local `samples`. Effectively bounded at 8 within a tick — not a leak, but the intent reads as off-by-one.
- `Date.now()` is used throughout rather than a monotonic clock, so NTP/system clock adjustments mid-session will show up as drift. Unavoidable given the wire format needs comparable wall clocks, but worth knowing.

`core/stream.worker.ts` is careful concurrency work: a `generation` counter invalidates in-flight probes, `AbortController` per attempt with a 6 s cap, sequential failover, and mirrors filtered to `https://` before use. The cancel/reinitialize paths all bump the generation before aborting. I found no race in it.

---

## 5. Frontend, performance, accessibility

**Accessibility is a real strength** — better than typical:

- Native `<dialog showModal()>` for the player, so focus trapping and Esc come from the platform; focus is explicitly restored to the previously-focused element on close, and `onCancel` is intercepted so Esc routes through React state.
- Genre filters use `aria-pressed`; search has an `sr-only` label; status regions use `role="status"` / `aria-live="polite"`; the frequently-updating playhead is deliberately `aria-live="off"` to avoid screen-reader spam.
- Decorative posters are `alt=""` inside buttons carrying descriptive `aria-label`s.
- Reduced motion handled **twice** — a global CSS `@media (prefers-reduced-motion: reduce)` block and `useReducedMotion()` gating the pointer tilt in JS.
- Preview video is `aria-hidden`, muted, `playsInline`, `preload="none"`, mounted only after a 300 ms debounce, and the poster stays underneath until `canplay` resolves — so layout never shifts.
- Tilt is restricted to `pointerType === 'mouse'`, so touch and pen don't get jitter.

**Performance is the weak spot.** The landing page is **395 kB first-load JS** for what renders as five posters:

- `MasterPlayer` statically imports `hls.js` at module scope, and it's pulled into the client tree from `AniverseExperience` — so **every visitor downloads the entire HLS engine** (a 572 kB raw shared chunk) even though the shipped catalog has zero playable mirrors and the player only ever appears inside a modal. `framer-motion` rides along the same way.
- Wrapping `PlayerDialog`/`MasterPlayer` in `next/dynamic` with `ssr: false` would move both out of the initial load. That's the single highest-leverage perf change here.
- No `next/image` — raw `<img>` with `@next/next/no-img-element` disabled in `.eslintrc.json`. `skyarchive.jpg` alone is **604 kB** unoptimized; posters total ~1.1 MB.

**Dead code / tidy-ups:**

- `.modal-backdrop` and `.button-light` CSS classes are defined in `globals.css` but never used in any component (the modal uses native `::backdrop`).
- `.sr-only` is defined twice — `app/a11y.css:1` and `app/globals.css:347`, identical rules.
- `searchRef` in `AniverseExperience` is created and attached to the input but never read (no focus shortcut wired up).
- `lib/supabase.ts` is a barrel re-export nothing imports; `lib/supabase/repositories.ts` and `lib/supabase/server.ts` are both unused by any page or route.
- `skipTimestamps` is fully implemented in `MasterPlayer`'s `timeupdate` handler (with `lastSkipPoint` latching to prevent re-fire) but no catalog record ever sets it.

---

## 6. Tests and toolchain

14 tests, all passing, covering exactly the parts worth unit-testing: allowlist host matching, SSRF rejection cases, HLS manifest rewriting, preview-path validation, and the four clock-math functions. The SSRF and wildcard-confusion cases in particular are the right tests to have written.

Not covered: the `/api/proxy` route handler itself (redirect chain, size cap, sniffing), the worker's failover state machine, and anything DOM/component-level. No test runner for React is installed, so component tests would need new tooling.

Note `tsconfig.test.json`'s `include` lists only `tests/**/*.test.ts` plus two lib files, but TypeScript pulls the rest in transitively — which is how `server-catalog.test.ts` manages to import an App Router route handler and call `GET()` directly under `node --test`.

Toolchain observations:

- **ESLint 8 with legacy `.eslintrc.json`.** Next 15.5 supports flat config (`eslint.config.mjs`) and ESLint 8 reached end-of-life in Oct 2024. Works today; worth migrating.
- `dev` and `start` correctly bind `--hostname 0.0.0.0`.
- `.gitignore` is appropriate (`node_modules`, `.next`, `.test-dist`, `coverage`, `.env*` with an `!.env.example` escape).
- Build emits two webpack `PackFileCacheStrategy` warnings about serializing large strings — cosmetic.

---

## 7. Suggested priority order

| # | Item | Why |
|---|---|---|
| 1 | Delete `app/api/catalog/route.ts`, `tests/server-catalog.test.ts`, `public/posters/bleach-tybw.jpg` | Removes a public endpoint advertising a copyrighted title against 11 known piracy hosts, contradicting every other doc in the repo |
| 2 | `next/dynamic` for `MasterPlayer` / `PlayerDialog` | Drops `hls.js` + `framer-motion` from a 395 kB landing bundle that can't play anything |
| 3 | Add a leader/host role to watch rooms | Removes the mutual-correction oscillation between peers |
| 4 | Add a `profiles` insert trigger + `updated_at` trigger | `getOwnProfile` currently returns `null` for every user, permanently |
| 5 | Rate-limit / auth-gate `/api/proxy` | It's an open relay for allowlisted hosts |
| 6 | Either read `requiresProxy` or remove it | Declared, set, and tested; never consulted |
| 7 | Security headers (CSP) in `next.config.ts` | Nothing is set today |
| 8 | Migrate to ESLint 9 flat config | ESLint 8 is EOL |
| 9 | Sweep dead CSS/refs, dedupe `.sr-only`, optimize posters | Small, mechanical |

---

## 8. Overall read

Two different authors seem to have touched this. The bulk of it — the proxy, the RLS migration, the clock math, the accessibility work, and especially the documentation — is careful, security-aware, and unusually honest about its own limits. `docs/ROOM-SYNC.md` refusing to claim 10 ms as a guarantee, and `ASSET-NOTES.txt` admitting poster licensing wasn't verified, are the kind of disclosures most starters omit.

Against that, `app/api/catalog/route.ts` and its pinning test read like they were dropped in from a different project with a different intent, and they undercut the credibility of everything around them. Removing them is cheap and makes the repo's story consistent.

Nothing is broken: all four gates pass cleanly on a fresh install.
