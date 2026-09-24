# Theme config (database themes)

A database theme is a record: a label, two logo URLs, `colors`, `fonts` and
`config`. From the four colour roles and two fonts
`server/utils/theme-builder.js` derives a full `--t-*` token set; the explicit
colour fields and the `themes.config` jsonb column (migration
`050_theme_config.js`) layer everything a **file** theme can additionally
express on top — the brand palette, chart colours, the built-in grounds, named
background variants, background presets, gradient, surface tokens, logos per
surface, slide-type curation.

**The record carries every theme losslessly** (D208, B437). Each of the six
core themes and the four CIIIC-fork themes is written as a record in
`tests/fixtures/theme-records/`, and `tests/theme-record-parity.test.js` pins
that each renders the same `--t-*` tokens as its file form. The only file
fields a record does not carry are the ones D208 retired: `textSwatches`, the
`{en, nl}` background labels, `embedFonts` (fork fonts are managed families,
bound by name), `hiddenSlideTypes` (use `slideTypes.exclude`), `slides.*` and
`sampleEmbedUrl`. The rule for what becomes a field: **when every theme sets
it, it is a field; when one theme sets it, it is a `cssVarOverrides` entry.**

Most of this shape is editable in **Settings → Themes**, alongside the colours
and fonts: surfaces, heading treatment, background images, named background
options, the built-in slot names and the override locks. `slideTypes` is the
exception — slide-type availability is curated org-wide in **Settings → Slide
Types** instead, so a theme-level control would be a second switch for the same
outcome.

`POST`/`PUT /api/themes/custom[/:id]` accept `colors` and `config` directly for
anything the editor does not cover; the editor sends the colour fields it has
no control for back unchanged, so saving there never drops them.

## `colors`

```jsonc
{
  // The four roles. Hex; defaulted when absent.
  "primary": "#385c5c",       // → --t-color-accent
  "background": "#e2fe52",    // → --t-color-background
  "textLight": "#ffffff",     // the light and dark text poles
  "textDark": "#212121",

  // Optional. Absent = derived from the roles, exactly as before they existed;
  // present = wins over the derivation.
  "brand": ["#dbff00", "#375c5d"],  // 1–8 hex → brandColors, --t-color-brand-1..3,
                                    //   and --t-chart-0..3 when `chart` is absent
  "chart": ["#…", … 8 in total],    // exactly 8 hex → --t-chart-0..7
  "accentOnDark": "#dbff00",        // → --t-color-accent-on-dark
  "textMuted": "rgba(11, 11, 11, 0.65)",  // hex or rgb()/rgba() → --t-color-text-muted
  "backgrounds": {                  // hex → --t-slide-bg-<slot>
    "lime": "#e2fe52",              //   default: `background`
    "mist": "#e0e6e2",
    "dark": "#385c5c"
  }
}
```

`--t-color-text` stays derived (the pole that reads on `background`); a theme
whose text colour is neither pole sets it through `cssVarOverrides`. A short
`brand` list feeds the chart slots it has and the derived palette fills the
rest; `chart` is all eight slots or none, so one palette never comes from two
sources.

## Shape

```jsonc
{
  "version": 1,

  // Logo variants keyed by the SURFACE they belong on: `dark` is the mark for
  // a dark ground, `light` the one for a light ground, `*Small` the title-slide
  // sizes of each. See "Contrast-aware logos" below. `payoff` is the closing
  // payoff slide's mark (default: the main logo); `alt` the one alternative
  // text every variant shares (default: the label).
  "logos": {
    "dark": "…", "darkSmall": "…", "light": "…", "lightSmall": "…",
    "payoff": "…", "alt": "Acme"
  },

  // Named scales rather than raw pixel values, so the wizard can offer choices.
  "surfaces": {
    "radius": "none" | "soft" | "round",   // → --t-radius, -sm, -lg
    "shadow": "none" | "soft" | "strong"   // → --t-shadow-scale
  },

  "typography": {
    "textScale": "compact" | "normal" | "large",  // → --t-slide-text-scale
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

  // Names for the two built-in background slots. They are storage keys, not
  // colours — see docs/developer/themes.md.
  "backgroundLabels": { "lime": "White", "mist": "Lilac" },

  "gradient": { "enabled": false },
  "slideTypes": { "include": [], "exclude": [] },
  "defaultTitleSlide": "title-slide",
  "titleLayout": "bottom" | "center" | "top",

  // The ground a new slide starts on under this theme. See below.
  "defaultBackground": "mist",

  // Coarse per-property override policy, enforced at edit- and render-time.
  "locks": {
    "background": "open" | "locked",
    "logo": "open" | "locked"
  },

  // Escape hatch: raw token values, applied last so they win.
  "cssVarOverrides": { "--t-color-accent": "#00aa55" }
}
```

## `defaultBackground` — the ground this theme stands on

A slide type declares its own `background` default (`lime` on fourteen core
types, `mist` on twelve, `dark` on one) because it cannot know which theme will
carry it. A theme whose whole design stands on another ground says so once:

```json
{ "defaultBackground": "mist" }
```

One background id, in the same vocabulary a slide stores in
`content.background`: `lime`, `mist`, or the `id` of one of this theme's own
[`slideBackgrounds`](theme-slide-backgrounds.md) variants. Case and surrounding
space are folded away by `normalizeTheme`; a theme that sets nothing leaves
every type on its own default. A stored theme config only keeps a ground the
same config offers (`validateThemeConfig` drops any other id), which is why
removing a variant in the theme editor also clears a ground that named it: an
id that resolves to nothing is not a state. Available to a file theme (`themes/<id>.json`)
and a database theme alike, and in the theme editor as **This theme's ground**,
beside the background options it chooses from.

**Where it applies.** The value replaces the type's default `background`
wherever that type _offers_ the id — the same union the editor's background
picker builds, which is the type's own `background` options extended with the
theme's variants. So:

- a type that declares no `background` field at all (`quote-slide`) is
  untouched, and gets no `background` key invented for it;
- a type whose options do not include the id keeps its own default — a theme on
  `accent` moves `countdown-slide` (which offers it) and leaves `content-slide`
  (which does not) on `lime`;
- an id no type and no variant offers moves nothing. It is not an error and not
  a refusal: a theme cannot know every type a fork registers.

**It is a default, not an override.** It is applied where a type's defaults are
resolved, so anything that arrives with a background of its own — an imported
deck, a slide-library item, an agent naming one — keeps it, exactly as with any
other content key. And because both surfaces that resolve type defaults go
through the same resolver, a slide gets the theme's ground on every route it
can come into being on: an editor insert, a new deck, the public API, deck
import, the MCP write tools, and a type conversion.

## How `surfaces` reaches the slides

Both surface controls are multipliers/scales over the slide design system in
`client/styles/slides/00-tokens.css`, not raw values — a theme adjusts the
_feel_, the design system keeps the proportions.

| `surfaces.radius` | `--t-radius-sm` / `--t-radius` / `--t-radius-lg` |
| ----------------- | ------------------------------------------------ |
| `none`            | `0px` / `0px` / `0px`                            |
| `soft`            | `12px` / `16px` / `20px`                         |
| `round`           | `20px` / `28px` / `36px`                         |

Consumed by `--slide-radius-sm/-md/-lg`, which every rounded surface reads.

**Leaving `radius` unset is not the same as `soft`.** `buildThemeConfig` always
emits its own radius triple, which currently happens to match `soft`, so an
unconfigured _DB_ theme lands on `12/16/20`. A _file_ theme that sets no
`--t-radius*` at all falls through to the stylesheet's own fallbacks —
`10px` / `18px` / `24px` (`00-tokens.css`) — which are deliberately a slightly
different scale. Setting `soft` explicitly is therefore meaningful on a file
theme and a no-op on a DB one.

(An _invalid_ radius value clamps to `soft`; an _absent_ one stays absent. Same
for shadow.)

| `surfaces.shadow` | `--t-shadow-scale`             |
| ----------------- | ------------------------------ |
| `none`            | `0` — elevation flattened away |
| `soft`            | `1` — same as leaving it unset |
| `strong`          | `1.8`                          |

`--t-shadow-scale` multiplies the **alpha** of all five `--slide-shadow-*`
tokens at once. The geometry (offset, blur) is fixed: a theme changes how
present the elevation feels, not the light source. Unlike radius, unset really
does equal `soft` here: nothing is emitted and the stylesheet reads
`var(--t-shadow-scale, 1)`.

`@media print` still nulls all five shadows regardless — Chromium's print
rasterizer paints blurred shadows as solid grey boxes.

### typography.textScale

| `typography.textScale` | `--t-slide-text-scale`         |
| ---------------------- | ------------------------------ |
| `compact`              | `0.9`                          |
| `normal`               | `1` — same as leaving it unset |
| `large`                | `1.1`                          |

One multiplier on the whole slide type scale — every `--slide-text-*` step and
therefore every semantic role derived from them. It moves **type only**: the
spacing and component scales stay where they are, so a scaled deck keeps its
rhythm instead of becoming a zoom. Like shadow, unset equals `normal`: nothing
is emitted and the stylesheet reads `var(--t-slide-text-scale, 1)`.

The band is deliberately narrow. Slide layouts are drawn against fixed boxes,
so a step that is large enough to be useful is also large enough to overflow
them; a theme that genuinely needs a value outside the band can still set
`--t-slide-text-scale` raw through `cssVarOverrides`, and owns the result.

## Validation

Two gates over one vocabulary, both in `shared/theme-config-schema.js` (D209).

**The write gate refuses an unknown field by name.** `createTheme` and
`updateTheme` (and so a `.deck` theme install, which goes through
`createTheme`) check the whole record: a top-level field other than `label`,
`slug`, `logoUrl`, `logoSmallUrl`, `colors`, `fonts`, `config`; a `fonts` key
other than `heading`, `body` and their `*FamilyId`; a `colors` key outside the
list above or a value it cannot hold (`validateThemeColors`); and a `config`
key outside the shape above, at every level (`checkThemeConfig`) — including a
`slideBackgrounds` entry key, a `cssVarOverrides` name outside the theme layer
and an `{en, nl}` background label. The API answers `400 invalid` with
`details.field` the record-level input (`body`, `colors`, `fonts`, `config`),
`details.reason` `unknown_field` or `invalid_value`, and the dotted path in the
message:

```json
{
  "error": "invalid",
  "message": "Unknown theme field: config.logos.logoAlt",
  "details": { "field": "config", "reason": "unknown_field" }
}
```

A field the record does not know would otherwise vanish on save; silently
dropping it was the old behaviour and is gone. Rows written before went through
that dropping validator, so they hold only known fields and read unchanged.

**The read side normalizes and is total.** `validateThemeConfig(raw)` never
throws and never returns null: it reads a stored config (which passed the gate)
into the shape the builder merges.

- Junk input (a string, an array, `null`) yields `{}`.
- Out-of-range enums fall back to their default rather than erroring.
- A key the input did not set stays **absent**, so the builder can tell
  "not configured" from "configured to the default value" and leave its own
  defaults in place.

### `cssVarOverrides` rules

- Keys must match `--t-[a-z0-9-]+`.
- **`--t-ui-*` is rejected.** The application chrome is deliberately
  theme-independent (see the header comment in `client/styles/theme.css`); a
  theme must not be able to restyle the app around the slides.
- Values are stripped of `;{}<>`, so a value cannot terminate its declaration
  and open a new rule — the same guard `shared/theme-slide-backgrounds.js`
  applies to variant values. A value may be up to 2,000 characters
  (`CSS_VAR_OVERRIDE_MAX`), long enough for a layered gradient; the character
  rule is the real guard, the length only a sanity bound.
- **Only contract tokens do anything.** Slide CSS reads the theme exclusively
  through the role layer, so an override outside the contract set — pinned in
  `tests/fixtures/theme-contract.json` and documented in
  `docs/reference/slide-roles.md` § _The theme seam_ — is accepted but has no
  effect. The per-type `--t-<slide-type>-*` families were removed during beta
  (see the release notes); their former meanings live on the role tokens
  (`--t-color-accent-soft`, `--t-color-surface-raised`,
  `--t-color-accent-on-dark`, `--t-slide-bg-dark-text`, `--t-chart-*`).

## Merge order

`buildThemeConfig` applies, in order:

1. tokens from `colors` and `fonts`: each explicit colour field where the
   record sets it, the derivation from the four roles where it does not
2. `surfaces` and `typography`
3. `slideBackgrounds`, `backgroundPresets`, `gradient`, `slideTypes`,
   `defaultTitleSlide`, `defaultBackground`, `titleLayout`, `locks`
4. `logos` into `assets`, under their asset names (`dark` → `assets.logoOnDark`,
   `light` → `assets.logoOnLight`, the `*Small` pair → `assets.titleLogoOn*`,
   `payoff` → `assets.payoffLogo`, `alt` → `assets.logoAlt`, `titleLogoAlt` and
   `payoffAlt`)
5. `cssVarOverrides` — **last, so a raw override always wins**

An empty config and the four colour roles alone leave the derived theme
byte-identical. Every row predating the column reads as `{}`, which is what
makes the migration safe on a live install; `tests/theme-builder-config.test.js`
pins that against a fixture.

## Checking a theme

The theme editor's live preview covers a handful of slide types against the
draft you are editing — the right scope for a side panel, and not enough to
sign off a theme. To see the whole matrix:

```sh
npm run theme:preview <theme-id>
```

`scripts/theme-preview.js` writes `tmp/theme-preview/<theme-id>/index.html`: one
tile per (slide type × background), grouped by type, plus a WCAG table for the
theme's flat background variants. It resolves a **file** theme in
`custom/themes/<id>/theme.json` as readily as a built-in one — the editor's
draft-preview route does not — and it renders every tile through
`renderSlideToPngBuffer`, the same CSS bundle and `setContent` chain a PDF or
PNG export runs, so a tile is what an export produces rather than a lookalike.

It walks each type against the backgrounds that type declares plus the theme's
own variants (`countdown-slide` declares seven of its own), and skips types the
theme excludes or that belong to another theme. Read it as a sheet, not a gate:
the failures it exists to catch — a logo drifting off-position, text landing on
the bright edge of an artwork background — are visual, and no assertion sees
them.

The WCAG table is scoped to what is honestly measurable. A variant whose
`textColor` sits on a solid or gradient ground has a computable ratio; artwork
grounds and non-hex colours are reported as **not measured** rather than scored,
because a per-pixel worst case needs the rendered PNG sampled under the text
box. That sampler, and turning the sheet into a build gate, are follow-ups.

Output goes to the gitignored `tmp/`. The run needs the same Chrome the export
chain uses, and no server or database.

## Contrast-aware logos

A single wordmark cannot serve both poles: a black mark disappears on a dark
ground and a white one disappears on a light one. A theme may therefore ship a
mark per pole next to the neutral `assets.logo`:

| File theme (`theme.json`) | DB theme (`config.logos`) | Used for                    |
| ------------------------- | ------------------------- | --------------------------- |
| `assets.logoOnDark`       | `logos.dark`              | slides on a dark surface    |
| `assets.logoOnLight`      | `logos.light`             | slides on a light surface   |
| `assets.titleLogoOnDark`  | `logos.darkSmall`         | title slides on a dark one  |
| `assets.titleLogoOnLight` | `logos.lightSmall`        | title slides on a light one |

`assets.logo` stays the fallback, so a theme that ships one mark behaves exactly
as before.

Two places draw a theme mark and both ask `shared/theme-logo.js` for it: the
per-slide corner logo (`slideLogo: 'top-right'`, injected centrally by
`renderSlideHtml` for every slide type) and the title slide's own logo.
**Visibility outranks size** — a title slide takes `titleLogoOnDark`, then
`logoOnDark`, then `titleLogo`, then `logo`, because a mark at the wrong size is
a smaller loss than a mark nobody can see.

The cascade cannot make the choice — an `<img>` `src` is not a CSS property — so
the surface is resolved at render time by `shared/slide-surface-tone.js`, from
the slide content plus the active theme:

1. a **background image** whose text colour is settled (`slideBgText` set to
   `light`/`dark`, or `auto` with a stored `slideBgTextAuto`) states the photo's
   own luminance, and outranks the colour beneath it;
2. otherwise the **background colour**: a theme variant's `textColor` inverted,
   or failing that the colour literal in its `value`; for the built-in `lime` /
   `mist` / `dark` slots, the theme's own `--t-slide-bg-<id>` — read, not
   assumed, because `midnight` paints `lime` near-black.

The resolver is three-valued. When nothing reliable is known (`accent`,
`brand-*` and `custom`, or a theme with no matching var) it returns `''` and
every caller keeps `assets.logo`: a wrong guess flips the mark to the invisible
variant, which is worse than the status quo. Pinned by
`tests/slide-surface-tone.test.js`.

## Override locks

`locks` declares, per brand property, whether a slide may override the theme:

- **`open`** (the default for everything) — the theme supplies a default and a
  per-slide override wins. Today's behaviour.
- **`locked`** — the theme wins. The editor omits the control and explains why,
  _and_ the renderer ignores an override the slide already carries, so a deck
  authored before the lock cannot leak past the branding.

| Lock         | Slide content it governs                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `background` | `background`, `bgCustomColor`, `bgImage`, and the whole `slideBg*` group (image, fit, focus, overlay, text, plus the derived contrast hints) |
| `logo`       | `slideLogo`                                                                                                                                  |

**Enforcement is non-destructive.** `applyLocksToContent` returns a filtered
_view_ of the content; stored slide data is never rewritten. Unlocking a
property restores every slide's own value.

**A missing theme locks nothing.** A render path that forgets to pass
`ctx.theme`, or a lock mode that isn't exactly `"locked"`, degrades to `open` —
failing open, so a typo in a theme cannot silently strip every slide.

Only properties with a real per-slide control are lockable. `imageRadius` and
`shadow` were in the vocabulary before enforcement existed, but no slide type
offers a per-slide radius or shadow, so a switch for them would have done
nothing; they are rejected by `validateThemeConfig`. Add them back together with
the control they would guard.
