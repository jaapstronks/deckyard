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

| Param      | Values                                                | Effect                                                                                                                                                                            |
| ---------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui`       | `min`, `strip`                                        | `min` hides the topbar and the control row; the scaled stage fills the frame. `strip` drops the topbar and puts one toolbar below the stage. Anything else is the default chrome. |
| `loop`     | `1`/`0` (also `true`/`false`, `on`/`off`, `yes`/`no`) | Autoplay and restart at the end. Overrides the deck's auto-advance setting.                                                                                                       |
| `autoplay` | same                                                  | Autoplay without looping at the end.                                                                                                                                              |
| `interval` | `1`–`300`                                             | Seconds per slide; overrides per-slide and deck defaults.                                                                                                                         |

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

### `ui=strip`

The stage on top, edge to edge, and one toolbar of `--controls-strip-height` (48px, on `:root`) below it, B268/D102. The hosted embed has the same strip in the same places, so a site that iframes either one can drop its own arrows over the slide.

- **What is in it:** Previous, Next and the counter on the left, Fullscreen on the right, as icon buttons. The buttons keep their ids (`btnPrev`, `btnNext`, `btnFs`) and their `aria-label` as the accessible name; the icons are `aria-hidden`. Height and icons come from one module, `server/utils/controls-strip.js`, which the embed reads too.
- **Loop controls only when the deck loops:** the Loop button and the seconds field show when the deck's auto-advance is on or the URL asks for `?loop=1`/`?autoplay=1`. The default row keeps offering them always.
- **The progress fill** becomes a 2px line along the strip's top edge; the topbar is gone.
- **Sizing the iframe:** 16:9 plus the strip, for example `height: calc(var(--w) * 9 / 16 + 48px)`. The strip is a fixed height, so it does not rot the way the default chrome's wrapping rows do.
- **In fullscreen** the strip is the bottom bar of the contract below: its row collapses, and it returns as an overlay on pointer activity.

The default control row also has a Fullscreen button now (it used to hang on the `F` key only).

### Fullscreen

The page shares one fullscreen contract with the in-app presenter (D111). The two presenter modules, `client/views/presenter/fullscreen.js` and `client/views/presenter/chrome-autohide.js`, are inlined by the script chain (`clientModules` in `server/utils/script-chain.js`), not copied:

- **Fullscreen is one class, `html.is-fullscreen`**, set when the Fullscreen API is active (`F`, which fullscreens the `.presenter-shell`) or when the window covers the whole screen (Safari's green button, F11). The CSS keys on that class only.
- **Both bars become overlays.** The chrome rows collapse, the stage fills the viewport and the root cannot scroll. The top bar and the control row are hidden on entry, appear on pointer movement, touch, or keyboard focus inside a bar, stay while the pointer rests on one, and fade out (with the cursor) after about 2.6 s idle.
- **Navigation keys do not reveal them**, so a clicker does not flash the bars on every slide.
- **`ui=strip` is in it**: the strip is the bar that hides and returns, from the bottom edge.
- **`ui=min` stays out of it**: there are no bars to show, so the page wires neither the class nor the autohide and only keeps `F`.

A known edge: at a browser zoom below 100% a window that nearly fills the screen can measure as screen-filling. The bars then behave as in fullscreen but stay reachable with the mouse.

## What gets inlined

Everything the page needs is embedded into the one HTML file:

| Asset                                                        | How                                   | Where                                                             |
| ------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------- |
| Slide images / uploads                                       | base64 data URLs                      | `embedSlideImages`, `embedImgSrcDataUrls` (`html-utils.js`)       |
| Lucide icon SVGs                                             | base64 data URLs                      | same image-embed pass (`isRenderAssetRef`)                        |
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
design tokens the presenter chrome reads unfallbacked) and
`client/styles/shared/primitives.css`, the one definition of the `.btn` family,
`.form-input`, `.row` and the segmented control that `app.css` and `embed.css`
import too. The exported deck nav, the pdf/png/print toolbars and the published
page's language switch render those. The presenter chrome itself
(`.presenter-*`, `.deck`, `.deck-slide`, progress bar, start curtain) is the
viewer layer, `client/styles/viewer.css` (D267), which `export.css` imports
before `slides.css`, as `app.css` does; `.sr-only` and `.skip-link` stay in
`slides.css`. `embed.css`, the iframe viewer's entrypoint, drops `app.css` the
same way and loads no viewer layer: the embed shell styles its own deck box.

The boundary is a maintained line: `tests/export-css-boundary.test.js` fails if
editor-only selectors creep back in or if a viewer selector the DOM needs goes
missing, and `tests/css-one-definition.test.js` fails if a primitive is defined
anywhere but `primitives.css`. A viewer that needs a different look scopes an
override in its own entry file (`embed.css` sets the toolbar font under
`.ps-embed-controls`); it keeps no copy. Trimming the
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

There are none. Prism and KaTeX come from `client/vendor/` (pinned by
`package-lock.json`, hashed in a manifest) and the two contexts reach them
differently: a published `/p/` page **links** `/client/vendor/…`, so the browser
caches the files across decks; a downloaded file has no origin to resolve that
against, so it carries them **inline**. `buildPrismKatexTags({ …needs, mode })`
in `server/utils/prism-katex.js` is the single place that decides. The rule, its
carve-outs and the two gates that hold it up:
`docs/reference/no-third-party-origins.md`.

Both libraries stay conditional — a deck with no code and no math carries
neither:

| Library           | Loaded when                                          | Emitted by                                                         |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| Prism             | a slide renders a `.md-code-block`                   | `detectPrismKatexNeeds` → `buildPrismKatexTags` (`prism-katex.js`) |
| KaTeX             | a slide renders `.md-math-block` / `.md-math-inline` | same                                                               |
| Bunny `player.js` | the reader reaches a slide with a Bunny video iframe | `ensureBunnyPlayerJs()` in the page runtime — a lazy loader        |

Detection reads the **rendered slide HTML**, not the deck model, so it can't
drift from what the init script queries and it covers custom slide types for
free. Prism additionally loads only the language packs the deck uses
(`language-*` classes), resolved through an alias/dependency map; languages the
base bundle already contains (markup, CSS, JavaScript) and unknown languages get
no extra script.

An inlined KaTeX brings its fontset with it, base64'd into the stylesheet
(~400 KB): its relative `url(fonts/…)` references resolve against nothing in an
origin-less document, and KaTeX's layout assumes its own glyph metrics, so the
alternative is a visibly wrong formula rather than a differently styled one.
That cost lands only on decks that carry math.

Bunny is not detected at build time at all: the eager `<script>` tag in the head
was redundant with the runtime's own lazy `ensureBunnyPlayerJs()`, which is what
the live app has always used. The same applies to the embed runtime
(`server/utils/embed-html/template.js`).

The render paths that rasterize a deck server-side (PNG, PDF, print) inline what
the deck needs, for the same reason a download does: `page.setContent()` gives
Chrome a document with no origin.

## Verifying

Download an export (or generate one via `buildStandaloneHtml`) and open it with
**no server serving `/assets`** — e.g. a bare static server rooted at the file's
own directory, or `file://`. The deck's fonts must render, and there must be no
`/assets/fonts/*.woff2` requests (they would 404). A regression test lives in
`tests/export-font-embed.test.js`.
