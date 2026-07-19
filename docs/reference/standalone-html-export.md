# Standalone HTML export

Deckyard can export a deck as a single self-contained `.html` file (the
"Download → HTML" action, `buildStandaloneHtml` in `server/export/html.js`).
The same builder also renders the published `/p/<slug>` page; the `context`
argument (`'export'` vs `'published'`) selects the visibility filter.

The design goal for the downloaded file is **works offline**: opening it from
disk, with no server to resolve app-relative URLs, must still render the deck
exactly as published.

## What gets inlined

Everything the page needs is embedded into the one HTML file:

| Asset | How | Where |
|-------|-----|-------|
| Slide images / uploads | base64 data URLs | `embedSlideImages`, `embedImgSrcDataUrls` (`html-utils.js`) |
| Lucide icon SVGs / client assets | base64 data URLs | same image-embed pass (`includeClient: true`) |
| Theme fonts (curated + uploaded) | base64 `@font-face` data URLs | `buildEmbeddedFontCss` from `theme.embedFonts` (`embed-fonts.js`) |
| Shared / UI fonts referenced by `/assets/...` in the bundled CSS | base64 data URLs, in place | `inlineLocalFontUrls` (`embed-fonts.js`) |
| App + slide CSS | inlined `<style>` (imports flattened) | `readCssWithImports`, `loadExportCssBundle` |

`inlineLocalFontUrls` rewrites any root-relative `url('/…​.woff2')` in the CSS
to a data URL by reading the file from the repo. It covers the shared UI
weights that no theme owns — e.g. `client/styles/shared/fonts.css`
(Bricolage Grotesque) — which `theme.embedFonts` does not cover. Theme fonts
are handled separately by `buildEmbeddedFontCss`; the two mechanisms are
complementary.

## Font-size trade-off

Only the font files the CSS **actually references** are embedded — typically a
couple of small `woff2` weights (a few KB each). The full managed font library
is ~2.5 MB across all themes; embedding all of it would bloat every export, so
we never do. This keeps a standalone export's font payload proportional to what
the deck uses (usually well under ~100 KB of fonts), while still rendering
offline.

The one exception is **external** managed fonts (Adobe / Monotype / Google via
`<link>`/`<script>`): those still require network access. Only local (curated
`/assets/...`) and uploaded fonts are base64-embedded for true offline use. See
`docs/reference/font-management.md` for the font-source distinctions.

## Verifying

Download an export (or generate one via `buildStandaloneHtml`) and open it with
**no server serving `/assets`** — e.g. a bare static server rooted at the file's
own directory, or `file://`. The deck's fonts must render, and there must be no
`/assets/fonts/*.woff2` requests (they would 404). A regression test lives in
`tests/export-font-embed.test.js`.
