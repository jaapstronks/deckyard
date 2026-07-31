# The `deckyard.deck` format

`deckyard.deck` is Deckyard's **portable, versioned deck interchange
format** — the durable envelope a presentation serializes to so a second
implementation can read, render, and round-trip it without Deckyard's server or
storage. It is what `GET /api/presentations/:id/export/json` returns, and what
the [`.deck` bundle](./deck-bundle-format.md) carries as its `deck.json`.

A deck is **data, not a rendering.** The format is intentionally readable and
stable: no server-internal UUIDs or timestamps are required, and slides are a
flat array of `{ type, content }`.

The canonical example lives at `tests/fixtures/example-deck.json` and is
exercised by `tests/deck-format-spec.test.js` (the CI gate behind this spec).

## Envelope

```json
{
  "format": "deckyard.deck",
  "version": 1,
  "title": "My deck",
  "theme": "default",
  "slideTypes": { "title-slide": "core/title-slide" },
  "slides": [
    { "type": "title-slide", "content": { "title": "Hello", "background": "lime" } }
  ]
}
```

| Field        | Type     | Notes |
|--------------|----------|-------|
| `format`     | string   | Always `"deckyard.deck"`. The magic sentinel that identifies the format. A conforming reader also accepts the historical `"slidecreator.deck"` (see [Legacy sentinel](#legacy-sentinel)). |
| `version`    | integer  | Format version. `1` today. Bumped only on a breaking envelope change (see [Versioning](#versioning)). |
| `title`      | string   | Human title of the deck. |
| `theme`      | string   | Theme id the deck was authored against (e.g. `"default"`). A reader that lacks the theme falls back to its own default; content is unaffected. |
| `slideTypes` | object   | Identity manifest: bare type key → `namespace/name[@version]` (see below). |
| `slides`     | array    | Ordered list of slides, each `{ type, content }`. |

The envelope is **lenient**: unknown top-level keys are ignored by the importer,
not rejected. This keeps forward-compatibility — a newer producer can add fields
an older reader simply skips.

## `slideTypes` — the identity manifest

`slideTypes` records which slide-type **definitions** a deck was written against,
as a map of the bare type key to its qualified identity:

```json
"slideTypes": {
  "title-slide": "core/title-slide",
  "quote-slide": "core/quote-slide"
}
```

- The value is `namespace/name[@version]`. Core types resolve to the `core/`
  namespace; a custom type carries its own namespace (e.g. `acme/hero`).
- It is **recomputed from the registry on every export** (never hand-maintained),
  so it cannot drift from the slides it describes. The CI fixture test asserts
  the committed example's manifest equals the recomputed one.
- `slides[].type` stays the **bare key** for back-compat; the manifest is the
  place a reader learns which definition/version each key needs. A qualified ref
  in `slides[].type` (e.g. `core/title-slide`) also imports — it resolves by
  identity, and storage keeps the bare local name.

See [slide-type identity](../developer/slide-types.md) for the namespace/version
model.

## Slides

Each slide is:

```json
{ "type": "content-slide", "content": { "title": "Why", "body": "..." } }
```

- **`type`** — the slide-type key (bare, or a qualified `namespace/name` ref).
- **`content`** — an object whose shape is defined by that slide type's field
  registry. Absent or `""` fields mean "unset"; the importer fills type defaults
  and never blanks a required field.

Portable slides carry **no `id`** — ids are a storage concern and are
(re)generated on import. A reader must not depend on slide identity across a
round-trip.

### Content schema (the single source)

Each slide type's `content` shape is described by a generated JSON Schema derived
from the same `fields[]` registry that drives validation and the editor — one
source, no hand-synced copy. The schemas are served live and are versioned by
`$id`:

- Per-type: `https://deckyard.eu/schema/v<N>/slide-types/<type>.schema.json`
- Whole deck (discriminated by `type`): `.../v<N>/deck.schema.json`
- Reflected at runtime alongside `GET /api/slide-types`.

Schemas are **lenient contracts, not gates**: `additionalProperties` is allowed
so legacy and forward-compatible keys still validate. They document the known
shape; they do not reject history. (Note the generated `deck.schema.json`
describes the *stored* deck, which additionally carries `id`/`schemaVersion`;
the portable envelope here is the interchange projection of that model.)

The same leniency applies to the two fields that used to close the schema:

- **`type` is constrained by shape, not by a list.** It matches
  `name`, `namespace/name` or `namespace/name@version` — the grammar in
  `shared/slide-types/type-id.js`, exported as the schema's `pattern` so there
  is one copy. A fork type, an org type or a third-party type is therefore
  *valid*, which is the whole point of publishing an open format; enumerating
  this install's registry keys made every such deck invalid against our own
  spec. The per-type discrimination is unaffected: an unknown type matches no
  `if` branch, so no content contract is demanded of it.
- **`lang` is any well-formed BCP 47 tag**, not `nl` or `en-GB`. Which languages
  a given implementation *authors* in is its own product choice — Deckyard's
  editor still normalizes to two — but the format has no business deciding it.

What a reader owes for an unknown type, and what it may claim once it does,
is [`deck-conformance.md`](./deck-conformance.md).

## Asset references

Images are referenced by string:

- **Local uploads** — `"/uploads/<name>-<uuid>.<ext>"`. Server-hosted; portable
  only while that server is reachable.
- **External URLs** — `"https://…"`. Already portable; left untouched by every
  transform.

To make a deck **self-contained** (assets travel with it), use the
[`.deck` bundle](./deck-bundle-format.md): a ZIP that embeds each local asset's
bytes content-addressed as `assets/<hash>.<ext>` and rewrites the deck's refs to
those bundle refs. Import re-hydrates them back to `/uploads/`. Bundle refs
(`assets/…`) never appear in a portable (non-bundled) deck.

## Round-trip guarantee

For content-bearing slides, `export → import → export` is a **fixpoint**: after
one normalization pass (defaults filled, ids regenerated) the portable
projection is stable, and identical asset bytes hash to identical content
addresses. `tests/deck-format-spec.test.js` proves this on the example fixture;
`tests/import-deck.test.js` proves it end-to-end through the bundle importer.

Deliberate lossy edges (they degrade, they do not crash):

- An **unknown slide type** imports as a `content-slide` placeholder (its
  original content is not preserved).
- A **missing local asset** keeps its `/uploads/…` ref and imports as a dangling
  reference.

## Versioning

- `version` is the **envelope** version, bumped only for a breaking change to the
  envelope shape itself. It is `1` today.
- Slide **content** shape is versioned independently by the schema `$id`
  (`/v<N>/…`), tied to the storage `schemaVersion` and its migration runner (see
  [schema versioning](../developer/slide-types.md)). A reader validates content
  against the schema version it understands; the lenient contract lets it tolerate
  newer keys.

## Legacy sentinel

Before the format took its publisher's name it was written as
`"slidecreator.deck"`, and the bundle mimetype as
`application/vnd.slidecreator.deck`. That name predates the product: it was
invented in the commit that first added JSON export, when the package was still
called `presentation-system`.

Decks and bundles carrying the old sentinel exist in the wild, so **a reader
accepts it forever**; only writers moved. Re-exporting a legacy deck stamps it
with the current sentinel.

Both values, current and historical, live in
`shared/slide-types/deck-format-id.js` (`DECK_FORMAT_ID`, `DECK_MIMETYPE`,
`LEGACY_DECK_FORMAT_IDS`, `LEGACY_DECK_MIMETYPES`, plus the `isDeckFormatId()` /
`isDeckMimetype()` predicates). The **file extension is unaffected**: a bundle
has always downloaded as `<title>.deck` and still does. The namespace lives
before the dot, never in the filename.

## Producing and consuming a deck

- **Export (portable):** `GET /api/presentations/:id/export/json` → this envelope.
- **Export (self-contained):** `GET /api/presentations/:id/export/deck.zip` →
  a `.deck` bundle.
- **Import (portable):** `POST /api/presentations/import/json`.
- **Import (bundle):** `POST /api/presentations/import/deck`.

## Code

- Envelope build/parse: `shared/slide-types/deck.js`
  (`presentationToDeck`, `deckToPresentationParts`).
- Identity manifest: `collectSlideTypeManifest` (`shared/slide-types/registry.js`).
- Content schema generation: `shared/slide-types/json-schema.js`.
- Asset ref layer: `shared/slide-types/deck-assets.js`.
- Spec fixture + CI gate: `tests/fixtures/example-deck.json`,
  `tests/deck-format-spec.test.js`.
