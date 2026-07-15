# Collab deck document (CRDT schema + serializer)

*How a deck maps onto a Yjs document for real-time collaboration (phase 2,
step 1 of [ADR 001](../adr/001-realtime-collaboration.md) §4). This module is
standalone: nothing is wired into persistence or the editor yet — that's
steps 2 and 3.*

## The mapping

The legacy JSON keeps a **full copy of the slides array per language**
(`i18n.versions[lang].slides`). The CRDT document stores the structure
**once** and per-language values inside each translatable field:

```
ydoc
├── meta: Y.Map
│     title: Y.Map<lang, Y.Text>
│     dominant: string            // e.g. 'nl'
│     langs: string[]             // language versions present
│     extra: JSON                 // top-level keys except slides/title/i18n
│     i18n: JSON|null             // i18n minus versions (null = no i18n block)
└── slides: Y.Array<Y.Map>
      id, type, <other slide keys>: plain LWW values
      notes: Y.Map<lang, Y.Text>
      content: Y.Map
        <plain field>: LWW value           // enums, numbers, images, …
        <text field>:  Y.Map<lang, Y.Text> // string + markdown fields
        <items field>: Y.Array<Y.Map>      // items/rows/cards, recursive
```

Two people typing in the same field merge at character level (Y.Text);
everything non-textual is last-write-wins; slide order and item lists merge
structurally (Y.Array). A structural edit (add/remove/reorder slide or item)
automatically applies to **all** languages because there is only one
structure — the job of the editor's fragile `syncOtherLanguageStructureForSave`
disappears by construction once the binder (step 3) lands.

**Self-describing encoding**: on a content (or item) map, a nested Y.Map is
always a lang→Y.Text map, a nested Y.Array is always an items list, anything
else is a plain value. Projecting the doc back to JSON therefore needs no
schema. Only the JSON→doc bootstrap consults `SLIDE_TYPES` to classify
fields: `string`/`markdown` fields (top-level and in `itemFields`,
recursively) are per-language text — the same classification the i18n
translate pipeline uses — with `hidden` fields (machine ids) kept plain.
Unknown slide types fall back to all-plain (LWW) with no data loss on
round-trip.

## Bootstrap policy (JSON → doc)

Matches the editor's existing language-sync semantics:

- The **dominant** language version owns the structure: slide set/order,
  item counts/order, and every non-translatable value.
- Other versions contribute only their per-language texts, matched by slide
  **id** and item **index**.
- Divergent versions are normalized, not silently corrupted: slides that
  only exist in a non-dominant version are dropped, diverging slide types
  follow the dominant — both reported in the returned `warnings`. Callers
  (step 2's `onLoadDocument`) must log these loudly.
- A translation that only exists in a non-dominant version survives, even
  when the dominant version lacks the field.
- Decks without an `i18n` block stay single-language (`pres.lang`); the
  projection does not invent an `i18n` block for them.

Improvement over today: nested item texts (e.g. `text-blocks-slide`
`rows[].blocks[].title/body`) are per-language in the doc, while the current
editor sync overwrites them with the source language on every save.

## Projection (doc → JSON)

Rebuilds the exact legacy format: `i18n.versions[lang] = {title, slides}`
per language in `meta.langs`, top-level `title`/`slides` from the dominant
language (the `normalizeI18n` invariant). Missing per-language texts project
as `''` (same blanking the editor sync does). Storage, exports, presenter
and the public API keep seeing the format they see today.

## Files

- `shared/collab/deck-ydoc.js` — the codec. Y-agnostic: `createDeckYdocCodec(Y)`
  takes the yjs namespace so the same module runs on the server
  (`import * as Y from 'yjs'`) and the client (vendored bundle exports `Y`).
  Also exports `textFieldSpecForType` (recursive translatable-field spec).
- `server/collab/deck-doc.js` — server binding (`deckYdocCodec`, `Y`).
- `tests/collab-deck-ydoc.test.js` — round-trip tests: hand fixtures
  (single-lang, bilingual, nested rows/blocks, divergent versions), an
  all-registered-slide-types bilingual deck built from real defaults, CRDT
  wire-format sync + concurrent-edit convergence, and an opportunistic pass
  over any real decks in local file storage.
