# `.deck` bundle format

> The container. For the portable deck envelope it carries (`deck.json`), see
> [`deck-format.md`](./deck-format.md) — the `deckyard.deck` format spec.

A `.deck` bundle is a self-contained, portable archive of a presentation and
its assets. Where the JSON export (`/export/json`) carries only the deck and
still points at server-hosted `/uploads/…` images, the bundle **carries its own
pixels** — so it renders and round-trips on another machine without the server,
and it can enumerate exactly which assets it needs.

The layout is OCF/EPUB-inspired.

The media type `application/vnd.deckyard.deck` is registered with IANA
(vendor tree, registered 2026-08-14):
<https://www.iana.org/assignments/media-types/application/vnd.deckyard.deck>.
The registration names <https://deckyard.eu/spec/deck-bundle/>,
<https://deckyard.eu/spec/deck-format/> and
<https://deckyard.eu/schema/v3/deck.schema.json> as the published
specification, so those URLs are a permanent commitment: they keep working
or they redirect, and changing the registration goes through the same
Expert Review as the original request.

## Archive layout

```
mimetype               First entry, STORED (uncompressed). Content:
                       "application/vnd.deckyard.deck". Lets the archive be
                       identified by magic number. The historical
                       "application/vnd.slidecreator.deck" is still accepted on
                       read (see deck-format.md, "Legacy sentinel").
manifest.json          Bundle metadata + the asset inventory (see below).
deck.json              The portable deck (as from presentationToDeck), with
                       every asset ref rewritten to a bundle ref.
theme.json             The deck's database theme, when it is on one (see
                       Theme). Absent for a file theme.
slide-types/<slug>.json
                       Each database slide type the deck uses (see Custom
                       slide types). Absent for core and file-JS types.
assets/<sha256>.<ext>  The asset bytes, content-addressed by SHA-256 of the
                       content: slide images, theme logos and curated font
                       files. Identical bytes are stored once (dedup).
```

## `manifest.json`

```json
{
  "format": "deckyard.deck",
  "bundleVersion": 3,
  "mimetype": "application/vnd.deckyard.deck",
  "deck": "deck.json",
  "theme": { "ref": "theme.json", "hash": "9c1f…07ab" },
  "slideTypes": [
    { "slug": "hero", "ref": "slide-types/hero.json", "hash": "41d0…9e2c" }
  ],
  "assets": [
    {
      "ref": "assets/e2e9…445a.png",
      "id": "sha256-4unkYiBMX+HF…",
      "hash": "e2e9…445a",
      "mime": "image/png",
      "bytes": 1265204,
      "sources": ["/uploads/photo-1a2b.png"]
    },
    {
      "ref": "assets/77d0…c3e1.woff2",
      "id": "sha256-d9DK…",
      "hash": "77d0…c3e1",
      "mime": "font/woff2",
      "bytes": 48212,
      "fontFaces": [
        { "family": "Inter", "weight": 400, "subset": "latin" },
        { "family": "Inter", "weight": 700, "subset": "latin" }
      ]
    }
  ],
  "missingAssets": ["/uploads/gone.png"],
  "fontsNotIncluded": [
    {
      "family": "Brand Sans",
      "role": "body",
      "source": "adobe",
      "reason": "licensed"
    }
  ]
}
```

- **`bundleVersion`** — `3` since the bundle carries slide types (B251, D91);
  `2` added the theme (B250, D90). A reader reads the versions it knows (`1`,
  `2` and `3`: each is the one before it plus a part) and refuses any other,
  rather than silently dropping parts it cannot see.
- **`theme`** (optional) — where `theme.json` lives and the SHA-256 of its
  bytes; the reader re-hashes it like an asset and rejects a mismatch.
- **`slideTypes`** (optional) — one entry per carried slide type: its `slug`,
  its `ref` (always `slide-types/<slug>.json`) and the SHA-256 of its bytes.
  The reader refuses another path, a hash mismatch, and a file that names
  another slug.

- **`ref`** — where the bytes live in the archive; also the value used inside
  `deck.json`.
- **`id`** — an SRI-shaped integrity id (`sha256-<base64>`), the stable,
  algorithm-tagged identity of the asset.
- **`hash`** — the hex SHA-256 (the content address; matches the `ref` name).
- **`sources`** — on a slide image or theme logo: the original `/uploads/…`
  name(s) that mapped to this asset.
  This is the **separate name layer**: human names stay in the manifest so hash
  churn never leaks into the readable structure. Multiple sources means the
  same bytes were referenced from several places.
- **`fontFaces`** — on a font file instead of `sources`: every face
  (`family`, `weight`, `subset`) the file serves. A variable family pins one
  file per subset for all its weights, so one asset names several faces.
- **`missingAssets`** (optional) — local refs whose bytes could not be read at
  export time; these keep their original ref in `deck.json` (or `theme.json`).
- **`fontsNotIncluded`** (optional) — the theme's fonts that travel by name
  only, each with its `role` (`heading`/`body`), `source` (`upload`, `adobe`,
  `monotype`, `google` for a managed family; `curated` for a pinned one) and a
  `reason`: `licensed` (upload, Adobe or Monotype: licensed to the sending
  organization, and a bundle installs elsewhere, which is redistribution) or
  `not-vendored` (the sending instance holds no file for it).

## `deck.json`

The portable deck (`presentationToDeck` output: `format`, `version`, `title`,
`lang`, `translations`, `theme`, and `slides`, each slide's `type` in its
canonical id, with its `notes`, `duration`, `visibility` and `translations`).
Every language version of the deck travels in it; see
[Languages](./deck-format.md#languages). Asset refs in
slide content are rewritten from `/uploads/x.png` to the bundle ref
`assets/<hash>.<ext>`. External (`http(s)://`) image URLs are left untouched —
they are already portable and are not fetched into the bundle.

## Theme

A presentation on a **database theme** points at an organization record by id,
and that id means nothing on another instance. The bundle therefore carries the
record as `theme.json` — exactly the fields a theme is created from, with no
id, organization, default flag, authorship or font-family id:

```json
{
  "slug": "brand",
  "label": "Brand",
  "logoUrl": "assets/5a1b…e0.svg",
  "logoSmallUrl": null,
  "colors": {
    "primary": "#ff0055",
    "background": "#101010",
    "textLight": "#ffffff",
    "textDark": "#1f2937"
  },
  "fonts": { "heading": "Inter", "body": "Brand Sans" },
  "config": { "version": 1, "logos": { "dark": "assets/5a1b…e0.svg" } }
}
```

Its logos go through the same asset walk as slide images (a ref is a whole
string; a `url()` inside a CSS value is not an asset ref). `deck.json` keeps the
theme id it had.

**Fonts** come in two classes. A **curated** family (the pinned, vendored
Google Fonts under open licences) travels as bytes: its files are assets with
`fontFaces`. A **managed** family (an organization's upload, Adobe or Monotype
font, or a Google family the instance does not vendor) travels by name, listed
in `fontsNotIncluded`. Standalone HTML embeds uploads too; the difference is
deliberate — an HTML export is a rendered document, a bundle installs.

A **file theme** (`themes/<id>.json`, a fork's `custom/themes/<id>/`) is not a
record: it ships with an install, like a file-JS slide type, and travels by the
id in `deck.json` alone.

## Custom slide types

A slide on a **database slide type** (built in Settings > Slide Types) stores
the type as `custom-<slug>`, and that slug names nothing on another instance.
The bundle therefore carries each database type the deck uses as
`slide-types/<slug>.json`, exactly the fields a type is created from, with no
id, organization, publication state, order or authorship:

```json
{
  "slug": "hero",
  "label": "Hero",
  "baseType": null,
  "fields": [{ "key": "title", "type": "string", "label": "Title" }],
  "defaults": { "title": "Hello", "image": "assets/5a1b…e0.png" },
  "defaultsByLang": null,
  "template": "<div class=\"slide\"><h2>{{title}}</h2></div>",
  "css": "h2 { color: #ff0055; }",
  "usage": null
}
```

Its uploads go through the same asset walk as a theme's logos. `deck.json`
keeps `custom-<slug>` on the slides. Only the organization's **published**
types travel: they are the ones a slide resolves to.

A **file-JS slide type** (core, or a fork's `custom/slide-types/`) is code, not
a record: it ships with an install and travels by the type id on the slide
alone. The same fork resolves it; any other install imports the placeholder.

## Guarantees

- **Self-contained:** all local slide assets are embedded, and so are a
  database theme's logos and curated fonts. What is not: managed fonts
  (`fontsNotIncluded`), a file theme, and assets referenced from inside CSS
  values.
- **Content-addressed + verifiable:** each asset's bytes hash to its `ref`/`hash`;
  the reader (`readDeckBundle`) re-hashes every asset and rejects a mismatch.
- **Deduplicated:** identical bytes are stored once regardless of how many
  slides reference them.
- **Enumerable:** the manifest is a complete inventory of the deck's assets.

## Import (re-hydrating a bundle)

`POST /api/presentations/import/deck[?install=theme,slideTypes]` takes a raw
`.deck` body and creates a presentation from it — the mirror of the export.
`install` is a comma-separated list of what the importer asks to install:
`theme` and `slideTypes`. A value the install does not know is refused with 400.

In the app, the route is the **Import → Import .deck** tab of the
new-presentation dialog (`client/views/list/modals/creation-view/import-deck.js`),
and the bundle comes out of the editor's Export menu (**Data & bundle → .deck**).
A user who may manage themes and slide types sees one checkbox, "Install the
theme and slide types it carries", which sends `install=theme,slideTypes`: one
choice, because D91 is one rule for both. It is unticked by default. When
everything the bundle carried arrived (`installed` or `existing`, no missing
font, no failed asset), the editor of the new deck opens and `bundledTheme` /
`bundledSlideTypes` become one passing message in plain language. When
something was left out, the dialog stays and lists it above an "Open
presentation" button, the same block the Markdown import uses for its warnings
(D144: a message with a next step does not expire). A refused bundle (400)
stays in the dialog as an inline error at the file input with the server's
sentence.

The flow:

1. `readDeckBundle(buffer)` — verify the mimetype sentinel and re-hash every
   asset (integrity), yielding `{ manifest, deck, assets }`. A body that is not
   a zip at all is refused with 400 and the format's own sentence
   (`Invalid .deck bundle: the file is not a zip archive`), never the zip
   library's.
   The deck's own `lang` decides the language it imports in; a bundle whose
   `lang` or `translations` name a language this install does not author in is
   refused with 400 (`deckImportLang`).
2. **The carried theme and slide types are settled** before any bytes are
   written — see [Installing a carried theme](#installing-a-carried-theme) and
   [Installing carried slide types](#installing-carried-slide-types).
3. For each manifest asset, write its bytes back into `/uploads/` via
   `writeBundleAsset`, **verbatim** (a content-addressed file keeps its
   address; the upload path's raster re-encoding would change it), using the
   manifest `sources[0]` as the human basename. Font files are never written,
   and a definition's uploads only when that definition is installed. This
   builds a
   `assets/<hash>.<ext>` → `/uploads/<uuid>.<ext>` map.
4. `rewriteBundleRefs(deck, mapFn)` — rewrite the deck's bundle refs to the new
   upload URLs (the inverse of the export's `rewriteAssetRefs`).
5. `deckToPresentationParts` + `createPresentation`/`updatePresentation` —
   the same normalization + creation path as the JSON import. The deck's
   translations become the presentation's other language versions.

### Installing a carried theme

A bundled theme is recognised by its **content**, not its name: SHA-256 over
the canonical JSON of `theme.json` without its slug, with this instance's fonts
bound (below). Each of the organization's own themes is hashed the same way,
its logos named by the hash of their bytes. Then one of three things happens,
reported in the response as `bundledTheme` (`slug`, `label`, `status`, and
`themeId`, `reason`, `fontsMissing` where they apply):

| `status`        | When                                                                                           | The deck lands on                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `existing`      | the organization already has a theme with this content — whoever imports; nothing is installed | that theme                                                                                          |
| `installed`     | a user who may manage themes (`canManage`) asked for `install=theme`                           | the new organization theme; a taken slug gets `-2`, `-3`, …; an existing theme is never overwritten |
| `not-installed` | otherwise; `reason` is `install-not-requested` or `not-permitted`                              | the organization default theme; a theme manager can re-import with `install=theme`                  |

**Fonts on the receiving side.** A curated family this instance vendors is used
by name; its bytes in the bundle are not needed. A managed family is bound to
the organization's font family of the same name when there is one. Anything
else falls back to the default for its role — the theme renders on the font
stack — and is listed in `fontsMissing`. The theme installs in that resolved
form, so a second import of the same bundle resolves, hashes and dedups the
same way; once the organization adds the family, the bundle installs as a
different theme.

### Installing carried slide types

The same rule as the theme, per type. A carried type is recognised by its
**content**: SHA-256 over the canonical JSON of its definition without the
slug, compared with each of the organization's published types hashed the same
way. Each outcome is one entry of `bundledSlideTypes` in the response (`slug`,
`label`, `status`, and `typeId`, `reason` where they apply):

| `status`        | When                                                                               | The deck's slides of this type                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `existing`      | the organization already has a published type with this content, whatever its slug | resolve to that type                                                                                                                         |
| `installed`     | a user who may manage slide types (`canManage`) asked for `install=slideTypes`     | resolve to the new type, created **published**; a taken slug gets `-2`, `-3`, … and the slides follow; an existing type is never overwritten |
| `not-installed` | otherwise; `reason` is `install-not-requested` or `not-permitted`                  | import as the placeholder, which adds that the definition is in the bundle                                                                   |

A carried type never resolves by name: when it is not installed, the slides do
not borrow an unrelated type the organization has under the same slug. A type
that cannot be created (its fields fail validation) refuses the import with
400; types installed before it in the same bundle stay, and dedup on the next
import.

**Round-trip:** for content-bearing slides, `export → import → export` is a
fixpoint (identical content-addressed refs, since identical bytes hash the same
and bundle assets are written verbatim).

**Graceful degradation:**

- An asset whose mime is unsupported by `writeUploadedFile` (or that otherwise
  fails to write) is skipped — its ref is left in place and reported in a
  `failedAssets` field on the response, rather than crashing the import.
- Unknown slide types become a `content-slide` placeholder (via
  `deckToPresentationParts`) that names the missing type, says whether it was
  deliberately removed and what replaces it, and carries the original content
  across as markdown. Import persists rather than renders, so it applies the
  same archived-slide contract as every render surface — see
  `docs/reference/slide-type-removal.md`.
- Local refs that were already missing at export time (`missingAssets`) keep
  their original `/uploads/…` ref and import as dangling (harmless) references.

## Code

- Build: `server/export/deck-bundle.js` → `buildDeckBundle(repoRoot, pres, { slideTypes })`.
- Theme, both directions: `server/export/deck-theme.js` (`portableThemeRecord`,
  `bundleThemeFonts`, `settleBundledTheme`, `installBundledTheme`).
- Slide types, both directions: `server/export/deck-slide-types.js`
  (`portableSlideTypeRecord`, `loadBundleableSlideTypes`,
  `settleBundledSlideTypes`, `installBundledSlideType`).
- What both share (content hash, verbatim uploads, free slug):
  `server/export/deck-install.js`.
- Read/validate: `readDeckBundle(buffer)` → `{ mimetype, manifest, deck, theme, slideTypes, assets }`.
- Import: `server/routes/api/presentations/import-deck.js` →
  `handlePresentationsImportDeck` (route `POST /api/presentations/import/deck`).
- Pure ref layer: `shared/slide-types/deck-assets.js`
  (`collectAssetRefs`, `rewriteAssetRefs`, `rewriteBundleRefs`, `assetRefForHash`).
  One walk serves both exports: the bundle takes the uploads it can
  content-address (`collectAssetRefs`), the [bulk export](./bulk-export.md)
  takes the wider set of paths this install serves
  (`collectServedAssetRefs`).
- Export route: `GET /api/presentations/:id/export/deck.zip` (downloads
  `<title>.deck`).

## Not yet covered

- External image URLs are not embedded.
- A file theme and a file-JS slide type travel by name only: they are part of
  an install, and a receiver without them lands on its default theme or the
  placeholder.
- Assets named inside CSS values (a `url()` in a theme's `slideBackgrounds` or
  `cssVarOverrides`) are not embedded.
