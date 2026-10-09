# Slide background images: contrast, text colour & overlays

Any slide type can carry a full-bleed background image (the global
`slideBgImage` field, injected centrally in
`shared/slide-types/presentation.js` — no per-type code). This page documents
how text stays readable over that image, and what a **theme** must define to
make it work.

## The three controls (per slide)

| Field                             | Values                                                                       | Meaning                                               |
| --------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| `slideBgImage`                    | URL                                                                          | The image.                                            |
| `slideBgFit`                      | `cover` \| `contain`                                                         | Crop-to-fill vs letterbox.                            |
| `slideBgFocusX` / `slideBgFocusY` | 0–100                                                                        | Which part stays visible when cropped.                |
| `slideBgText`                     | `auto` \| `light` \| `dark`                                                  | Text colour over the image. `auto` is the default.    |
| `slideBgOverlay`                  | `auto` \| `none` \| `light` \| `dark` \| `gradient-top` \| `gradient-bottom` | Scrim/gradient over the image. `auto` is the default. |

Three derived, code-written fields are stored on the slide (not user-editable):
`slideBgTextAuto` (`light`/`dark`), `slideBgNeedsScrim` (bool) and
`slideBgAutoFor` (the image URL they were measured on). They are the persisted
result of the detection described below.

## How `auto` text colour works

When `slideBgText` is `auto`, the image's title region is sampled, the WCAG
contrast of the theme's two candidate text colours is computed against it, and
the winner is stored in `slideBgTextAuto`. At render time (editor, presenter,
exports) the slide gets `has-slide-bg-light-text` or `has-slide-bg-dark-text`
accordingly.

Two samplers, one rule (B627). The rule — region, sample size, threshold,
scrim fraction — is `shared/bg-image-contrast.js`; both samplers cut the same
region, scale it to the same square and hand the pixels to it:

- **The storage write seam** (`server/utils/bg-image-contrast.js`, sharp) runs
  on every create and every write that carries slides, for each slide whose
  `slideBgAutoFor` does not name its current image. It sets the three fields
  and turns an unset `slideBgText` into `auto`, so a deck that never meets the
  editor — made over MCP, imported, generated — presents, shares and exports
  with a readable title. It runs after the slide-lock check, so the verdict
  never reads as an edit of a locked slide, and skips saves that come from the
  collab doc (the editor measures those itself).
- **The editor** (`client/lib/slide-authoring/bg-contrast.js`, a canvas)
  measures when it shows a slide whose image has no verdict yet.

Key properties:

- **The choice is between the theme's own colours**, not hard-coded black/white
  (see "What a theme must define"). A dark image under a light-on-dark theme
  simply re-picks light — no spurious swap.
- **Detection runs once per image and is persisted.** Renders (PDF/PNG/PPTX/
  standalone HTML) never sample pixels; they read the stored `slideBgTextAuto`.
  Re-pick by changing the image or toggling the field.
- **Only local images are measured.** The server reads what this installation
  serves from disk (uploads, `/assets/`, `/custom/assets/`); the editor cannot
  sample a cross-origin image (tainted canvas). An image neither can read keeps
  no verdict and the slide falls back to the theme default.

`light` / `dark` skip detection and force the theme's light / dark text colour.

## How `auto` overlay works

When `slideBgOverlay` is `auto`, a subtle scrim is added **only when** detection
flagged the image as too busy for readable text (`slideBgNeedsScrim`). The scrim
tint follows the chosen text colour (dark scrim under light text, light scrim
under dark text). It is position-independent (a gentle full scrim).

- `none` — explicitly no overlay, even if a scrim was suggested.
- `light` / `dark` — flat scrims (`rgba(255,255,255,.55)` / `rgba(0,0,0,.45)`).
- `gradient-top` / `gradient-bottom` — a half-opacity dark gradient darkening
  one edge behind the text, fading to clear. Use when the title sits near the
  top or bottom and you want the rest of the photo untouched.

## What a theme must define

Auto-contrast keys off the theme record's `colors.textLight` and `colors.textDark` (also present in seed records):

```json
{
  "colors": {
    "textLight": "#ffffff",
    "textDark": "#212121"
  }
}
```

- `colors.textLight` — the colour used on dark backgrounds. Default `#ffffff`.
- `colors.textDark` — the colour used on light backgrounds. Default `#212121`.

These flow to the CSS custom properties `--t-text-color-light` /
`--t-text-color-dark`, which the background text classes consume. They are the
same tokens used for auto-contrast on accent buttons and icon-card backgrounds,
so setting them once covers every "readable text on a coloured/photo surface"
case in the theme.

You do **not** need a per-theme or per-slide "light-on-dark" flag: the model is
"pick whichever of the two theme colours contrasts best with this image",
which works regardless of whether the theme is normally light-on-dark or
dark-on-light. If a theme omits these fields, the `#ffffff` / `#212121`
defaults apply.

Muted variants (subtitles, captions) are derived from the chosen colour with
`color-mix`, so brand tints stay on-palette without extra theme config.

## CSS hooks (for slide-type authors)

The root `.slide` gets one of `has-slide-bg-light-text` /
`has-slide-bg-dark-text`, which redirect `--color-text` / `--color-text-muted`.
If your slide type paints text on its **own opaque light surface** sitting on
top of the image (a card, a panel), re-assert dark text for it — preferably by
giving the element an `on-surface-*` class (see
[`nested-surfaces.md`](nested-surfaces.md)); the unconverted remainder is the
`:is(.icon-card-body, .matrix-cell)` list in
`client/styles/slides/01-layout-and-title/00-base.css`.
