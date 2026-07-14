# Theme-defined slide background variants

A theme can ship named slide backgrounds beyond the built-in `lime`/`mist`
pair, each with optional contrast overrides. Variants appear in the per-slide
Background picker on every slide type that has a background field, with zero
per-slide-type code.

## Authoring (theme.json)

```json
"slideBackgrounds": [
  {
    "id": "calm",
    "label": "Calm",
    "value": "radial-gradient(circle at 62% 18%, ...), #140a26",
    "textColor": "#ffffff",
    "textColorMuted": "rgba(255, 255, 255, 0.72)"
  }
]
```

- `id` — css-class-safe slug (`^[a-z0-9][a-z0-9-]{0,31}$`), lowercased. The
  built-in ids (`lime`, `mist`, `dark`, `accent`, `brand-1`, `brand-2`,
  `custom`, `transparent`) are reserved and silently skipped — relabeling
  lime/mist stays a `theme.backgroundLabels` job.
- `value` — any CSS `background` value (colour, gradient, layered gradients).
- `textColor` (optional) — when set, the variant redirects the slide's
  `--color-text` / `--color-text-muted` tokens so all slide text flips to this
  colour (the same mechanism as background-image contrast, see
  `slide-background-contrast.md`).
- `textColorMuted` (optional, needs `textColor`) — explicit muted colour;
  defaults to a 70% `color-mix` of `textColor`.

The default `deckyard` theme ships a `calm` variant as a living example.

## How it works

Everything lives in `shared/theme-slide-backgrounds.js`; both theme
normalizers use it:

1. **Normalization** (`client/lib/theme.js` + `server/utils/themes.js`)
   validates entries into `theme.slideBackgrounds` and merges
   `--t-slide-bg-<id>[-text[-muted]]` into `theme.cssVars`, which flow through
   the existing per-slide var application and export CSS emission untouched.
2. **Generated CSS** — one rule per variant:
   `.slide.slide-bg-<id> { --slide-bg: ...; background: ...; }` plus the
   token-redirect block when `textColor` is set. Injected client-side per
   theme (`injectThemeSlideBgStyles`, like theme fonts) and appended to
   `themeVarsCssText()` so every export (HTML/PDF/PNG/print) gets it.
   Two-class specificity makes variants override slide types whose roots
   hardcode `background: var(--slide-bg-mist)`.
3. **Class emission** — `bgClass()` / `bgClassExtended()`
   (`shared/slide-types/helpers.js`) map any safe slug to `slide-bg-<slug>`.
   An id the active theme doesn't define is an inert class: the slide falls
   back to its default background.
4. **Editor picker** — `client/views/editor/fields/background.js` appends
   variants to the base options; swatches resolve via the existing
   `--t-slide-bg-<id>` convention (gradients render as swatch backgrounds).
5. **Validation** — `validateSlide` accepts any safe slug for the
   `background` field (validation has no theme context).

## Boundaries / follow-ups

- The AI schemas still only suggest `lime`/`mist`; variants are an authoring
  feature.
- Database-built custom themes (theme builder wizard) don't expose variants
  yet — this is a file-theme (fork) feature for now.
- `theme.gradient.enabled` (quote/chapter gradient) is an older, separate
  mechanism; folding it into a variant entry is a possible future cleanup.
- Text on opaque light card surfaces (icon-card bodies, card-stack bodies)
  deliberately stays dark under flipped variants — those surfaces stay light.
