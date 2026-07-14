# Font Management System

Custom font management for designers: upload font files, connect Adobe Fonts (Typekit), fonts.com (Monotype), and Google Fonts — then assign them to themes.

## How It Works

### Data Model

Two PostgreSQL tables (migration `037_font_management.js`), both org-scoped:

**`font_families`** — one row per custom font family.
- `source`: `upload` | `adobe` | `monotype` | `google`
- `category`: `sans-serif` | `serif` | `display` | `monospace`
- `source_config` (JSONB): source-specific data (Typekit project ID, Monotype project ID, Google spec string)
- `slug`: unique per org, used for CSS class names
- `css_fallback`: optional CSS fallback stack override

**`font_variants`** — individual weight/style files for a family.
- `weight`: 100–900 in 100 increments
- `style`: `normal` | `italic`
- `filename`: media provider storage key (not original filename)
- `url`: resolved URL from media provider
- `format`: `woff2` | `woff`
- Unique constraint on `(font_family_id, weight, style)`

Families cascade-delete their variants. Variants for uploaded fonts have stored files cleaned up from the media provider on deletion.

### Font Sources

| Source | How fonts load | What's stored | Export strategy |
|--------|---------------|---------------|-----------------|
| **Upload** | `@font-face` rules with variant URLs | woff2/woff files via media provider | Base64-embedded in HTML exports |
| **Adobe** | `<link>` to Typekit CSS (`use.typekit.net`) | Project ID in `sourceConfig` | External `<link>` tag in exports |
| **Monotype** | `<script>` from `fast.fonts.net` | Project ID + version in `sourceConfig` | External `<script>` tag in exports |
| **Google** | `<link>` to Google Fonts CSS2 API | Spec string (e.g. `"Raleway:400,700"`) in `sourceConfig` | External `<link>` tag in exports |

### Theme Integration

Themes store font references in a `fonts` JSONB column:

```json
{
  "heading": "My Custom Font",
  "headingFamilyId": "uuid-of-font-family",
  "body": "Another Font",
  "bodyFamilyId": "uuid-of-font-family"
}
```

When `headingFamilyId` or `bodyFamilyId` is present, the system treats it as a managed font and resolves it from the database instead of the curated list. When absent, the standard curated font validation applies (backward-compatible).

**Resolution chain:**
1. Theme is loaded from DB (`server/utils/themes.js` → `loadCustomTheme()`)
2. If theme has a familyId, `listAllFontFamiliesWithVariants()` fetches managed fonts for the org
3. `buildThemeConfig()` receives managed fonts and produces:
   - `embedFonts` array (for uploaded fonts — URL-based variants to base64 in exports)
   - `externalFontLinks` array (for Adobe/Monotype/Google — `<link>` and `<script>` tags)
   - CSS custom properties (`--t-font-heading`, `--t-font-body`) with proper fallback stacks
4. Result is cached in `customThemeCache` (invalidated on theme or font changes)

### Curated vs. Managed Fonts

**Curated fonts** (`shared/theme-fonts.js`): 37 pre-selected Google Fonts with known weights. Downloaded to `/assets/fonts/google/` for local serving. Available to all orgs without configuration.

**Managed fonts**: org-scoped custom fonts created through the font editor. Stored in the database with source-specific resolution.

The font picker dropdown shows both: curated fonts grouped by category, and managed fonts in a separate "Custom Fonts" optgroup.

### Body Font Filtering

Body fonts need regular (400) and bold (700) weights to work properly in slide content. The font picker enforces this:
- Uploaded managed fonts only appear in the body picker if they have both weight 400 and 700 variants
- Non-upload sources (Adobe, Monotype, Google) bypass this check since their variant availability is managed externally
- Heading fonts have no weight restriction (single weight is fine for headings)

## Architecture

### API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/font-families` | Any user | List all families with variants |
| POST | `/api/font-families` | Designer | Create a family |
| GET | `/api/font-families/:id` | Any user | Get family with variants |
| PUT | `/api/font-families/:id` | Designer | Update family metadata |
| DELETE | `/api/font-families/:id` | Designer | Delete family + variants + media files |
| POST | `/api/font-families/:id/upload-variant` | Designer | Upload a woff2/woff file |
| DELETE | `/api/font-families/:id/variants/:vid` | Designer | Remove a single variant |
| POST | `/api/font-families/discover-adobe` | Designer | Discover fonts from a Typekit project |
| POST | `/api/font-families/import-adobe-family` | Designer | Import a discovered Adobe family |

Upload endpoint validates magic bytes (woff2: `wOF2`, woff: `wOFF`) and enforces a 5MB size limit.

### Key Server Files

| File | Purpose |
|------|---------|
| `server/db/migrations/037_font_management.js` | Database schema |
| `server/storage/font-families.js` | CRUD operations (org-scoped, with `withDbGuard`) |
| `server/routes/api/font-families.js` | HTTP route handlers |
| `server/utils/theme-builder.js` | `buildThemeConfig()`, `generatePreviewCSS()`, `generateFontFaceCSS()`, `buildExternalFontLinks()` |
| `server/utils/themes.js` | Theme loading with managed font resolution, `clearCustomThemeCache()` |
| `server/storage/themes.js` | Theme CRUD with `validateFonts()` and `verifyFontFamilyIds()` |
| `server/utils/embed-fonts.js` | Base64-embeds font files for offline HTML exports |
| `server/export/html.js` | Standalone HTML export (injects external font tags) |
| `server/utils/embed-html/index.js` | Embed HTML builder (injects external font tags) |
| `server/utils/embed-html/template.js` | Embed HTML template (renders external font HTML in `<head>`) |
| `shared/theme-fonts.js` | Curated fonts list (single source of truth for client + server) |

### Key Client Files

| File | Purpose |
|------|---------|
| `client/views/settings/tabs/fonts-tab.js` | Font families list page in settings |
| `client/views/settings/font-editor/index.js` | Font family editor (source selection, common fields) |
| `client/views/settings/font-editor/upload-panel.js` | Upload source: weight/style grid, file upload |
| `client/views/settings/font-editor/adobe-panel.js` | Adobe source: project discovery + import |
| `client/views/settings/font-editor/monotype-panel.js` | Monotype source: project ID config |
| `client/views/settings/font-editor/google-panel.js` | Google source: spec string + preview |
| `client/views/settings/theme-editor/font-picker.js` | Font dropdown (curated + managed, live preview) |
| `client/views/settings/theme-editor/index.js` | Theme editor (fetches managed fonts, passes to pickers) |
| `client/styles/base/04-editor-and-misc/104-font-manager.css` | All font management UI styles |

### Export Pipeline

**Standalone HTML** (`server/export/html.js`):
- Uploaded fonts: fetched from URLs, base64-encoded into `@font-face` rules (via `embed-fonts.js`)
- External fonts: `<link>` and `<script>` tags injected into `<head>` with URL safety checks

**Embed HTML** (`server/utils/embed-html/`):
- External fonts: same `<link>`/`<script>` injection as standalone
- Uploaded fonts: served from URLs (embeds load from the server, not offline)

**PDF/PNG** (Puppeteer):
- Works via network access — Puppeteer loads URLs and external CSS/JS normally

### Cache Invalidation

`customThemeCache` in `server/utils/themes.js` caches resolved theme configs:
- **Theme update/delete**: `clearCustomThemeCache(themeId)` clears the specific theme
- **Font family update/delete**: `clearCustomThemeCache()` clears all (font changes can affect any theme)

### Font Deletion Safety

When a font family is deleted:
1. All themes in the org that reference the familyId have their `headingFamilyId`/`bodyFamilyId` cleared (falls back to curated font behavior)
2. Variant files are cleaned up from the media provider
3. Custom theme cache is fully cleared

When creating/updating a theme:
- `verifyFontFamilyIds()` checks that any referenced familyId exists in the org's `font_families` table
- Returns `invalid_fonts` error if the familyId doesn't exist

## Testing Checklist

### Migration
- [ ] Run `npm run migrate` — verify `font_families` and `font_variants` tables are created
- [ ] Run migration down/up cycle to verify rollback works

### Upload Flow
- [ ] Create a font family (source: upload), upload a woff2 variant
- [ ] Verify magic byte validation rejects non-font files
- [ ] Verify 5MB size limit is enforced
- [ ] Upload multiple weight/style variants for one family
- [ ] Verify the font preview text renders on the fonts list page
- [ ] Delete a variant — verify stored file is cleaned up from media provider
- [ ] Delete a family — verify all variants and stored files are cleaned up

### Adobe Fonts
- [ ] Enter a valid Typekit project ID, discover fonts
- [ ] Import a discovered family — verify `font_families` + `font_variants` rows created
- [ ] Assign to a theme — verify `<link>` tag with Typekit CSS URL appears in rendered output
- [ ] Export as HTML — verify the Typekit link tag is in the exported file

### Monotype / Google
- [ ] Create a Monotype font family with project ID — verify `<script>` tag in output
- [ ] Create a Google font family with spec `"Open Sans:400,700"` — verify valid CSS2 API URL
- [ ] Verify the generated URL properly encodes the family name without breaking the weights format

### Theme Integration
- [ ] Open theme editor — verify all 37 curated fonts appear in both heading and body dropdowns
- [ ] Create a theme and select a managed font for heading and body
- [ ] Body picker should only show uploaded fonts with weights 400 + 700
- [ ] Heading picker should show all managed fonts regardless of variants
- [ ] Save theme — verify `headingFamilyId` and `bodyFamilyId` are persisted
- [ ] Load a presentation with the theme — verify fonts render correctly
- [ ] Curated (non-managed) fonts still work as before

### Export
- [ ] Export with uploaded fonts as HTML — verify `@font-face` rules with base64 data
- [ ] Export with Adobe/Google/Monotype fonts — verify external `<link>`/`<script>` tags
- [ ] View embed HTML output for a theme with external fonts — verify tags are present
- [ ] Export as PDF — verify fonts render (Puppeteer has network access)
- [ ] Export as PNG slides — verify fonts render

### Permissions
- [ ] Non-designer users cannot create/edit/delete font families (403)
- [ ] Non-designer users can still list and view (for font picker in themes)

### Cache & Deletion
- [ ] Update a theme → re-render a presentation → verify updated config is used (not stale)
- [ ] Update a font family's variants → presentations using themes with that font reflect changes
- [ ] Delete a font family that's referenced by a theme → theme falls back gracefully
- [ ] Try to save a theme with a non-existent familyId → verify `invalid_fonts` error

### Edge Cases
- [ ] Duplicate slug prevention for font families within same org
- [ ] Duplicate weight+style prevention for variants within same family
- [ ] Google spec with no weights (just family name) — should default to `400;600;700`
- [ ] Font picker with zero managed fonts — only curated fonts shown, no empty optgroup

## Known Limitations

### No Google Fonts validation
Google Fonts are added by entering a spec string with no validation that the font exists. Invalid specs silently don't load. Could add a fetch-and-verify step, but it's not blocking since the failure mode is just a missing font (falls back to CSS generic family).

### No font usage overview
There's no UI to see which themes use a given font family. The deletion flow now clears references automatically, but users have no way to preview the impact before deleting.

### External fonts require network
Adobe, Monotype, and Google fonts need network access to load. Standalone HTML exports include the external `<link>`/`<script>` tags but won't work fully offline. Only uploaded fonts are base64-embedded for true offline use.

### No font subsetting
Uploaded fonts are embedded in full. For exports with large font files, this increases the HTML file size. Subsetting to commonly used character ranges would reduce this.

## Future Improvements

- **Google Fonts directory autocomplete** — fetch the Google Fonts API for suggestions instead of freeform input
- **Font subsetting** — subset uploaded fonts to reduce export file sizes
- **Bulk variant upload** — drag a folder or zip of font files, auto-detect weights/styles from filenames
- **Font usage tracking** — show which themes use a font before deletion (informational, not blocking)
- **Cloud storage quotas** — limit uploaded font storage per organization in deckyard-cloud
- **Font library sharing** — allow fonts to be shared across organizations in multi-workspace mode
