# Theme config (database themes)

Database themes store four colours, two fonts and two logo URLs, from which
`server/utils/theme-builder.js` derives a full `--t-*` token set. Everything a
**file** theme can additionally express — named background variants, background
presets, gradient, surface tokens, slide-type curation — used to have nowhere to
live on a DB theme.

The `themes.config` jsonb column (migration `050_theme_config.js`) holds that
richer shape. `buildThemeConfig` merges it over the derived defaults, so a DB
theme reaches parity with a file theme.

> This is the storage and API layer. There is no UI for it yet — the Theme
> Studio (see `docs/plans/theme-forker-extensibility.md`) is what will expose
> these fields. Until then, `POST`/`PUT /api/themes/custom[/:id]` accept a
> `config` object.

## Shape

```jsonc
{
  "version": 1,

  // Dark/light logo variants, alongside the existing large/small pair.
  "logos": { "dark": "…", "darkSmall": "…", "light": "…", "lightSmall": "…" },

  // Named scales rather than raw pixel values, so the wizard can offer choices.
  "surfaces": {
    "radius": "none" | "soft" | "round",   // → --t-radius, -sm, -lg
    "shadow": "none" | "soft" | "strong"   // → --t-shadow-opacity
  },

  "typography": {
    "headingTransform": "none" | "uppercase" | "lowercase" | "capitalize",
    "headingWeight": 100–900,              // rounded to the nearest 100
    "letterSpacing": "0.02em",
    "mono": "…font stack…"
  },

  // Same entry shape and same guards as a file theme's slideBackgrounds.
  // See docs/reference/theme-slide-backgrounds.md.
  "slideBackgrounds": [
    { "id": "calm", "label": "Calm", "value": "#e8f0ee", "textColor": "#0b0b0b" }
  ],

  // See docs/developer/themes.md — the only mechanism for automatic
  // title-slide background images.
  "backgroundPresets": ["/custom/acme-1.jpg"],

  "gradient": { "enabled": false },
  "slideTypes": { "include": [], "exclude": [] },
  "defaultTitleSlide": "title-slide",

  // Coarse per-property override policy. Stored and validated here;
  // enforcement at edit- and render-time is a later slice.
  "locks": {
    "background": "open" | "locked",
    "imageRadius": "open" | "locked",
    "shadow": "open" | "locked",
    "logo": "open" | "locked"
  },

  // Escape hatch: raw token values, applied last so they win.
  "cssVarOverrides": { "--t-color-accent": "#00aa55" }
}
```

## Validation

`shared/theme-config-schema.js` exports `validateThemeConfig(raw)`. It is
**total**: it never throws and never returns null.

- Junk input (a string, an array, `null`) yields `{}`.
- Unknown keys are dropped.
- Out-of-range enums fall back to their default rather than erroring.
- A key the input did not set stays **absent**, so the builder can tell
  "not configured" from "configured to the default value" and leave its own
  defaults in place.

A malformed config therefore can never block saving an otherwise-valid theme,
and a stored config is always safe to merge without further checking.

### `cssVarOverrides` rules

- Keys must match `--t-[a-z0-9-]+`.
- **`--t-ui-*` is rejected.** The application chrome is deliberately
  theme-independent (see the header comment in `client/styles/theme.css`); a
  theme must not be able to restyle the app around the slides.
- Values are stripped of `;{}<>`, so a value cannot terminate its declaration
  and open a new rule — the same guard `shared/theme-slide-backgrounds.js`
  applies to variant values.

## Merge order

`buildThemeConfig` applies, in order:

1. tokens derived from `colors` and `fonts`
2. `surfaces` and `typography`
3. `slideBackgrounds`, `backgroundPresets`, `gradient`, `slideTypes`,
   `defaultTitleSlide`, `locks`
4. `logos` into `assets`
5. `cssVarOverrides` — **last, so a raw override always wins**

An empty config leaves the derived theme byte-identical. Every row predating the
column reads as `{}`, which is what makes the migration safe on a live install;
`tests/theme-builder-config.test.js` pins that against a fixture.

## Notes

- `--t-shadow-opacity` is emitted by `surfaces.shadow` but the stylesheet does
  not consume it yet — `client/styles/slides/00-tokens.css` still hardcodes the
  shadow alphas. Wiring it up is a separate change.
- `locks` is stored and validated but not yet enforced.
