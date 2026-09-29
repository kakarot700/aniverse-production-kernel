# Catalog preview assets

The attached starter archive contains poster artwork but no actual video clips. This project therefore ships with no WebM files and omits `previewUrl` from its demo catalog records. Catalog cards remain poster-only without making a failed network request.

When an authorized, owned/licensed clip is available, place it at `public/previews/<slug>.webm` and set the record’s `previewUrl` to `/previews/<slug>.webm`. The card validates that local path, waits 300 ms after hover or keyboard focus, then mounts a muted looping video over the fixed 16:9 poster. The poster remains underneath until the preview can play, so media readiness does not alter layout geometry. Avoid putting private media URLs or credentials in the client-visible catalog.
