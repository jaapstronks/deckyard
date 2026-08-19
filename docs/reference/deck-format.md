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
  "slides": [
    {
      "type": "eu.deckyard.slide.title",
      "content": { "title": "Hello", "background": "lime" }
    }
  ]
}
```

| Field     | Type    | Notes                                                                                                                                                                                     |
| --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`  | string  | Always `"deckyard.deck"`. The magic sentinel that identifies the format. A conforming reader also accepts the historical `"slidecreator.deck"` (see [Legacy sentinel](#legacy-sentinel)). |
| `version` | integer | Format version. `1` today. Bumped only on a breaking envelope change (see [Versioning](#versioning)).                                                                                     |
| `title`   | string  | Human title of the deck.                                                                                                                                                                  |
| `theme`   | string  | Theme id the deck was authored against (e.g. `"default"`). A reader that lacks the theme falls back to its own default; content is unaffected.                                            |
| `slides`  | array   | Ordered list of slides, each `{ type, content }`.                                                                                                                                         |

The envelope is **lenient**: unknown top-level keys are ignored by the importer,
not rejected. This keeps forward-compatibility — a newer producer can add fields
an older reader simply skips.

## Type identity: one spelling on `slides[].type`

Each slide names its type once, on `slides[].type`, in the **canonical
reverse-DNS id** — `<authority>.<name>[@version]`:

```json
{ "type": "eu.deckyard.slide.quote", "content": { "quote": "…" } }
```

- Core types are published under `eu.deckyard.slide`; a fork that declares its
  own authority gets its own (`nl.ciiic.slide.hero`), and one that declares only
  a bare namespace keeps the slash form (`acme/hero`) — that slash form _is_ its
  canonical id, not a lesser spelling.
- **One type has one id.** The older spellings — `core/title-slide` and the
  bare registry key `title-slide` — are pre-convergence residue, not part of the
  format. Deckyard's importer still accepts them and normalizes on ingest, but a
  second implementation owes them nothing; see
  [type ids](./deck-conformance.md#type-ids-one-identity-one-spelling).
- The `-slide` suffix is dropped from the canonical name: `slide` is already in
  the authority, so carrying it again is redundancy paid per type.
- The id already names the definition a deck was written against, and MAY pin an
  `@version` (`eu.deckyard.slide.title@2`). There is **no separate slide-type
  manifest** — a second map keyed on the same ids would only duplicate what each
  slide already carries.

Deckyard keeps the bare registry key internally as its lookup key
(`title-slide`); export and the read APIs project it to the canonical id, and
import folds any spelling back to the key, so the wire is canonical and the
[round-trip](#round-trip-guarantee) is stable by construction. See
[slide-type identity](../developer/slide-types.md) for the
namespace/authority/version model.

## Slides

Each slide is:

```json
{ "type": "content-slide", "content": { "title": "Why", "body": "..." } }
```

- **`type`** — the slide-type id: canonical reverse-DNS
  (`eu.deckyard.slide.content`) or `namespace/name` for a declarant without an
  authority. Export and the read APIs emit this canonical id; the importer
  accepts and normalizes every historical spelling (see
  [Type identity](#type-identity-one-spelling-on-slidestype) above).
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
describes the _stored_ deck, which additionally carries `id`/`schemaVersion`;
the portable envelope here is the interchange projection of that model.)

The same leniency applies to the two fields that used to close the schema:

- **`type` is constrained by shape, not by a list.** It matches the canonical
  reverse-DNS id, `name`, `namespace/name` or either qualified form with
  `@version` — the grammar in `shared/slide-types/type-id.js`, exported as the
  schema's `pattern` so there is one copy. A fork type, an org type or a
  third-party type is therefore
  _valid_, which is the whole point of publishing an open format; enumerating
  this install's registry keys made every such deck invalid against our own
  spec. The per-type discrimination is unaffected: a known type is discriminated
  in _every_ spelling of its id (so writing the canonical form never costs a
  slide its content contract), and an unknown type matches no `if` branch, so no
  content contract is demanded of it.
- **`lang` is any well-formed BCP 47 tag**, not `nl` or `en-GB`. Which languages
  a given implementation _authors_ in is its own product choice — Deckyard's
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

## Evolution rule

> **Within a name, only additions. A change of meaning is a change of name.**

This is normative, and it applies to every published name: a slide type, a
content key, an envelope key, an enum value.

**What a producer owes.**

1. A published name **MUST** keep its meaning for as long as it exists. If the
   meaning has to change, the name changes and the old one walks the
   [removal ladder](./slide-type-removal.md).
2. Optional keys **MAY** be added at any time. A new **required** key **MUST
   NOT** be added to a published type — that turns every existing deck invalid
   retroactively, which is a rename wearing a compatible-looking hat.
3. Widening a value space is additive (a new enum value, a new optional key).
   **Narrowing it is not** and needs a new name.
4. Nothing published is removed silently: a name that goes away is deprecated
   first, and tier 1 is covered by the standing stability promise
   ([`slide-type-tiers.md`](./slide-type-tiers.md)).

**What a reader owes.**

5. A reader **MUST** ignore keys it does not know, at every level (envelope,
   slide, content, item), and **MUST NOT** reject a deck for carrying them.
6. A reader **MUST** accept a `type` it does not know and render it per the
   [unknown-type contract](./deck-conformance.md#the-unknown-type-contract).

**Why the rule replaces migration freedom.** Deckyard has `SCHEMA_MIGRATIONS`
(`shared/slide-types/schema-version.js`) because it owns both ends of the line:
an old deck is read, migrated forward in memory, and written back in the current
shape. That freedom stops at our own storage. **A reader we do not own does not
run our migration chain** — so for anything _published_, a migration is not a
fix, it is a break that we happen to survive. The rule is what we trade the
freedom for, and it is worth more: it is why a reader written today still works
in three years without tracking our releases.

The form is borrowed from atproto's Lexicon, deliberately: same problem (records
crossing a boundary between implementations that upgrade on their own schedules),
same answer, and no reason to invent a second dialect of it. It sharpens
`deck-format-spec-decisions.md` decision 4 rather than contradicting it.

### Scope: beta is the correction window

The rule above is the contract for a format with readers we do not own. While
Deckyard carries the **beta badge**, that population is deliberately near zero
(one fork, run by the maintainer, upgrading in lockstep), and the priority is
inverted: **getting the format right beats preserving its early shapes.**
During beta a narrowing or a rename that makes the format cleaner is allowed —
shipped as a documented breaking change with a migration for stored decks, per
the [beta stance](./versioning.md#the-beta-stance-purity-over-compatibility).
The one-spelling convergence on this page is exactly such a change.

What the window does _not_ license: undocumented breaks, silent narrowing, or
drift into several accepted shapes for one meaning. Tolerance without
normalization is not compatibility; it is entropy with a friendly face.

When the badge comes off, the window closes and the rule binds absolutely.

## Versioning

- `version` is the **envelope** version, bumped only for a breaking change to the
  envelope shape itself. It is `1` today.
- Slide **content** shape is versioned independently by the schema `$id`
  (`/v<N>/…`), tied to the storage `schemaVersion` and its migration runner (see
  [schema versioning](../developer/slide-types.md)). A reader validates content
  against the schema version it understands; the lenient contract lets it tolerate
  newer keys.
- A **type id's** `@version` is neither of those two: it is a hint about which
  _definition_ a deck was written against, carried inline on the slide's own
  `type` (`eu.deckyard.slide.title@2`; a producer MAY pin it). It never makes a
  type a different type (see the evolution rule: a real change of meaning would
  have taken a new name).

## Legacy sentinel

Before the format took its publisher's name it was written as
`"slidecreator.deck"`, and the bundle mimetype as
`application/vnd.slidecreator.deck`. That name predates the product: it was
invented in the commit that first added JSON export, when the package was still
called `presentation-system`.

Decks and bundles carrying the old sentinel exist only in pre-release history,
so **Deckyard's own importer keeps accepting it**; a second implementation only
ever needs the current sentinel. Re-exporting a legacy deck stamps it with the
current one.

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
- Type-id projection: `canonicalSlideType` (export/read) and
  `resolveSlideTypeName` (import) in `shared/slide-types/registry.js`.
- Content schema generation: `shared/slide-types/json-schema.js`.
- Asset ref layer: `shared/slide-types/deck-assets.js`.
- Spec fixture + CI gate: `tests/fixtures/example-deck.json`,
  `tests/deck-format-spec.test.js`.
