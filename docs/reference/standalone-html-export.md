# Standalone HTML export

Deckyard can export a deck as a single self-contained `.html` file (the
"Download → HTML" action, `buildStandaloneHtml` in `server/export/html.js`).
The same builder also renders the published `/p/<slug>` page; the `context`
argument (`'export'` vs `'published'`) selects the visibility filter.

The design goal for the downloaded file is **works offline**: opening it from
disk, with no server to resolve app-relative URLs, must still render the deck
exactly as published.

## URL parameters

The runtime reads its options from the URL, so **one exported file serves every
case** — full-page at `/p/`, chrome-less in an iframe, kiosk loop on a screen —
without re-exporting. They apply to the downloaded `.html` and to `/p/` alike.

| Param      | Values                                                | Effect                                                                                                      |
| ---------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ui`       | `min`                                                 | Hide the topbar and the control row; the scaled stage fills the frame. Anything else is the default chrome. |
| `loop`     | `1`/`0` (also `true`/`false`, `on`/`off`, `yes`/`no`) | Autoplay and restart at the end. Overrides the deck's auto-advance setting.                                 |
| `autoplay` | same                                                  | Autoplay without looping at the end.                                                                        |
| `interval` | `1`–`300`                                             | Seconds per slide; overrides per-slide and deck defaults.                                                   |

The `#slide=N` hash deep-links to a slide and is kept in sync while navigating;
it combines with the params above (`?ui=min#slide=2`).

### `ui=min`

Same name and meaning as `buildEmbedHtml`'s `ui` option, so the two runtimes
share one vocabulary. It exists because `/p/` pages get iframed: with the chrome
in place a host page cannot size the frame by aspect ratio (it has to add a
fixed chrome height, which silently rots), and below ~400px wide the topbar and
the buttons each wrap to two lines and squeeze the slide to a strip.

It is CSS only — `?ui` is parsed by a small script at the top of `<body>` (before
the shell renders, so no chrome flashes) which puts `.ui-min` on `<html>`. The
chrome stays in the DOM, which is why:

- **keyboard navigation and fullscreen keep working** (arrows/space/Home/End,
  `F`, `Esc`) — with the buttons gone they are the whole interaction surface;
- **`#srStatus` still announces** "Slide 3 of 9: <title>" on every change, so
  dropping the visible counter costs no accessibility;
- the deck's own auto-advance/loop runtime is unaffected.

Two deliberate choices about what "min" keeps:

- **The 3px progress fill stays**, absolutely positioned so it adds no layout
  height. A reader in an iframe still benefits from seeing there are nine
  slides; it is not interactive and cannot wrap, and keeping the frame exactly
  16:9 is the point of the mode.
- **The slide counter and the loop bar go.** The counter is the part that wraps
  at narrow widths and the host page can render its own; the loop bar is an
  operator control, not reader information.

## What gets inlined

Everything the page needs is embedded into the one HTML file:

| Asset                                                        | How                                   | Where                                                             |
| ------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------- |
| Slide images / uploads                                       | base64 data URLs                      | `embedSlideImages`, `embedImgSrcDataUrls` (`html-utils.js`)       |
| Lucide icon SVGs / client assets                             | base64 data URLs                      | same image-embed pass (`includeClient: true`)                     |
| Theme fonts (curated + uploaded)                             | base64 `@font-face` data URLs         | `buildEmbeddedFontCss` from `theme.embedFonts` (`embed-fonts.js`) |
| Any other `/assets/...` font a bundled stylesheet references | base64 data URLs, in place            | `inlineLocalFontUrls` (`embed-fonts.js`)                          |
| Viewer chrome + slide CSS                                    | inlined `<style>` (imports flattened) | `readCssWithImports`, `loadExportCssBundle`                       |

### Which CSS ships — the viewer boundary

An exported deck is a **viewer**, not the editor, so `loadExportCssBundle`
bundles `client/styles/export.css`, **not** the editor entrypoint `app.css`.
`app.css` drags in ~630 KB of editor-only CSS (modals, inspectors, the
slide-type picker, settings, analytics) that no exported DOM ever references —
it only shipped because the bundle used to inline `app.css` wholesale, which put
a ~1 MB `<style>` block on every download.

`export.css` is a thin chrome layer: `client/styles/shared/ui-tokens.css` (the
design tokens the presenter chrome in `slides.css` reads unfallbacked) and the
`.btn` family + `.form-input` + `.row`
that the exported deck nav and the pdf/png/print toolbars use. The presenter chrome itself (`.presenter-*`, `.deck-slide`,
`.sr-only`, `.skip-link`, progress bar) already lives in `slides.css`. This
mirrors `embed.css`, the iframe viewer's entrypoint, which drops `app.css` the
same way.

The boundary is a maintained line: `tests/export-css-boundary.test.js` fails if
editor-only selectors creep back in or if a viewer selector the DOM needs goes
missing. If you change `.btn` in `app/components.css`, mirror it in `export.css`
(the rules are copied verbatim so exported buttons look identical). Trimming the
remaining bulk — `slides.css` is ~310 KB of per-slide-type CSS shipped whole —
is separate, out-of-scope work.

`inlineLocalFontUrls` rewrites any root-relative `url('/…​.woff2')` in the CSS
to a data URL by reading the file from the repo. No built-in stylesheet
declares an `@font-face` any more — slide text is served by the theme's
`embedFonts` and the export _chrome_ deliberately resolves `--ps-font-sans`
through its native system fallback — so this is the safety net for a **custom**
theme that ships its own `/custom/…` face in a stylesheet the bundle picks up.
It is what guarantees the invariant the tests assert: no `/assets/`-style font
reference survives into a downloaded file.

## Font-size trade-off

Only the font files the CSS **actually references** are embedded, and each
distinct file exactly once. The full pinned font library is ~2.7 MB across all
curated families; embedding all of it would bloat every export, so we never do.

Measured on the built-in themes, the embedded `@font-face` block is:

| Theme                         | `@font-face` rules | Embedded fonts |
| ----------------------------- | ------------------ | -------------- |
| `deckyard` (default), `brand` | 4                  | ~253 KB        |
| `corporate`                   | 4                  | ~141 KB        |
| `editorial`                   | 4                  | ~205 KB        |
| `midnight`                    | 6                  | ~286 KB        |
| `playful`                     | 10                 | ~171 KB        |

Two numbers explain the shape of that table. **Two Latin subsets**: Google
splits every family into a disjoint `latin` and `latin-ext` file, and both ship
(see `docs/reference/font-management.md`) — dropping `latin-ext` would render
every Polish, Czech, Turkish and Hungarian letter in a fallback face. **One
file per variable family**: Google serves a single variable `woff2` for all of
a family's weights, so a heading font and a body font come to four files, not
one per weight. `playful` is the outlier at ten rules because Poppins is a
_static_ family — genuinely one file per weight.

Base64 costs a third on top of the raw bytes; the numbers above are the encoded
size, which is what actually lands in the file.

The one exception is **external** managed fonts (Adobe / Monotype / Google via
`<link>`/`<script>`): those still require network access. Only local (curated
`/assets/...`) and uploaded fonts are base64-embedded for true offline use. See
`docs/reference/font-management.md` for the font-source distinctions.

## Third-party requests

Everything above is inlined, so the only things a reader's browser can fetch
from someone else's server are the three optional runtime libraries. All three
are conditional — a deck with no code, no math and no video makes **zero**
third-party requests:

| Library           | Loaded when                                          | Emitted by                                                            |
| ----------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| Prism (jsDelivr)  | a slide renders a `.md-code-block`                   | `detectPrismKatexNeeds` → `buildPrismKatexCdnTags` (`prism-katex.js`) |
| KaTeX (jsDelivr)  | a slide renders `.md-math-block` / `.md-math-inline` | same                                                                  |
| Bunny `player.js` | the reader reaches a slide with a Bunny video iframe | `ensureBunnyPlayerJs()` in the page runtime                           |

Detection reads the **rendered slide HTML**, not the deck model, so it can't
drift from what the init script queries and it covers custom slide types for
free. Prism additionally loads only the language packs the deck uses
(`language-*` classes), resolved through an alias/dependency map; languages the
default Prism bundle already contains (markup, CSS, JavaScript) and unknown
languages get no extra script.

Bunny is not detected at build time at all: the eager `<script>` tag in the head
was redundant with the runtime's own lazy `ensureBunnyPlayerJs()`, which is what
the live app has always used. The same applies to the embed runtime
(`server/utils/embed-html/template.js`).

The render paths that rasterize a deck server-side (PNG, PDF, print) still load
the fixed default set; they run in headless Chrome, not in a reader's browser.

## Verifying

Download an export (or generate one via `buildStandaloneHtml`) and open it with
**no server serving `/assets`** — e.g. a bare static server rooted at the file's
own directory, or `file://`. The deck's fonts must render, and there must be no
`/assets/fonts/*.woff2` requests (they would 404). A regression test lives in
`tests/export-font-embed.test.js`.
