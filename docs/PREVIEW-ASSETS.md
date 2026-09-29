# Catalog artwork and preview clips

## Artwork

Catalog cover art and banners come from the live source: AniList
(`s4.anilist.co`) or, on the MyAnimeList fallback path, `cdn.myanimelist.net`.
Cards render them with a plain `<img>` using `loading="lazy"`,
`decoding="async"` and `referrerPolicy="no-referrer"`, and fall back to a
bundled poster if a remote image fails to load.

The posters under `public/posters/` are now only used by the offline sample
library and as the fallback image. See `public/posters/ASSET-NOTES.txt`.

## Hover preview clips

`AnimeSummary.previewUrl` is optional and validated by
`lib/preview-url.ts`: only a same-origin `/previews/<slug>.webm` path is
accepted, so a card never issues a request for a missing or remote file.

When an authorized clip is available, place it at
`public/previews/<slug>.webm` and set `previewUrl` on the record. The card
waits 300 ms after hover or keyboard focus, then mounts a muted looping video
over the fixed poster frame; the poster stays underneath until the video can
play, so media readiness never changes layout geometry.

No clips ship with this repository, so cards are poster-only by default.
