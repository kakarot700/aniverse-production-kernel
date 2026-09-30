# Frontend architecture

How the interface adapts across devices, and why it is built the way it is.

## Routes

| Route | Rendering | What it is |
|---|---|---|
| `/` | dynamic (SSR) | Home. Continue Watching, recommendations, a trending rail. |
| `/discover` | static shell | The full catalog with filters. |
| `/schedule` | static shell | This week's airing calendar, in local time. |
| `/search` | static shell | Search results, query in the URL. |
| `/profile` | static shell | Local library: stats, continue watching, saved titles. |
| `/settings` | static shell | Appearance, playback, data. |
| `/servers` | dynamic | Stream-server registry status. |

Only Home is server-rendered with data, because only Home benefits: it is the
entry point and a warm trending list is worth the round trip. Everything else
ships a static shell and fetches on the client, which keeps them instant on
repeat visits.

## Navigation

Three genuinely different layouts, not one layout that shrinks. The
breakpoints follow the input model, not device marketing names.

| Viewport | Navigation | Reasoning |
|---|---|---|
| `< 768px` | Bottom tab bar | The thumb is the pointer; the bottom edge is the reachable zone. |
| `768–1199px` | Icon rail (76px) | There is a cursor, and the reading position is top-left. |
| `≥ 1200px` | Full sidebar (248px) | Room for labels without crowding content. |

**Four primary destinations** — Home, Discover, Schedule, My list. The
consistent finding across streaming IA research is four or five, never more;
past that, tap accuracy degrades and the structure reads as a menu rather
than a set of places.

**Search is not a tab.** It is a persistent control in the top bar on every
page, plus `/` and `Cmd/Ctrl+K`, plus its own route at `/search`. People look
top-right for search, and spending a quarter of a four-item tab bar on
something already one tap away everywhere is a poor trade.

**Utility destinations** — Settings, Servers — are pinned to the bottom of
the sidebar, visually separated from the primary set so the two never compete
for attention.

The destination list and the active-state rule live in `lib/nav.ts` as data
and pure functions, tested in `tests/nav.test.ts`. Active matching is
segment-aware: a naive `startsWith` lights `/settings` up on `/settings-old`.

## CSS strategy

Two mechanisms with a clear division of labour:

- **Media queries** decide *page* layout and honour OS preferences
  (`prefers-color-scheme`, `prefers-reduced-motion`, `hover`, `pointer`).
- **Container queries** decide *component* layout. A `CatalogCard` sits in a
  150px rail and a 220px grid cell; it adapts to its slot without either
  context knowing about the other.

Other deliberate choices:

- `100dvh`, never `100vh` — `vh` ignores mobile browser chrome.
- `env(safe-area-inset-bottom)` on the tab bar and footer, enabled by
  `viewportFit: 'cover'` in the viewport export. Without that export the
  `env()` values are all zero and the tab bar sits under the home indicator.
- Fluid type via `clamp()` rather than a breakpoint per size, so it stays
  correct at widths nobody tested.
- `44px` minimum touch targets throughout (`--tap-target`).
- Active states are never carried by colour alone.

## Theming

Three states: `system` (default), `light`, `dark`.

`system` deliberately writes **no** `data-theme` attribute, leaving the CSS
`prefers-color-scheme` block in charge — so a device switching to dark at
sunset is followed live, with no JavaScript and no reload.

An inline blocking script in `<head>` (`THEME_BOOTSTRAP` in `lib/theme.ts`)
applies a saved explicit theme before first paint. It has to be blocking:
anything deferred, React included, runs after the browser has already painted
the wrong colours.

## Time and hydration

The schedule is the one place where getting this wrong is guaranteed.

`airingAt` is an **absolute Unix timestamp**. "Today", "Tuesday" and
"in 4h 12m" are all **local** concepts. The server does not know the viewer's
timezone, so any of those rendered server-side produces HTML that cannot
match hydration.

Therefore:

- `GET /api/schedule` returns absolute timestamps and does no grouping. That
  also makes the response cacheable and shareable between all viewers.
- `lib/schedule.ts` is pure, takes `now` as an argument, and does all day
  grouping and countdown formatting. Tested in `tests/schedule.test.ts`,
  which passes from UTC−11 through UTC+14 including half-hour and 45-minute
  offsets.
- `hooks/useNow.ts` is a shared, minute-resolution clock built on
  `useSyncExternalStore`. Its `getServerSnapshot` returns `0` as a sentinel;
  callers branch on `0` and render a placeholder. One interval serves the
  whole page, so forty countdowns cannot disagree with each other.

### Why not the raw `airingSchedules` feed

AniList exposes an `AiringSchedule` feed you can page by timestamp. It is the
obvious choice and the wrong one: thousands of entries per week, mostly
obscure web shorts, needing many round trips to assemble.

`lib/anime/airing.ts` instead queries popular non-adult `status: RELEASING`
media and reads each one's `nextAiringEpisode`. One request covers the week
and every result is a show somebody follows. The tradeoff, stated plainly: a
series airing twice in one week appears once. For a "what's on" calendar that
is the right shape.

## Player gestures

`lib/player/gestures.ts` is a pure state machine — no DOM — so the tricky
rules are testable without a browser (`tests/gestures.test.ts`).

| Gesture | Action |
|---|---|
| Double-tap left / right third | Seek ∓ the configured step; chains accumulate (tap-tap-tap = 20s) |
| Double-tap middle | Play / pause |
| Horizontal drag | Scrub, ~90s per screen width, committed on release |
| Vertical drag, right third | Volume |
| Long press | 2× speed until release |

Design notes:

- **A single tap only reveals the chrome.** Acting on the first tap would
  make every double-tap seek also toggle playback on the way through.
- **The axis locks on first commitment**, so a scrub that drifts vertically
  keeps scrubbing instead of yanking the volume mid-gesture.
- **Dragging ~144px vertically cancels a scrub**, with the pill switching to
  "Release to cancel" before you let go.
- **No brightness gesture.** The web has no brightness API, and faking it
  with a black overlay makes the picture worse rather than the screen
  brighter. A gesture that lies is worse than one that is absent.
- **Touch only.** `pointerType` is checked on every event; mouse and pen fall
  through untouched, and keyboard handling is unchanged.
- The overlay stops **64px short of the bottom** so the native control bar
  stays reachable. An overlay across the whole video would swallow every
  attempt to grab the scrubber.

Gestures, autoplay, auto-skip and the seek step are all toggleable in
`/settings` and stored via `lib/user-data/settings.ts`, which validates
field-by-field so a blob written by an older build keeps its valid choices
instead of resetting wholesale.

## Local-first data

Watch history, the watchlist, recent searches and preferences all live in
`localStorage` and never leave the browser. The list is useful from the first
episode rather than after a signup flow.

Storage is always read in an effect, never during render — the server has no
`localStorage`, and seeding from it would be a hydration mismatch. Components
gate on a `ready` flag so nobody sees "your list is empty" flash before their
real library loads.
