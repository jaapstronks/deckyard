# Image blocks: `imageAspect: original` layout

How the **Image blocks** slide (`team-cards-slide`, `.slide-team-cards`)
renders when `imageAspect: original` is selected — the uncropped mode used for
screenshots and mixed-shape images, as opposed to the default `square` crop
used for headshots.

Applies to the non-split layout (`:not(.has-column-split)`). The two-group
column-split keeps its own subgrid rules.

## Goal

Show images at their true aspect ratio (no crop), while:

1. **Captions hug the image, not the grid cell.** Title/caption under (or
   around) an image align to the rendered image's edges, not to a wider
   fixed-width cell.
2. **A few images fill the slide.** A handful of screenshots grow to roughly
   fill the available area instead of sitting small.
3. **Uniform magnification.** Text inside screenshots stays legible and
   roughly equal-sized across images (images in a row share a height; widths
   differ by aspect ratio).

## How it works

Two cooperating layers:

### CSS (`client/styles/slides/03-components/45-team-cards.css`)

The `aspect-original` grid becomes a **centered, wrapping flex row** instead of
the fixed-column grid used for cropped photos. Every image is laid out at one
shared height (`--team-orig-photo-h`, a small boost over the per-count
`--team-card-photo`); the photo box shrink-wraps its image (`width: auto`,
`display: inline-flex`) so the card — and the caption beneath it — is exactly
the rendered image width. This alone satisfies gaps 1 and 3 and is the
**no-JS fallback**. It is not good enough to ship on its own: four landscape
images at the shared height wrap to a 2×2 grid that fills the slide and covers
the title. So every rendered document runs the JS pass below, server renders
included.

### JS justify pass (`client/lib/slide-runtime/team-cards-justify.js`, `justifyOriginal`)

Runs on **every** surface — editor, presenter, thumbnails and library tiles
included — and in every document the script chain assembles:
`server/utils/script-chain.js` inlines this same module when
`detectLayoutRuntimeNeeds()` (inside `detectSlideRuntimeNeeds()` for a stage)
finds an uncropped, non-split image-blocks slide —
the standalone export and embed as well as the static sheets (PNG, and through
it PPTX and the PNG zip; PDF slides; print; the MCP previews). The headless
captures wait for it through `server/utils/settle-rendered-page.js` (fonts,
images, then two animation frames) before they screenshot or print. It reads
each image's intrinsic aspect ratio (so it re-runs on image `load`) and packs
the images into rows greedily, picking each row's height so the row spans the
full slide width — a classic "justified gallery". It then pins each card's
width to its rendered image width, which:

- keeps a long caption wrapping to the image width instead of widening the card
  past its image (which would also desync the packing from where flexbox
  actually wraps), and
- makes a handful of wide screenshots fill a single full-width row (gap 2).

Thumbnails are not an exception, because there is nothing to except them from:
every measurement is a layout value (`clientHeight`, `offsetHeight`) and a
thumbnail is the same logical slide box under a transform. A thumbnail that fell
back to the CSS shared height advertised a different packing than the slide it
stands for.

The last, partial row is left at the ceiling rather than stretched, so a lone
trailing image stays a sensible size.

### The two bounds (D167)

A ceiling on one row is not a budget for the slide, and the pass needs both:

1. **The declared CSS ceiling** bounds a row's photo height. It is read as the
   resolved `max-height` of `.team-card-photo` — the stylesheet's own number.
   Reading `--team-orig-photo-h` instead does not work: it is an unregistered
   custom property, so `getPropertyValue` hands back the literal
   `calc(var(--team-card-photo) * 1.2)` text and `parseFloat` of that is `NaN`.
   The runtime used to fall back to `300` there, which made 300 the real
   ceiling and the declaration decoration. There is no fallback constant now: a
   slide that cannot be measured yet waits for a real measurement.
2. **The available content height** bounds all rows together. It is the
   `.slide-inner` box (which is `height: 100%` of the slide's content box) minus
   the heading, the bottom subheading and the flex gaps between them —
   deliberately _not_ `.team-cards-grid`'s own height, which its content can
   push past the slide edge and which would hand the packing back the overflow
   it exists to prevent.

The search covers positive ceilings in increments of 0.01 logical pixels, matching the precision emitted to CSS. It visits intervals from largest to smallest. Each interval has a fixed row partition and fixed integer card widths. Its lower boundary is the next completed-row threshold or the next card-width change in the partial last row. A partial row can become shorter without changing its membership; looking only at row transitions misses those fitting layouts.

Within one interval the text has the same width and wrapping, completed rows keep their justified heights, and only the partial last row's image height varies. The pass measures the upper and lower bounds. If the interval contains a fit, a bounded binary search finds its largest fitting ceiling. Across intervals it measures again: narrower captions can add lines, so the complete search is not monotone. Intervals whose row heights do not change are skipped after measurement.

The result is the largest fitting ceiling at the runtime's CSS precision. Four landscape images may occupy one row or several rows depending on the text and available height; no row count is prescribed by image ratio alone. Images retain their aspect ratios, text retains its font size, and no transform scales the content to fit.

**When no candidate fits**, the pass keeps the least-overflowing layout across all intervals, choosing the largest ceiling on a tie. It sets `align-content: flex-start` so overflow runs off the bottom and leaves the heading clear. No stored text is truncated. This conclusion is bounded by the stated layout precision; failure of a few row-transition candidates is not evidence of unavoidable overflow.

### Split titles line up per row

With `textPosition: split` the title sits above the image, so an image only
lines up with its neighbours if the titles above them do. The pass gives every
title in a computed row the `min-height` of the tallest title in that row, after
the card widths are pinned (titles wrap to the card width) and after clearing
the previous run's values so a re-run cannot grow monotonically.

The CSS aligns the row from the top (`align-items: flex-start`) rather than
from the bottom. Aligning card _bottoms_ only looked level while the bylines
happened to be the same length: a narrow card wraps its byline to more lines,
grows taller, and pushes its image up past its neighbours'. Bylines now hang
below their own card, which is where they belong.

## Why not route screenshots to the Gallery slide?

An alternative considered (and rejected 2026-07-17) was steering the
screenshot use case to `gallery-slide`'s masonry layout. Gallery renders images
with `object-fit: cover` (it **crops**) and caps at 6 images, so screenshots
would be cut off and their text lost — fatal for the uncropped-legible-text
requirement. Polishing `team-cards` `original` was the correct path.

## Regression surface

Changes are scoped to `.slide-team-cards.aspect-original:not(.has-column-split)`
and the justify pass (which no-ops unless that combination is present). The
default `square`/`circle` cropped grids and the column-split layout are
unaffected.

The contract above is pinned by two suites, both measuring a real browser:
`tests/team-cards-original-layout.test.js` (both bounds, the per-row title and
image alignment, the unavoidable overflow, the untouched neighbour layouts, and
observer cleanup after repeated mounts) and
`tests/export-team-cards-original.test.js` (the export surfaces carry the pass,
and 3:2 and 16:9 pin the chosen height against both bounds).
