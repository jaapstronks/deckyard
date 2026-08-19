# Video slides in PDF export

A video slide can't play inside a static PDF. When a deck is exported to PDF
(the server-rendered `pdf-slides.pdf` path), each video slide is replaced by a
**"watch online" placeholder** instead of the live embed.

## What the placeholder looks like

- **Left:** a laptop outline (CSS chrome, not hand-authored path data) framing
  a still of the video with a play badge overlaid. The still reuses the video's
  own thumbnail/poster where one can be resolved (Bunny/YouTube/Vimeo); when it
  can't, a neutral gradient stands in. See
  [How the still is resolved](#how-the-still-is-resolved-server-side).
- **Right:** copy in the deck's language explaining this is a video slide, plus
  the live URL where the video can be watched. The printed link text drops the
  scheme (`go.ciiic.nl/our-video`, not `https://go.ciiic.nl/our-video`) because a
  reader has to read or retype it; the `href` keeps the full URL.

## How the still is resolved (server-side)

`resolveVideoThumbnailDataUrl(content)` in `server/export/video-thumbnail.js`
fetches the poster and returns it **already inlined as a `data:` URL**, for both
the PDF and the PNG placeholder. It does not emit a remote `<img src>` for the
generic export embed pass to pick up, because two Bunny quirks make that pass
drop the image:

1. **The pull zone isn't in the slide.** A Bunny thumbnail lives at
   `https://<pullzone>.b-cdn.net/<videoId>/thumbnail.jpg`, and the pull zone used
   to come only from `BUNNY_PULLZONE` — an env var documented as an optional
   _PPTX_ setting. A fork that never enabled PPTX video embedding got an empty
   grey box. The pull zone is now discovered from the library's own play page
   (`og:image`) and cached per library id for the process; a configured
   `BUNNY_PULLZONE` still wins and skips the lookup. The discovered URL is only
   accepted when it is `https`, on a `*.b-cdn.net` host, and names the video id
   we asked for.
2. **Bunny pull zones ship with hotlink protection.** A request without a
   `Referer` gets a 403, and the generic embed pass sends none. The fetch here
   passes `Referer: https://iframe.mediadelivery.net/` (the player host every
   Bunny library allows by construction) through the same SSRF guard.

YouTube (`img.youtube.com`) and Vimeo (`vumbnail.com`) have neither problem and
take the same path, so every provider ends up as inlined bytes.

## How the watch URL is resolved (server-side)

`resolveVideoWatchUrl(slide, pres, { baseUrl, slideIndex })` in
`server/export/video-watch-url.js` walks a ladder:

0. **Explicit `watchUrl`** — the slide's own `watchUrl` field, if the author
   filled one in. The generated rungs below are correct but long (the deck
   deep-link carries a UUID), and print is where that hurts most; this is the
   escape hatch for a short, human-chosen link such as a link-shortener URL.
   A scheme-less value (`go.ciiic.nl/our-video`) is read as `https://`; anything
   that isn't http(s) with a real host is ignored and the ladder continues, so a
   typo costs the reader nothing.
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

### Filling in a watch link

The field is `watchUrl` on the video slide ("Watch link for the PDF export" in
the editor). It is PDF-only: the PNG placeholder shows the still and the title,
not a link. It is `ai: false` — an agent can't know that a short link exists, let
alone which one — so it is authored by hand. Automating it (generating the short
link through a shortener API at export time) is a separate, open item:
`docs/plans/briefs/video-slide-export-placeholder.md` § B.

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
- `server/export/video-thumbnail.js` — poster resolution + inlining (shared with
  the PNG export).
- `server/utils/video-slide-html.js` — the PNG placeholder markup.
- Tests: `tests/video-watch-url.test.js`, `tests/video-thumbnail.test.js`.
