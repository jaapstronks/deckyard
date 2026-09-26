# Logo wall layout

How `logo-wall-slide` sizes its logos. Code: `logoWallGrid` in
`shared/slide-types/types/logo-wall-slide.js`, the sizing in
`client/styles/slides/03-components/46-logo-wall.css`, the balance pass in
`client/lib/slide-runtime/logo-wall-balance.js`.

## One rule for every count

The renderer names the grid and writes it on the slide as `--lw-cols` /
`--lw-rows`: one row up to three logos, two rows from four, three from nine,
and never more than eight to a row (4 = 2x2, 6 = 3x2, 8 = 4x2, 12 = 4x3,
30 = 8x4). Logos are wide and flat, so a wall grows in rows sooner than a row
of cards would.

The CSS derives the cell from that grid: each cell takes its share of the
slide's content width (`100cqi`), capped at 440 reference pixels
(`--lw-cell-max`, on `--slide-canvas-unit`), and is 0.62 of its width tall.
Rows give way evenly when a header leaves less height than that, so a wall
never overflows the slide. Rows wrap and centre, so the short last row of an
uneven count sits under the middle of the row above. There is no per-count
table and no override field: the rule covers 1 to 30 (`MAX_LOGOS`).

## Optical balance

Every logo gets the same area, a square of 0.42 cells
(`--lw-logo-size`): its width is `cell × 0.42 × √aspect`. The aspect ratio is
the one thing CSS cannot read off an image, so the `logo-wall-balance` runtime
sets it per image as `--lw-aspect` once the image loads. It runs on every
render surface and is inlined into every exported document
(`detectLayoutRuntimeNeeds()` in `server/utils/script-chain.js`). Whatever the
area rule asks, a logo stays inside its frame: 96% of the width, 80% of the
height. Without the runtime (image not loaded yet) the width falls back to
auto and those caps alone size the logo.
