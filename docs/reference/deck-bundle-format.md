# `.deck` bundle format

A `.deck` bundle is a self-contained, portable archive of a presentation and
its assets. Where the JSON export (`/export/json`) carries only the deck and
still points at server-hosted `/uploads/…` images, the bundle **carries its own
pixels** — so it renders and round-trips on another machine without the server,
and it can enumerate exactly which assets it needs.

The layout is OCF/EPUB-inspired.

## Archive layout

```
mimetype               First entry, STORED (uncompressed). Content:
                       "application/vnd.slidecreator.deck". Lets the archive be
                       identified by magic number.
manifest.json          Bundle metadata + the asset inventory (see below).
deck.json              The portable deck (as from presentationToDeck), with
                       every asset ref rewritten to a bundle ref.
assets/<sha256>.<ext>  The asset bytes, content-addressed by SHA-256 of the
                       content. Identical bytes are stored once (dedup).
```

## `manifest.json`

```json
{
  "format": "slidecreator.deck",
  "bundleVersion": 1,
  "mimetype": "application/vnd.slidecreator.deck",
  "deck": "deck.json",
  "assets": [
    {
      "ref": "assets/e2e9…445a.png",
      "id": "sha256-4unkYiBMX+HF…",
      "hash": "e2e9…445a",
      "mime": "image/png",
      "bytes": 1265204,
      "sources": ["/uploads/photo-1a2b.png"]
    }
  ],
  "missingAssets": ["/uploads/gone.png"]
}
```

- **`ref`** — where the bytes live in the archive; also the value used inside
  `deck.json`.
- **`id`** — an SRI-shaped integrity id (`sha256-<base64>`), the stable,
  algorithm-tagged identity of the asset.
- **`hash`** — the hex SHA-256 (the content address; matches the `ref` name).
- **`sources`** — the original `/uploads/…` name(s) that mapped to this asset.
  This is the **separate name layer**: human names stay in the manifest so hash
  churn never leaks into the readable structure. Multiple sources means the
  same bytes were referenced from several places.
- **`missingAssets`** (optional) — local refs whose bytes could not be read at
  export time; these keep their original ref in `deck.json`.

## `deck.json`

The portable deck (`presentationToDeck` output: `format`, `version`, `title`,
`theme`, the `slideTypes` identity manifest, and `slides`). Asset refs in slide
content are rewritten from `/uploads/x.png` to the bundle ref
`assets/<hash>.<ext>`. External (`http(s)://`) image URLs are left untouched —
they are already portable and are not fetched into the bundle.

## Guarantees

- **Self-contained:** all local assets are embedded; the bundle renders offline.
- **Content-addressed + verifiable:** each asset's bytes hash to its `ref`/`hash`;
  the reader (`readDeckBundle`) re-hashes every asset and rejects a mismatch.
- **Deduplicated:** identical bytes are stored once regardless of how many
  slides reference them.
- **Enumerable:** the manifest is a complete inventory of the deck's assets.

## Import (re-hydrating a bundle)

`POST /api/presentations/import/deck` takes a raw `.deck` body and creates a
presentation from it — the mirror of the export. The flow:

1. `readDeckBundle(buffer)` — verify the mimetype sentinel and re-hash every
   asset (integrity), yielding `{ manifest, deck, assets }`.
2. For each manifest asset, write its bytes back into `/uploads/` via
   `saveUploadedFile`, using the manifest `sources[0]` as the human basename.
   This builds a `assets/<hash>.<ext>` → `/uploads/<uuid>.<ext>` map.
3. `rewriteBundleRefs(deck, mapFn)` — rewrite the deck's bundle refs to the new
   upload URLs (the inverse of the export's `rewriteAssetRefs`).
4. `deckToPresentationParts` + `createPresentation`/`updatePresentation` —
   the same normalization + creation path as the JSON import.

**Round-trip:** for content-bearing slides, `export → import → export` is a
fixpoint (identical content-addressed refs, since identical bytes hash the same).

**Graceful degradation:**

- An asset whose mime is unsupported by `saveUploadedFile` (or that otherwise
  fails to write) is skipped — its ref is left in place and reported in a
  `failedAssets` field on the response, rather than crashing the import.
- Unknown slide types become a harmless `content-slide` placeholder
  (via `deckToPresentationParts`).
- Local refs that were already missing at export time (`missingAssets`) keep
  their original `/uploads/…` ref and import as dangling (harmless) references.

## Code

- Build: `server/export/deck-bundle.js` → `buildDeckBundle(repoRoot, pres)`.
- Read/validate: `readDeckBundle(buffer)` → `{ mimetype, manifest, deck, assets }`.
- Import: `server/routes/api/presentations/import-deck.js` →
  `handlePresentationsImportDeck` (route `POST /api/presentations/import/deck`).
- Pure ref layer: `shared/slide-types/deck-assets.js`
  (`collectAssetRefs`, `rewriteAssetRefs`, `rewriteBundleRefs`, `assetRefForHash`).
- Export route: `GET /api/presentations/:id/export/deck.zip` (downloads
  `<title>.deck`).

## Not yet covered

- Theme assets (logos referenced on the theme, not on slides) and external image
  URLs are not embedded.
