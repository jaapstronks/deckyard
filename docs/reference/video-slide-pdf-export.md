# Video slides in PDF export

A video slide can't play inside a static PDF. When a deck is exported to PDF
(the server-rendered `pdf-slides.pdf` path), each video slide is replaced by a
**"watch online" placeholder** instead of the live embed.

## What the placeholder looks like

- **Left:** a laptop outline (CSS chrome, not hand-authored path data) framing
  a still of the video with a play badge overlaid. The still reuses the video's
  own thumbnail/poster where one can be resolved (Bunny/YouTube/Vimeo); when it
  can't, a neutral gradient stands in.
- **Right:** copy in the deck's language explaining this is a video slide, plus
  the live URL where the video can be watched.

## How the watch URL is resolved (server-side)

`resolveVideoWatchUrl(slide, pres, { baseUrl, slideIndex })` in
`server/export/video-watch-url.js` walks a ladder:

1. **Published deck deep-link** — if the presentation is published
   (`pres.published.id`) **and** a public base URL is configured, the link
   points at the published deck at that slide:
   `<baseUrl>/p/<publishId>-<slug>#slide=<index>`. The reader lands on the
   video slide and can click through the rest of the deck. The published viewer
   reads the initial slide from the `#slide=<0-based index>` hash.
2. **Provider URL** — otherwise, the video's own public URL:
   `https://www.youtube.com/watch?v=…`, `https://vimeo.com/…`, or the Bunny
   player page `https://iframe.mediadelivery.net/play/<lib>/<id>`. Always
   watchable, independent of whether the deck is published; no new backend.
3. **None** — no resolvable source: the placeholder shows a "not available
   online" line instead of a link.

### Base URL configuration

The base URL comes from `getAppBaseUrl()` (`APP_URL`, else `https://<DOMAIN>`,
else empty). It's fork-configurable because only the `slides.ciiic.nl` fork is
live; on a fork with no base URL set, the resolver simply falls through to
provider URLs.

### Autoplay

The landing page's autoplay follows the slide's own `autoplay` field. The
published-deck deep-link inherits it automatically (the video slide renders with
its own autoplay when the deck loads); the provider fallback appends the
provider's autoplay parameter when autoplay is on.

## Known limitation: slide index

The `#slide=<index>` deep-link uses the slide's index in the **export-filtered**
deck. This matches the published-deck index when the deck has no per-context
hidden slides (the common case). If export and published visibility diverge
(e.g. a slide is `hideInPublished` but not `hideInExport`), the link may land on
a neighbouring slide.

## Copy

The deck-language strings live in `videoPdfCopy(docLang)` in
`server/export/video-watch-url.js` (nl / en-GB; other languages fall back to
nl). Keep them centralised there rather than scattered through the renderer.

## Code

- `server/export/video-watch-url.js` — URL resolver + localised copy.
- `server/export/pdf-slides.js` — `renderVideoSlidePdfHtml()` builds the
  placeholder page and its scoped CSS (`.vpdf-*`).
- `server/utils/video-slide-html.js` — `getVideoThumbnailUrl()` (shared with the
  PNG export).
- Tests: `tests/video-watch-url.test.js`.
