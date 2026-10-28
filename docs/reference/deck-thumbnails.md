# Deck thumbnails

How the app shows a miniature of a slide, and why there are two ways to do it.

## Two forms, one criterion

**Slide 1 of a saved deck is a server raster; every other miniature is a live render.**

- **Raster.** Deck cards (Presentations, Home "Recent" and "Popular", search, trash, shared) show `GET /api/presentations/:id/thumbnail`: a WebP of the deck's first slide a presentation shows (slide 1, unless it is hidden from presenting or incomplete, see [incomplete-slides.md](incomplete-slides.md)), rendered by headless Chrome off the request path and cached in `<DATA_DIR>/deck-thumbs/` (`server/render/deck-thumbnail.js`). A list can hold dozens of decks; a live slide DOM per card is what made the front page slow (front-page-perf, Fase B).
- **Live render.** Everything else renders the slide in the browser with `renderSlideElement(slide, { mode: 'thumb' })` and `attachThumbScale`: the Home sandbox examples (not saved decks), the activity rail (the commented slide, not slide 1), the theme-picker row (a demo slide per theme), and the editor, presenter, viewer, library, picker and curation surfaces. There are at most a handful per page, and none of them has a deck id and slide 1 to key a cache on.

A new surface picks its form by that criterion. The one known deviation is the slide-library tile on Home (`client/views/slide-library/thumb.js`), which scales with its own `.ps-lib-thumb-wrap` instead of `attachThumbScale`; it is a live render all the same.

The public OG and Slack preview (`server/render/preview-image.js`) is a separate raster: another size, its own cache, public. It shares the render helper, not the route.

## The raster route's contract

The route never blocks on Chrome, and with no raster to send it says which kind of nothing it is, so the card never has to guess:

| Answer                                    | When                                                                                                                                                                    | The card                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `200` WebP, `ETag`, `private, no-cache`   | the raster for the current slide 1 and theme exists, or the previous one does (stale-while-revalidate, tagged with its own name); a matching `If-None-Match` gets `304` | shows it                                |
| `404 thumbnail_pending`, `Retry-After: 3` | generation is running                                                                                                                                                   | waits as told, asks again at most twice |
| `404 thumbnail_unavailable`, `message`    | the deck has no slides, its stored theme cannot be loaded, or the last generation for this key failed less than five minutes ago (the reason is the message)            | shows the theme-colored placeholder now |

A failed generation (Chrome missing or crashing, resize or cache write failing) is remembered per cache key for five minutes (`FAILURE_TTL_MS`) and logged once as a `[WARN] [deck-thumbnail]` line with the cause. Within that window no new launch is attempted for that key, so a broken browser costs one launch per deck per five minutes rather than one per card per page load. `npm run doctor` starts the browser for real (`chromium` check), so a binary that exits at launch is red there too.

The client side is `client/views/list/thumbnail-request.js`: it fetches the raster instead of setting an `<img src>`, because an image element sees "error" for both 404s alike. The browser cache applies to the fetch as it did to the image, ETag and `304` included.

Generation is also warmed off the request path: publishing warms at once, a save that changes slide 1 warms after five seconds of quiet (`server/render/thumbnail-warm-queue.js`).
