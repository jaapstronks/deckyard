# Themes

A theme controls a presentation's palette, type, logos, backgrounds and slide-type choices. Presentations refer to a theme record by UUID or use `default`, which follows the organization's chosen default. Theme records, rather than JSON files on disk, are resolved when a deck is rendered or exported.

## Choose or create a theme

Open **Settings → Themes** and duplicate a read-only seed to make an editable theme for your organization. Set the organization's default there when new decks should use it. The six built-in seeds are Forest (`brand`), Amethyst, Boardroom (`corporate`), Editorial, Midnight and Sunset (`playful`). Forest supplies the installation default unless `DEFAULT_THEME` selects another seed. A copied theme is an organization record with its own UUID; its source seed's slug is not a deck reference.

The editor handles colours, fonts, logos, backgrounds, typography and surface choices. `slideTypes` is curated in **Settings → Slide Types**. The themes API accepts record `colors` and `config` for settings that the editor does not expose; see [theme config](../reference/theme-config.md). Keep a theme's images at served `/assets/` or `/custom/assets/` URLs, or upload them through the app. A filesystem path under `custom/themes/` is not a served asset URL. Existing decks may store image URLs in slide content, so keep those URLs available when moving files.

The `default` reference is resolved within the deck's organization. An explicit theme reference is a record UUID. To move older slug references, use the [checked migration](../reference/theme-config.md) with a slug-to-UUID mapping; do not rename directories and expect deck references to change.

## Seeds for an installation

The six core files in `themes/*.json` and optional fork files in `custom/themes/*.json` are **seed inputs at startup**. They create or refresh shared, read-only records. They are not editable organization themes, and there is no folder layout, flat-file fallback or custom-over-core override order. Duplicate a seed in Settings when an organization needs to edit it. A fork may ship additional shared seeds with unique slugs.

A seed file is named for its `slug`, for example `custom/themes/acme.json`:

```json
{
  "slug": "acme",
  "label": "Acme",
  "logoUrl": "/custom/assets/images/acme-logo.svg",
  "logoSmallUrl": null,
  "colors": {
    "primary": "#0066cc",
    "background": "#f0f4f8",
    "textLight": "#ffffff",
    "textDark": "#212121"
  },
  "fonts": {
    "heading": "Inter",
    "body": "Inter"
  },
  "config": {
    "logos": { "alt": "Acme" },
    "backgroundPresets": ["/custom/assets/images/acme-cover.jpg"],
    "slideTypes": { "include": ["acme-hero-slide"], "exclude": [] },
    "defaultTitleSlide": "acme-hero-slide"
  }
}
```

The required record shape is `slug`, `label`, `colors`, `fonts` and `config`; logo URLs may be null. `slug` must match the filename and cannot collide with another seed. Seed validation rejects unknown top-level fields, invalid colours, uncurated fonts and unserved logo paths before any seed row is changed. Use a curated family for each of the two font roles. See [fork setup](../reference/fork-setup.md) for adding a curated family and [theme config](../reference/theme-config.md) for the full `colors` and `config` vocabulary. The committed [seed fixtures](../../themes/) provide complete examples.

## Design choices in a theme record

The four base colours in `colors` feed the slide's role tokens. Optional brand and chart palettes, text contrast colours and named background colours refine them. `config.cssVarOverrides` applies contract `--t-*` tokens last, when a particular look cannot be expressed with a record field. Slide CSS consumes [theme roles](../reference/slide-roles.md); old per-slide-type token families have no effect. Put arbitrary fork CSS rules in `custom/styles/*.css`, not in a theme record. Those styles load in the app and exports; they require an installation name in `custom/extension.json` as described in [fork setup](../reference/fork-setup.md).

`config.backgroundPresets` lists served image URLs for the background picker and for automatic title-slide backgrounds. With no presets, no image is chosen automatically. The built-in background slots are stored as `lime` and `mist`; their colours come from `colors.backgrounds`, and their picker names can be set with `config.backgroundLabels`. Add further choices through `config.slideBackgrounds`. `config.defaultBackground` sets a new slide's ground only if that slide type offers the chosen background; a stored slide background remains intact. These settings are detailed in [theme config](../reference/theme-config.md) and [slide backgrounds](../reference/theme-slide-backgrounds.md).

`config.logos` contains the alt text and optional variants for dark and light surfaces, title slides and payoff slides. The main image URLs are `logoUrl` and `logoSmallUrl` on the record. `config.surfaces` controls radius and shadow scales; `config.typography` controls the heading treatment and text scale. `config.locks.background` and `config.locks.logo` can be `locked` to stop per-slide overrides at both edit and render time. Stored slide values remain in place so unlocking restores them. [Theme config](../reference/theme-config.md) specifies the values and fallback behaviour for each field.

Check large text-scale choices against every layout you use: the scale changes type but leaves spacing and component sizes in place. The table slide's `plain`, `panel` and `soft` styles take their colours and surfaces from the shared palette, so a theme does not need table-specific tokens. A font split across several subset files needs the matching `unicodeRange` on each face; otherwise one subset can shadow another. Managed organization fonts and curated seed fonts are bound by family name, while a fork's extra self-hosted faces belong in `custom/styles/fonts.css`. See [font management](../reference/font-management.md) for the font routes.

## Slide types and themes

A normal slide type is available under any theme unless the organization disables it or the active theme excludes it. A custom type that requires an explicit theme opt-in declares `themeOnly: true` in its definition:

```js
// custom/slide-types/acme-hero-slide.js
export default {
  themeOnly: true,
  label: 'Acme Hero',
  // fields, defaults, renderHtml and optional AI metadata
};
```

Add its type name to the active record's `config.slideTypes.include`; set `config.defaultTitleSlide` to that name if it should replace the normal title slide. `config.slideTypes.exclude` hides a type from insertion. Neither setting deletes existing slides: they still render and can be edited. `themeOnly` does not name a seed slug or record UUID, so copying a theme keeps its type selection. The same availability policy governs the editor and AI suggestions. See [custom slide types](slide-types.md) for the complete definition and AI metadata.

A `.deck` export includes a snapshot of the effective theme record and available images. Its `deck.extensions` list carries the names of installation extensions involved in its history. The names warn a receiving installation about possibly missing custom code or CSS; they do not install it. [Deck format](../reference/deck-format.md) describes this boundary.
