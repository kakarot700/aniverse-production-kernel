# Catalog artwork and preview clips

## Cover art

Cover images come from two places, and neither copies third-party media into
this repository:

1. **Live providers.** AniList and Jikan records carry their own CDN image
   URLs, which the browser loads directly.
2. **Generated locally.** The bundled offline catalog points at
   `/api/poster?title=…&seed=…`, which renders a deterministic SVG
   (`lib/poster.ts`): a hashed hue ramp plus one of three geometric motifs.
   Same title in, same poster out — no network, no binary assets, no
   licensing question.

`CatalogCard` also falls back to `/api/poster` if a provider image fails to
load, so a card never shows a broken image.

The previous placeholder JPEGs in `public/posters/` were removed. By their own
asset notes they were "collected from visual-search results" with licensing
"not independently verified", and after the catalog rewrite nothing referenced
them.

If you want local artwork, put owned or properly licensed files in
`public/posters/` and point a record's `coverPoster` at `/posters/<file>`.

## Hover preview clips

The project ships no video clips and omits `previewUrl` from its catalog
records, so cards stay poster-only without making a failed network request.

When an authorized, owned/licensed clip is available, place it at
`public/previews/<slug>.webm` and set the record's `previewUrl` to
`/previews/<slug>.webm`. `resolveLocalPreviewUrl` validates that same-origin
path — remote URLs and traversal attempts are rejected — and the card waits
300 ms after hover or keyboard focus before mounting a muted looping video
over the poster. The poster stays underneath until the preview can play, so
media readiness never changes layout geometry.

Avoid putting private media URLs or credentials in the client-visible catalog.
