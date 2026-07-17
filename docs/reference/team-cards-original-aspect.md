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
**no-JS fallback** (static/server render): correct, just not optimally filled.

### JS justify pass (`client/lib/team-cards-autofit.js`, `justifyOriginal`)

Runs inside the existing team-cards auto-fit runtime (client-side only, not in
thumbnail mode). It reads each image's intrinsic aspect ratio (so it re-runs on
image `load`) and packs the images into rows greedily, picking each row's
height so the row spans the full slide width — a classic "justified gallery".
It then pins each card's width to its rendered image width, which:

- keeps a long caption wrapping to the image width instead of widening the card
  past its image (which would also desync the packing from where flexbox
  actually wraps), and
- makes a handful of wide screenshots fill a single full-width row (gap 2).

The last, partial row is left at the max height rather than stretched, so a
lone trailing image stays a sensible size. After justifying, the runtime's
normal overflow pass uniformly scales the whole grid down if the taller,
filled layout now exceeds the slide height.

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
