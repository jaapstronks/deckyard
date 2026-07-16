# Collab deck document (CRDT schema + serializer + persistence)

*How a deck maps onto a Yjs document for real-time collaboration (phase 2,
steps 1–2 and 4 of [ADR 001](../adr/001-realtime-collaboration.md) §4–6).
The editor binder (step 3) is documented in
[collab-editor-binder.md](collab-editor-binder.md).*

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
disappears by construction with the binder (step 3) in place.

`i18n.active` is per-client editor state and is deliberately **not** stored
in the doc: bootstrap strips it and projection emits `active = dominant`. (A
stored `active` ≠ `dominant` would make the storage facade's `normalizeI18n`
overwrite `versions[active]` with the dominant-language buffers on every
collab store.)

**Self-describing encoding**: on a content (or item) map, a nested Y.Map is
always a lang→Y.Text map, a nested Y.Array is always an items list, anything
else is a plain value. Projecting the doc back to JSON therefore needs no
schema. Only the JSON→doc bootstrap consults `SLIDE_TYPES` to classify
fields: `string`/`markdown` fields (top-level and in `itemFields`,
recursively) are per-language text — the same classification the i18n
translate pipeline uses, except that `hidden` fields (machine ids,
deprecated legacy fields) are deliberately kept plain where the translate
pipeline does not filter them. Legacy decks whose versions diverge in such
plain fields normalize to the dominant value **with a warning** at
bootstrap.
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

## Persistence (`COLLAB_LIVE_EDITS`)

Gated by `COLLAB_LIVE_EDITS` (requires `COLLAB_ENABLED`; default off so
presence can soak alone). With the flag on, the Hocuspocus mount gains
persistence hooks (`server/collab/persistence.js`):

- **onLoadDocument** — load the stored doc binary; on first collab open,
  bootstrap the doc from the deck JSON instead and persist that bootstrap
  immediately (so warnings fire once, not on every open). Bootstrap warnings
  (diverged language versions) are logged loudly.
- **onStoreDocument** — debounced (2 s, max 10 s; flushed on last client
  disconnect): store the doc binary **and** serialize back to the deck JSON
  through the existing `updatePresentation` facade — no `expectedRevision`
  (the doc *is* the merge), but validation, normalization, cache
  invalidation, `deckUpdated` SSE and throttled auto-snapshots
  (`reason: 'collab'`) all apply. If serialization fails, the binary is kept
  and the JSON is left untouched (at most one debounce window stale). An
  unpopulated doc is never stored over a real deck.

**Storage**: `getYDocState`/`setYDocState`/`deleteYDocState` on both
adapters — Postgres table `presentation_ydocs` (one merged update per deck,
`bytea`, cascade on deck delete; migration 040) and file backend
`data/presentation-ydocs/<id>.bin`. Facade:
`server/storage/presentation-ydocs.js`. The binary is a **cache** of the
live CRDT state; the deck JSON stays the durable format. Deleting a binary
is always safe (next open re-bootstraps from JSON).

**Cold-binary invalidation**: any successful `updatePresentation` that did
*not* originate from the collab doc (`reason !== 'collab'`) deletes the
stored binary, as does trashing a deck. Without this, a REST/MCP/AI save
made while no collab clients are connected would be overwritten by stale
doc state on the next collab open. The invalidation runs regardless of the
feature flags (it no-ops when no binary exists), so toggling
`COLLAB_LIVE_EDITS` off and back on cannot resurrect stale doc state from
before the toggle.

## Server as collaborator (step 4)

While a doc is actively loaded (clients connected), a server-side save that
only landed in the JSON would be overwritten by the next debounced collab
store. The `updatePresentation` facade therefore applies every successful
non-collab save to the live doc (`server/collab/live-apply.js`, via
Hocuspocus' `openDirectConnection().transact()`), so MCP/API/AI writes —
including the theme-change flow and the translate endpoints — appear live in
open editors. When no doc is loaded, nothing changes: the save is a cold
write and invalidates the stored binary as before.

Design decisions, deliberate and load-bearing:

- **Store-first, doc-second** (inverts the ADR §6 sketch): the JSON path
  runs every check (revision conflict, locks, author-lock validation,
  limits, schema validation) before the doc is touched, so a rejected write
  can never corrupt the live doc — and callers get today's response shape
  (the stored presentation with its bumped revision) unchanged.
- **Three-way diff** (`applyPresentationToDoc(pres, doc, { base })` in the
  codec — the Yjs twin of `mergeSlidesAtSlideLevel`): the facade passes the
  pre-save JSON as `base`; only what the caller changed vs that base
  produces ops. This matters because the stored JSON runs up to one
  persistence debounce (~2 s) behind the live doc — a two-way diff would
  revert every in-flight client edit in that window. Slides match by id,
  fields by key, texts patch per language (`patchYText`), items match by
  index; deletions (slides, keys, languages) only happen when the base knew
  the thing being deleted, so concurrent client additions survive.
- **Transaction origin**: Hocuspocus' direct connection transacts with its
  own `{source: 'local'}` origin; client undo managers track only their
  binder's local origin (and remote updates arrive under the provider's
  origin anyway), so server writes are never undoable by clients — covered
  by an explicit test.
- **No store loop**: `disconnect()` flushes the store hooks immediately
  (collapsing the pending debounce) so the binary is persisted right away,
  and `onStoreDocument` skips the JSON write when the doc projection equals
  the stored deck — a server write settles at exactly one revision bump.
- Divergent language versions normalize to the dominant with the same loud
  warnings as bootstrap; a language version the caller dropped is removed
  (loudly), including its per-field texts.
- If the apply itself fails, the JSON save has already succeeded and an
  error is logged loudly; the gap for that one write equals the pre-step-4
  behavior (the next collab store wins).

## Files

- `shared/collab/deck-ydoc.js` — the codec. Y-agnostic: `createDeckYdocCodec(Y)`
  takes the yjs namespace so the same module runs on the server
  (`import * as Y from 'yjs'`) and the client (vendored bundle exports `Y`).
  Also exports `textFieldSpecForType` (recursive translatable-field spec)
  and `patchYText` (minimal Y.Text patch, shared with the client binder).
  The codec includes `applyPresentationToDoc` (the step-4 differ).
- `server/collab/deck-doc.js` — server binding (`deckYdocCodec`, `Y`).
- `server/collab/live-apply.js` — the server-as-collaborator seam, called
  from the `updatePresentation` facade after a successful non-collab save.
- `server/collab/persistence.js` — Hocuspocus onLoad/onStore hooks
  (dependency-injectable for tests); wired in `server/collab/mount.js`.
- `server/storage/presentation-ydocs.js` — doc-state facade;
  `server/storage/presentations/ydoc-state.js` (file backend),
  `server/db/migrations/040_presentation_ydocs.js` (Postgres).
- `tests/collab-persistence.test.js` — hook + invalidation tests;
  `tests/collab-live-edits.test.js` — end-to-end over a real mount (two WS
  clients, concurrent edits converge, debounced JSON persist);
  `tests/collab-server-apply.test.js` — the step-4 differ (unit) + facade
  writes reaching live editors end-to-end (undo isolation, in-flight edits,
  revision stability).
- `tests/collab-deck-ydoc.test.js` — round-trip tests: hand fixtures
  (single-lang, bilingual, nested rows/blocks, divergent versions), an
  all-registered-slide-types bilingual deck built from real defaults, CRDT
  wire-format sync + concurrent-edit convergence, and an opportunistic pass
  over any real decks in local file storage.
