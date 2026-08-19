## Themes

Themes control the visual identity of presentations. They are loaded at runtime (no build step).

**Theme locations:**

- `themes/*.json` - Core themes (shipped with the system, always flat files)
- `custom/themes/<id>/theme.json` - Custom themes, **folder layout** (recommended):
  a self-contained folder that co-locates the theme's own assets under
  `custom/themes/<id>/assets/`.
- `custom/themes/<id>.json` - Custom themes, **legacy flat layout** (still
  supported for backward compatibility).

Custom themes take precedence over core themes with the same ID. The loader
resolves a custom theme by trying the folder layout first, then the flat file.

> **Which assets go where?** A theme folder holds the theme's own _chrome_ —
> logo, fonts, and (for a fresh install) background presets. Assets that get
> baked into saved slide content — uploaded images, deck-specific photos,
> partner logos referenced by slides — belong in the shared `custom/assets/`
> tree, because moving them would break decks that already point at the old
> URL. See "Migrating a flat theme to a folder" below.

---

## The built-in set

Six themes ship in `themes/`. Only one of them is Deckyard's own; the other
five are neutral archetypes named after their palette, meant to be picked,
forked or ignored.

| id          | label     | palette                                                | note                                                                                 |
| ----------- | --------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `brand`     | Forest    | forest green `#254d38` + brass `#b8860f` on warm paper | **the default** — Deckyard's own colours, the ones the logo mark and deckyard.eu use |
| `amethyst`  | Amethyst  | violet `#7c3aed`                                       | was `deckyard`/"Deckyard" until it was renamed to a palette name like its neighbours |
| `corporate` | Boardroom | blue `#2563eb`                                         |                                                                                      |
| `editorial` | Editorial | carmine `#9f1239`                                      |                                                                                      |
| `midnight`  | Midnight  | cyan `#38bdf8` on near-black                           | the dark archetype                                                                   |
| `playful`   | Sunset    | orange `#ea580c`                                       |                                                                                      |

Two things follow from `brand` being the default rather than one of the archetypes:

- **A theme is the _user's_ house style, not the product's.** That claim is on
  the marketing site, so the product's own colours have to live in one theme
  among six, not in the fallback everyone inherits by accident.
- **Marketing and docs screenshots are shot on `brand`**, so a screenshot and
  the page around it are the same colour. `capture/` recipes therefore pin the
  theme explicitly rather than relying on the default.

Adding or renaming a built-in touches **two** places: the JSON file in
`themes/`, and the `THEMES` array in `shared/slide-types/registry.js`. That
array is the validation enum — a theme file on disk that is missing from it is
rejected when a deck tries to save with it.

---

## Quick Start: Adding a Custom Theme (folder layout)

1. Create the folder and `theme.json`:

```
custom/themes/your-org/
  theme.json
  assets/
    images/logo.svg
    fonts/YourFont-Regular.woff2
```

```json
{
  "id": "your-org",
  "label": "Your Organization",
  "assets": {
    "logo": "/custom/themes/your-org/assets/images/logo.svg",
    "logoAlt": "Your Organization"
  },
  "cssVars": {
    "--t-color-accent": "#0066cc",
    "--t-slide-bg-lime": "#your-brand-color",
    "--t-logo-url": "url('/custom/themes/your-org/assets/images/logo.svg')"
  },
  "embedFonts": [
    {
      "family": "YourFont",
      "path": "custom/themes/your-org/assets/fonts/YourFont-Regular.woff2",
      "weight": 400,
      "style": "normal"
    }
  ]
}
```

Asset URLs inside the JSON are absolute site-root paths under the theme
folder: `/custom/themes/your-org/assets/...`. `embedFonts[].path` is
repo-root-relative (no leading slash): `custom/themes/your-org/assets/...`.

2. Set as default in `.env`:

```
DEFAULT_THEME=your-org
```

3. Restart the server

### Migrating a flat theme to a folder

To convert an existing `custom/themes/your-org.json`:

1. `mkdir -p custom/themes/your-org/assets/{images,fonts}`
2. `git mv custom/themes/your-org.json custom/themes/your-org/theme.json`
3. Move the theme's **chrome** assets (logo, fonts) into
   `custom/themes/your-org/assets/…` and rewrite those paths in `theme.json`
   (`assets.logo`, `assets.payoffLogo`, `--t-logo-url`, `embedFonts[].path`).
   These are resolved at render time and are never stored in slide content, so
   moving them is safe.
4. **Leave `backgroundPresets` and any deck-content images in
   `custom/assets/`** if existing decks already use them (their URLs are baked
   into saved slides). For a brand-new theme with no decks yet, you may put
   presets in the folder too.
5. Restart; the loader picks up the folder automatically.

---

## Theme Reference

Core themes live in `themes/*.json`.

They control:

- slide look & feel via CSS variables (`cssVars`)
- theme assets (logos)
- which slide types are available to insert in the editor (universal vs theme-specific)

### Theme JSON: required fields

A valid theme file must include at least:

- **`id`**: string (must match the filename, e.g. `themes/amethyst.json` → `"id": "amethyst"`)
- **`label`**: human name for UI
- **`assets`**:
  - **`logo`**: URL path to a logo
  - **`logoAlt`**: accessible alt text
- **`cssVars`**: object of CSS variables (keys must start with `--t-`)

Everything else is optional.

### Theme JSON: optional fields

- **`sampleEmbedUrl`**: URL to use as the sample embed in the slide type picker thumbnail. If not provided, the embed slide thumbnail will show a placeholder. This should be a publicly accessible embed URL (e.g., a Miro board, Figma embed, or other iframe-compatible URL).

### Slide types: universal vs theme-specific (plumbing)

This codebase supports:

- **Universal slide types**: normal slide types (no `themeId` in their slide type definition). These are available to all themes by default.
- **Theme-specific slide types**: slide types whose definition includes `themeId: '<theme-id>'`. These are **not** available by default; the theme must opt into them via `slideTypes.include`.

Important:

- Excluding a slide type only affects **inserting new slides** in the editor. Existing slides of that type still render and can be edited.

### Theme config: `slideTypes`

Themes can control which slide types can be inserted:

```json
{
  "slideTypes": {
    "exclude": ["title-slide"],
    "include": ["amethyst-title-slide"]
  }
}
```

- **`slideTypes.exclude`**: hide these slide types from the editor “add slide” UI (and prevent inserting them from the slide library).
- **`slideTypes.include`**: enable theme-specific slide types (ones that declare `themeId` matching this theme’s `id`).

#### Removed spelling: `hiddenSlideTypes`

`slideTypes.exclude` is the only spelling. Older theme files may still carry:

```json
{ "hiddenSlideTypes": ["lead-capture-slide"] }
```

`normalizeTheme()` folds that into `slideTypes.exclude` on read **and drops the
key**, so a normalized theme never carries both. Nothing downstream reads
`hiddenSlideTypes`.

The fold is a migration ramp, not a supported second spelling: it exists so an
old theme file keeps working, and it will be removed once no theme in the wild
uses it. Deckyard is in beta — don't write new themes against it. Move the list
into `slideTypes.exclude` and delete the old key.

### Creating a theme (checklist)

1. **Add the theme JSON**
   - Create `themes/<id>.json`
   - Ensure `id` matches the filename
2. **Add required fields**
   - `label`, `assets.logo`, `assets.logoAlt`, `cssVars`
3. **(Optional) Configure slide type availability**
   - Use `slideTypes.exclude` to remove universal slide types that don’t fit the theme
   - Use `slideTypes.include` to enable theme-specific slide types (when you add them)

### Creating a theme-specific slide type

For custom slide types, use the `custom/slide-types/` directory instead of modifying core files. See `docs/developer/slide-types.md` for details.

---

## Custom Fonts

Themes can embed custom fonts for use in slides and exports:

```json
{
  "embedFonts": [
    {
      "family": "Your Brand Font",
      "path": "custom/assets/fonts/YourFont-Regular.woff2",
      "weight": 400,
      "style": "normal"
    },
    {
      "family": "Your Brand Font",
      "path": "custom/assets/fonts/YourFont-Bold.woff2",
      "weight": 700,
      "style": "normal"
    }
  ]
}
```

The fonts will be:

- Loaded in the browser for live editing/presenting
- Embedded in PDF/HTML exports for offline viewing

### Entry shape

| Field          | Required | Meaning                                                                                              |
| -------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `family`       | yes      | The `font-family` name the rule declares. Must match what `--t-font-heading` / `--t-font-body` name. |
| `path`         | one of   | Repo-root-relative path to a `woff2` (no leading slash).                                             |
| `url`          | one of   | An `/uploads/…` path or an absolute URL, for managed/uploaded fonts.                                 |
| `weight`       | no       | `font-weight` for the rule. Defaults to `400`.                                                       |
| `style`        | no       | `font-style`. Defaults to `normal`.                                                                  |
| `format`       | no       | `src` format hint for URL-based fonts. Defaults to `woff2`.                                          |
| `unicodeRange` | no       | `unicode-range` for the rule — **required when one family is split across several files.**           |

**`unicodeRange` is not optional in practice for the curated fonts.** Google
splits every family into disjoint per-script subsets: the `latin` file holds
ASCII and Latin-1, the `latin-ext` file the Polish/Czech/Turkish/Hungarian
letters, and neither contains the other's glyphs. Two entries for one
family+weight without ranges means the second simply overrides the first and
half the alphabet falls back to a system face. A font that ships as a single
file covering everything (a typical uploaded brand face) needs no range.

**`weight` may be a range.** A variable font is one file that covers a span of
weights, so its entry declares that span the way CSS does — two numbers
separated by a space:

```json
{
  "family": "Inter",
  "path": "assets/fonts/google/inter/inter-400-latin.woff2",
  "weight": "400 700",
  "style": "normal",
  "unicodeRange": "U+0000-00FF, U+0131, …"
}
```

This is how the curated families are written, and it is what keeps exports
honest about size: an export base64-inlines every `@font-face` rule, so four
weight-entries pointing at the same variable file inlined the same blob four
times. Entries that _do_ resolve to the same file are merged automatically
(`mergeFontFaces` in `shared/theme-fonts.js`), so a hand-written theme that
lists one entry per weight still exports one copy — but writing the range is
clearer. A truly static family (one file per weight, e.g. Poppins) keeps one
entry per weight, because those files really are different bytes.

For the built-in and database themes you never write this by hand:
`curatedEmbedFonts()` (`server/utils/curated-font-embed.js`) generates the list
from the curated set and the font lockfile, and `tests/theme-embed-fonts.test.js`
fails if a committed `themes/*.json` drifts from it.

---

## Background Presets

Themes can provide background image presets for title slides:

```json
{
  "backgroundPresets": [
    "/custom/assets/images/backgrounds/bg1.jpg",
    "/custom/assets/images/backgrounds/bg2.jpg",
    "/custom/assets/images/backgrounds/bg3.jpg"
  ]
}
```

These appear in the background picker (grouped as **"From this theme"**) for
slide types that support background images, and are the pool a title slide draws
from when one is assigned automatically — on deck import, and when converting a
chapter-title slide to a title slide.

`backgroundPresets` is the **only** mechanism for this. A theme that declares
none gets no automatic background image: title slides stay flat rather than
picking up imagery that isn't yours. Deckyard used to ship a hardcoded list of
four demo photos that any deck could land on regardless of its theme; that list
is gone.

The URLs may point anywhere the server serves — `custom/themes/<id>/assets/`,
`custom/assets/`, `/uploads/`, or a CDN.

---

## Naming the built-in backgrounds

Every theme has two built-in background slots, stored as `lime` and `mist`.
Those are **storage keys, not colours**: `amethyst` paints lime white and
`midnight` paints it near-black. With nothing else to go on the picker
labels them "Color 1" and "Color 2", which is accurate and useless — only the
theme knows what its own slots are.

```json
{
  "backgroundLabels": {
    "lime": "White",
    "mist": { "en": "Lilac", "nl": "Lila" }
  }
}
```

Either a plain string or an `{ en, nl }` object per slot. Renaming the slots is
what this is for; adding _new_ options is `slideBackgrounds`
(`shared/theme-slide-backgrounds.js`; a theme declares extra `slideBackgrounds`
entries and the generated CSS ships the matching `.slide-bg-<id>` rules).

> Database themes set the same thing through `config.backgroundLabels`, one
> label per slot — the theme editor has no per-locale field.

---

## Surfaces: rounding and elevation

A file theme sets these tokens directly in `cssVars`:

```json
{
  "cssVars": {
    "--t-radius-sm": "20px",
    "--t-radius": "28px",
    "--t-radius-lg": "36px",
    "--t-shadow-scale": "1.8"
  }
}
```

`--t-shadow-scale` multiplies the alpha of all five `--slide-shadow-*` tokens at
once: `0` flattens elevation away, `1` is the default, higher deepens it. The
geometry (offset, blur) is fixed, so a theme changes how _present_ elevation
feels rather than moving the light source. Leaving it unset means `1`.

Radius is consumed by `--slide-radius-sm/-md/-lg`, which every rounded surface
reads. Unset falls back to the design system's own `10px` / `18px` / `24px`.

> Database themes express the same two through named scales
> (`config.surfaces.radius` / `.shadow`) rather than raw values, because a
> wizard offers choices rather than pixels. Both end up at the same tokens —
> see `docs/reference/theme-config.md`.

---

## Override locks

A theme can declare that a brand property is **not** overridable per slide:

```json
{
  "locks": {
    "background": "locked",
    "logo": "open"
  }
}
```

- **`open`** (the default for everything) — the theme supplies a default and a
  per-slide override wins.
- **`locked`** — the theme wins. The editor omits the control and explains why,
  _and_ the renderer ignores an override a slide already carries, so a deck
  authored before the lock cannot leak past the branding.

`background` governs the slide background as a whole — the colour/variant, the
custom colour, the per-slide background image and everything positioning it.
`logo` governs the corner logo (`slideLogo`).

Enforcement is **non-destructive**: stored slide content is never rewritten, so
unlocking gives every slide its own value back. A property you do not mention
stays `open`, and a value that is not exactly `"locked"` reads as `open` — a
typo cannot silently strip every slide in a deck.

---

## Table style variants

The structured **Table** slide type has a per-slide **Table style** picker with
three variants: `plain` (transparent, gridlines only — the default), `panel`
(filled panel with an emphasized header row + first/label column), and `soft`
(near-white panel with a coloured header and a faint accent label column).

Both `panel` and `soft` resolve their colours from the theme's standard palette
(`--t-color-accent`, its auto-derived `--t-color-accent-contrast`, the mist and
raised surfaces, `--t-radius`), so tables look designed on any theme with
**zero per-theme work**. There are no table-specific theme tokens: the header
and label-column planes follow the accent pair, and the panel/soft surfaces
follow the shared surface roles (`docs/reference/slide-roles.md` § Colour
roles). A theme that wants different table colours changes those palette
tokens — the former `--t-table-<variant>-*` family was removed in the A7.9
role-vocabulary consolidation and has no effect.

---

## Complete Theme Example

```json
{
  "id": "acme-corp",
  "label": "Acme Corporation",

  "assets": {
    "logo": "/custom/themes/acme-corp/assets/images/acme-logo.svg",
    "logoAlt": "Acme Corp",
    "payoffLogo": "/custom/themes/acme-corp/assets/images/acme-payoff.svg",
    "payoffAlt": "Acme Corp"
  },

  "defaultTitleSlide": "title-slide",

  "cssVars": {
    "--t-color-accent": "#0066cc",
    "--t-slide-bg-lime": "#00cc66",
    "--t-slide-bg-mist": "#f0f4f8",
    "--t-slide-bg-dark": "#1a1a2e",
    "--t-text-color-light": "#ffffff",
    "--t-text-color-dark": "#212121"
  },

  "embedFonts": [
    {
      "family": "Acme Sans",
      "path": "custom/themes/acme-corp/assets/fonts/AcmeSans-Medium.woff2",
      "weight": 500,
      "style": "normal"
    }
  ],

  "backgroundPresets": [
    "/custom/themes/acme-corp/assets/images/backgrounds/acme-bg-1.jpg",
    "/custom/themes/acme-corp/assets/images/backgrounds/acme-bg-2.jpg"
  ],

  "slideTypes": {
    "exclude": [],
    "include": []
  },

  "locks": {
    "background": "open",
    "logo": "open"
  }
}
```

---

## Directory Structure

For a complete custom setup:

```
custom/themes/
└── acme-corp/
    ├── theme.json
    └── assets/
        ├── fonts/
        │   └── AcmeSans-Medium.woff2
        └── images/
            ├── acme-logo.svg
            ├── acme-payoff.svg
            └── backgrounds/
                ├── acme-bg-1.jpg
                └── acme-bg-2.jpg
```

The theme's own chrome lives in its folder. Assets that get baked into saved
slide content (uploaded images, deck-specific photos) stay in the shared
`custom/assets/` tree - see the note under "Theme locations" above.

---

## AI Wizard and Themes

The AI wizard is theme-aware. When analyzing presentations:

1. **Theme-Specific Slides**: The AI only suggests theme-specific slide types for presentations using that theme
2. **Slide Availability**: The AI respects `slideTypes.include` and `slideTypes.exclude` settings
3. **Custom Slide Types**: Custom slides with AI metadata are automatically available to the AI wizard

To create a custom slide type that the AI wizard can use, add an `ai` property to your slide type definition. See `docs/developer/slide-types.md` for details on AI integration.

### Example: Replacing the Default Title Slide

If you want the AI to use your custom title slide instead of the default:

1. Create your custom slide with AI metadata:

   ```javascript
   // custom/slide-types/my-title-slide.js
   export default {
     themeId: 'my-theme',
     label: 'My Title',
     ai: {
       category: 'structural',
       resolveInPhase1: true,
       description: 'Opening slide for my theme...',
       bestFor: ['Opening slides', 'First impression'],
       // ...
     },
     // ...
   };
   ```

2. Configure your theme to use it:
   ```json
   {
     "id": "my-theme",
     "slideTypes": {
       "exclude": ["title-slide"],
       "include": ["my-title-slide"]
     },
     "defaultTitleSlide": "my-title-slide"
   }
   ```

---

## See Also

- `docs/developer/slide-types.md` - Custom slide types and AI integration
- `docs/developer/architecture.md` - System architecture overview
