# Export-safe CSS

_What a theme or a custom slide type may write in CSS, and which constructions
break on the way to PDF and PNG. Written for the person building a theme or a
`custom/slide-types/*.js`, who has no way to guess any of this from the
browser._

## The one thing to know

**A rendered document is not a web page.** It goes to headless Chrome through
`setContent()` with no base URL, gets printed through Skia into PDF, and is
then composited by whatever the reader uses — which on macOS is CoreGraphics,
not Chrome. Three separate places to lose something.

Every failure below is quiet: correct in the editor, wrong or blank in the
export. Nothing throws, nothing logs. That is the entire reason this page
exists — the CIIIC fork walked into three of these in one afternoon building a
single theme, each time discovering it only by looking at the PDF.

## Blurred shadows become luminosity masks

**Do not put a blurred `box-shadow` on anything that must survive print.**

Chrome turns a blurred `box-shadow` into a transparency group behind an
`/SMask << /S /Luminosity >>`. Ghostscript composites that correctly.
CoreGraphics — Preview, Quick Look, all of PDFKit — paints the group's
**bounding box solid** instead: a hard rectangle where the soft shadow should
be. Whether a given element hits it varies with layer promotion, so one card
looks fine and the next is boxed.

Core CSS handles this by flattening the elevation tokens in print
(`client/styles/slides/00-tokens.css`):

```css
@media print {
  .slide {
    --slide-shadow-sm: none;
    --slide-shadow-md: none;
    --slide-shadow-lg: none;
    --slide-shadow-card: none;
    --slide-shadow-elevated: none;
  }
}
```

**So: build elevation out of `var(--slide-shadow-*)` and you inherit the fix.**
Write your own `box-shadow` literal and you do not. That is exactly how it got
in twice — once on the export page's own chrome (PR #492), once on
`86-timeline-slide.css`'s dark variant, which set its own heavier value because
10%-black is invisible on a dark ground and so walked straight past the guard.
Cards keep their borders, so dropping the shadow in print costs nothing.

## `mix-blend-mode` does not survive

Blend modes leave Chrome as separation groups, and CoreGraphics composites them
differently than Chrome does — the same class of defect as the luminosity mask
above. A duotone built with `mix-blend-mode` looks right on screen and wrong in
the PDF.

The workaround that does survive: a greyscale `filter` plus a flat tint layer.
Less elegant, and it renders the same everywhere.

## Alpha gradients are rasterized for you (mostly)

A `radial-gradient` with alpha in its stops does not leave Chrome as a gradient
at all — Skia emits a per-pixel PostScript program that costs seconds per page
in a reader. `server/export/gradient-raster.js` renders such a background to a
bitmap instead, transparently. You do not have to avoid alpha gradients.

Two edges are worth knowing, because they are where the automation stops:

- **The raster page runs offline**, on purpose: it is opened before the SSRF
  guard has inlined anything, so it fetches no subresources at all. Nothing it
  renders may depend on an external image.
- **A background that stacks a gradient over an image is left alone**, for that
  reason and because baking a photograph into a 512px-wide bitmap is not a
  trade a soft gradient wash makes but a photo does not. Such a background
  keeps its live CSS: correct, and slower by the cost of one image.

## `url()` in a theme var works, and its address never reaches Chrome

A `slideBackgrounds` variant whose value is artwork, or a `--t-logo-url`, is
supported:

- a **local** path (`/uploads/`, `/assets/`, `/custom/assets/`,
  `/custom/themes/`) is inlined as a data URL, because a root-relative path has
  nothing to resolve against under `setContent()`;
- a **remote** `http(s)` URL goes through the SSRF guard — inlined if it
  resolves to a public address, otherwise blanked to `url('')`. It is never
  handed to Chrome live. See
  [`security-posture.md`](security-posture.md) § SSRF guard.

An asset that cannot be read keeps its original `url()` rather than being
silently rewritten, so the export shows the same missing asset the deck already
had.

Both halves used to be missing for theme vars specifically — the block is
assembled separately from the page markup and took no pass at all, so local
artwork rendered blank and a remote address went straight to Chrome. Fixed
2026-08-25; `tests/export-theme-var-assets.test.js` holds it.

## No third-party origins

A rendered document loads nothing from someone else's host: no CDN script, no
web font, no remote stylesheet. Fonts come from the repo or from `embedFonts`
in the theme. This is a separate, gated rule with its own page —
[`no-third-party-origins.md`](no-third-party-origins.md).

## What has not been measured

Honest gaps, so nobody reads absence as approval:

- **`backdrop-filter`** is used in presenter and editor chrome, neither of
  which is exported. Its behaviour in PDF has not been measured here; treat it
  as unknown rather than safe.
- **`filter`** beyond the greyscale case above.
- **`clip-path`**, **`mask`** on slide content. (`mask` with a local `url()` is
  known to work — that is what `icon-card-grid-slide` uses — but only because
  the embed pass inlines the source.)

If you measure one of these, add it here rather than to a code comment.

## Checking your own theme

There is no contact-sheet tool yet: the theme editor's live preview covers a
DB-theme draft and a handful of slides, not a file theme in
`custom/themes/<id>/theme.json` and not the rest of the registry. Building one
(`npm run theme:preview <id>`, every registered type × every background the
theme offers, plus a contrast report) is an open proposal — the pieces exist
(`renderSlideElement`, `loadExportCssBundle`, the Puppeteer plumbing in
`capture/run.js`, `contrast-badge.js`).

Until then: export a deck that uses every background your theme offers and open
the PDF **in Preview**, not only in Chrome. Preview is where the CoreGraphics
differences show, and it is the reader most people will use.

## See also

- [`pdf-export-performance.md`](pdf-export-performance.md) — what makes an
  export heavy and how to measure it
- [`theme-slide-backgrounds.md`](theme-slide-backgrounds.md) — declaring
  background variants
- [`slide-type-css-contract.md`](slide-type-css-contract.md) — the class names
  a slide type emits
- [`fork-setup.md`](fork-setup.md) — the `custom/styles/` seam
