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

Runs in the editor and presenter (not in thumbnail mode), and in every document
the script chain assembles: `server/utils/script-chain.js` inlines this same
module when `detectSlideRuntimeNeeds()` finds an uncropped, non-split
image-blocks slide — the standalone export and embed as well as the static
sheets (PNG, and through it PPTX and the PNG zip; PDF slides; print; the MCP
previews). The headless captures wait for it through
`server/utils/settle-rendered-page.js` (fonts, images, then two animation
frames) before they screenshot or print. It reads each image's intrinsic
aspect ratio (so it re-runs on image `load`) and packs the images into rows
greedily, picking each row's height so the row spans the full slide width — a
classic "justified gallery". It then pins each card's width to its rendered
image width, which:

- keeps a long caption wrapping to the image width instead of widening the card
  past its image (which would also desync the packing from where flexbox
  actually wraps), and
- makes a handful of wide screenshots fill a single full-width row (gap 2).

The last, partial row is left at the max height rather than stretched, so a
lone trailing image stays a sensible size. A set that still overflows the slide
after justifying clips at the slide edge — there is no shrink-to-fit pass
(removed with the rest of the slide shrink layer).

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
