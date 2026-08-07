# Bundled gradients

The image source that ships *inside* Deckyard: a set of abstract gradients
rendered from the built-in themes' own palettes, served as static SVG from
`/assets/gradients/`. No API key, no attribution, no rate limit, no external
request.

It exists because every other stock source is a third-party API with a licence
attached, and the public sandbox — where uploads are off and the slide library
is hidden — had no other image source at all. This one closes the licence
question rather than answering it.

## Turning it on

Off by default on every install. An admin enables it under
**Settings → Admin → Stock Media → Enable bundled gradients**, which writes:

```json
{ "stockMedia": { "bundled": { "enabled": true } } }
```

Once on, the editor's image picker offers **Gradients** beside the image
library (and ImageKit, where configured). With exactly one source enabled the
picker opens it directly; with more than one it shows the source chooser first.
See [`image-picker-seam.md`](image-picker-seam.md).

## How the set is derived

`server/media/bundled-gradients.js` is the whole model:

- **`paletteFromTheme(theme)`** reads a theme's `brandColors` plus its
  `--t-slide-bg-dark` / `--t-slide-bg-lime` / `--t-slide-bg-mist` /
  `--t-color-accent` tokens. A theme missing any of those yields *no* palette —
  a half-derived gradient would be worse than none.
- **`GRADIENT_COMPOSITIONS`** are the recipes the palette is poured into:
  `aurora`, `halo`, `dawn`, `drift` over the theme's deep background, and
  `mist` over its paper background.
- The library is **themes × compositions**, sorted by id. Six built-in themes ×
  five compositions = 30 gradients today.

Each item's **tone** (`dark` / `light`) is *measured* from the resolved base
colour, not declared by the recipe: Midnight's "paper" token is ink, so
`midnight-mist` is correctly a dark image. The picker exposes tone as its only
filter, because light-vs-dark is the choice that decides the text colour.

## Why the SVGs are committed

`assets/gradients/*.svg` are generated ahead of time and checked in. That is
the point of using `/assets/` rather than an `/api/` route: `toDataUrlIfLocal()`
inlines that prefix, so a gradient survives PDF/PNG export, published pages and
embeds with **no export-path change at all**.

Regenerate after changing a theme colour or a recipe:

```sh
npm run gen:gradients
```

`tests/bundled-gradients.test.js` re-renders every item and fails if a
committed file has drifted, so a stale asset cannot ship.

A fork that drops its own theme in `themes/` and re-runs the generator gets its
own gradients for free — no code change.

## API

| Route | Method | Response |
|-------|--------|----------|
| `/api/stock-media/status` | GET | `bundled: { configured: true, enabled }` — always `configured`; there is no key to miss. |
| `/api/stock-media/bundled/manifest` | GET | `{ items: [...] }`, or `400` when the toggle is off. |

A manifest item:

```json
{
  "id": "brand-aurora",
  "label": "Forest Aurora",
  "url": "/assets/gradients/brand-aurora.svg",
  "width": 1600,
  "height": 900,
  "alt": "Abstract aurora gradient in the Forest palette",
  "tone": "dark",
  "theme": "brand",
  "composition": "aurora",
  "tags": ["gradient", "aurora", "brand", "dark"]
}
```

A pick writes the `url` straight onto the slide. Nothing is copied into the
image library: the asset is already served and already inlined, so a copy would
only add a second address for the same bytes — unlike Unsplash and Giphy, whose
bytes have to be brought in-house.

## Implementation status

- The set is derived from `themes/*.json` only. Database and per-organization
  custom themes contribute nothing, because the bundled set has to match
  committed files.
- Alt seeds are English. A pick into a Dutch deck therefore seeds an English
  alt string, which the author can overwrite. Localising them would mean
  translating theme and composition labels; not decided.
