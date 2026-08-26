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
    "textColorMuted": "rgba(255, 255, 255, 0.72)",
    "linkColor": "#8fd0ff"
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
  `slide-background-contrast.md`). It is also a **statement about the ground**,
  not only a colour — see below.
- `textColorMuted` (optional, needs `textColor`) — explicit muted colour;
  defaults to a 70% `color-mix` of `textColor`.
- `linkColor` (optional, needs `textColor`) — explicit `--color-link` for the
  variant. When omitted the link colour is **derived** the same way the
  background-image contrast classes derive theirs: the brand accent mixed 42%
  toward the variant's `textColor`, which lightens the accent on a dark variant
  and darkens it on a light one. So a variant that flips its text colour gets a
  readable link for free — set `linkColor` only to override that answer.

The default `brand` theme (and `amethyst`) ships a `calm` variant
as a living example.

## What `textColor` declares

Choosing a light `textColor` says the ground under it is dark; choosing a dark
one says it is light. That is a fact about the variant, and other CSS needs it:
a card that is white on a light ground has to become glass on a dark one, a
table header has to invert its tint, a KPI tile needs a border it does not need
otherwise.

So a variant with a readable `textColor` also gets the slide-level contrast
class the background-image path uses — `has-slide-bg-light-text` on a dark
ground, `has-slide-bg-dark-text` on a light one — put on the root `.slide`
element by `renderSlideHtml`. **Select on that class**, never on a background
name: `.slide-bg-calm` happening to be dark is a property of one theme's palette
and no contract at all.

Three rules keep it honest:

- **No `textColor`, no class.** A variant that does not flip its text has
  declared nothing, and a guess would be worse than silence. The same goes for a
  `textColor` we cannot read as a colour (a `var()`, an `rgba()` string).
- **A background image wins.** An image is the ground the text sits on, so its
  own answer (authored, or sampled at edit time) outranks the variant's.
- **The colours stay the variant's.** The generic class in `00-base.css` carries
  a default text/link colour; the generated `.slide.slide-bg-<id>` rule
  overrides it, because it is laid down after the slide stylesheets in every
  path (client injection, embed, export, MCP preview).

Retrofitting the per-slide-type CSS that still keys on `.slide-bg-lime` /
`.slide-bg-calm` / `.slide-bg-dark` onto this class is tracked separately — see
`docs/plans/TODO.md`. Until that lands, a variant gets correct slide-level
contrast but not every per-type treatment.

## How it works

Everything lives in `shared/theme-slide-backgrounds.js`; both theme
normalizers use it:

1. **Normalization** (`client/lib/theme/theme.js` + `server/utils/themes.js`)
   validates entries into `theme.slideBackgrounds` and merges
   `--t-slide-bg-<id>[-text[-muted]][-link]` into `theme.cssVars`, which flow through
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
   back to its default background. `renderSlideHtml` then adds the luminance
   class (`slideBackgroundContrastClass`) at the wrapper seam, next to the
   background-image and logo injections — so it covers every slide type, custom
   ones included, and only when the type honoured the background field.
4. **Editor picker** — `client/views/editor/fields/background.js` appends
   variants to the base options; swatches resolve via the existing
   `--t-slide-bg-<id>` convention (gradients render as swatch backgrounds).
5. **Validation** — `validateSlide` accepts any safe slug for the
   `background` field (validation has no theme context).

The picker's option set (a type's declared options extended with the theme's
variants, deduped) is `mergeBackgroundOptions` in
`shared/theme-slide-backgrounds.js`, so the `npm run theme:preview` contact
sheet walks exactly the matrix the editor offers — see
[theme-config.md § Checking a theme](theme-config.md#checking-a-theme).

## Boundaries / follow-ups

- The AI schemas still only suggest `lime`/`mist`; variants are an authoring
  feature.
- Database-built custom themes express variants through their `config` column
  (`config.slideBackgrounds`, same entry shape and same `normalizeSlideBackgrounds`
  guard as a file theme). There is no UI for it yet — the Theme Studio will add
  one — but the API accepts it on `POST`/`PUT /api/themes/custom[/:id]`.
- `theme.gradient.enabled` (quote/chapter gradient) is an older, separate
  mechanism; folding it into a variant entry is a possible future cleanup.
- Text on opaque light card surfaces (icon-card bodies, card-stack bodies)
  deliberately stays dark under flipped variants — those surfaces stay light.
