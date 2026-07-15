# Collab editor binder (live edits in the editor)

*How the editor binds to the shared Y.Doc when `COLLAB_LIVE_EDITS` is on
(phase 2, step 3 of [ADR 001](../adr/001-realtime-collaboration.md) §9).
The doc schema/serializer and server persistence are covered in
[collab-deck-doc.md](collab-deck-doc.md); presence in
[collab-presence.md](collab-presence.md).*

## Design: one seam, two directions

The editor keeps its mutable `pres` object as the render model; the Y.Doc is
the source of truth and the **write target**. Rather than instrumenting every
mutation seam individually (form `onChange` closures, inline-edit
`setByPath`, slide-list drag, context-menu actions, AI flows, notes, title —
dozens of call sites), the binder exploits the fact that **every local
mutation already funnels through the controller's `markDirty()`**:

- **Local → doc** (`syncLocal`): on each `markDirty`, diff `pres` against a
  shadow snapshot and write the minimal Y ops in one transaction with a
  local origin — character-level patches into `Y.Text` (common
  prefix/suffix), splice diffs into item `Y.Array`s (unchanged prefix/suffix
  items keep their Y identity so concurrent edits on other items merge),
  id-matched structural reconcile of the slides array.
- **Doc → pres** (deep observers): remote transactions — and undo/redo,
  which apply with the `Y.UndoManager` as origin — are projected back into
  `pres` **synchronously**, mutating existing slide objects in place (live
  form closures hold references to them). Re-rendering is debounced and
  routed to the existing targeted re-renders.

Because both directions are synchronous, `pres` ≡ active-language projection
of the doc between events; a local edit is in the doc before any remote
projection runs, so projections never clobber unsynced local work.

This is a deliberate refinement of ADR 001 §9 ("seams write to Y types"):
the observable behavior is the same — each edit becomes minimal, mergeable
Y ops — but the flag-off path stays byte-for-byte identical and no per-seam
code is touched.

## What changes with the flag on

All gated on `features.collab && features.collabLiveEdits` (server env
`COLLAB_ENABLED` + `COLLAB_LIVE_EDITS`); with the flag off every one of
these paths is untouched:

- **Autosave / If-Match / conflict + remote-merge modals**: inert. The
  controller's `markDirty` routes into the binder instead of the save
  manager, so the saveManager never sees a dirty state and never PUTs;
  persistence is the server's debounced `onStoreDocument`. The topbar chip
  shows *Saved* after each edit (or *Unsaved changes* while the socket is
  down — edits wait in the local doc and sync on reconnect).
- **Undo/redo**: `Y.UndoManager` scoped to the slides array + meta map with
  `trackedOrigins` = the binder's local origin — undo reverts **your own**
  edits only, never a collaborator's, and works for deletions/reorders too.
  Same topbar buttons and keyboard shortcuts.
- **SSE slide-update handler**: not attached. Remote changes arrive through
  the doc; the SSE refetch would race it with stale (≤ one debounce window)
  server JSON.
- **Slide locks**: not acquired and not enforced (concurrent editing is the
  point). The lock machinery is untouched for flag-off editors and is
  retired for good in step 5. Author locks (`lockedByAuthor`) still apply.
- **Language switching** reads the requested version from the live doc
  (`projectLanguage`) instead of the server JSON; the translate endpoints'
  responses are pushed back into the doc (`adoptLanguageVersion`) so the
  next collab store can't overwrite the fresh translation.

## Editing semantics

- **Different fields / slides / items**: merge cleanly, including two people
  typing in different fields of the same slide.
- **Same field, both mid-edit**: the CRDT merges at character level, but the
  editor's inputs hold their whole value, so the *focused* user's next
  keystroke overwrites remote characters in that one field — field-level
  last-writer-wins while focused. This is the accepted step-3 fallback; a
  true caret-mapped `Y.Text` ↔ contenteditable binding can replace it later
  without touching the rest of the binder.
- **Caret stability**: remote updates never interrupt local editing. The
  preview re-render already refuses to run during an inline edit; the binder
  additionally defers editor-form rebuilds while focus is inside the form
  (flushed on focusout) and skips the notes textarea while it has focus.
- **Moves are clone-based**: Yjs has no move op, so a reorder is delete +
  insert of a deep clone (all languages preserved). A collaborator's
  keystroke landing in the same field during the exact move window can be
  lost — step 5's conflict-behavior tests pin down the accepted semantics.
- **Selected slide deleted remotely**: selection falls back to the first
  slide.

## i18n

The doc stores structure once with per-language texts; `pres` holds the
active language buffer. The binder writes text changes into
`Y.Map<lang, Y.Text>` at the active language, re-projects the other
languages' version buffers after remote changes (so "From NL/EN" fill
buttons stay fresh), and seeds `meta.langs` + the title when the editor
creates a new language version on the spot.

**`i18n.active` is per-client editor state and is never shared through the
doc** — the codec strips it at bootstrap and emits `active = dominant` on
projection. (This also fixed a latent step-2 bug: a stored `active` ≠
`dominant` made the server's `normalizeI18n` overwrite `versions[active]`
with the dominant buffers on every collab store, corrupting the other
language.)

## Known limitations until step 4 (server-as-collaborator)

- Server-side writes (MCP tools, public API, AI endpoints) while a doc is
  actively loaded still land only in the JSON and are overwritten by the
  next collab store — unchanged from step 2, see collab-deck-doc.md. The
  editor's own translate flows are bridged via `adoptLanguageVersion`.
- The **theme-change flow** is in the same family: deck settings' theme
  picker goes through `POST /api/presentations/:id/change-theme` (a
  server-side write; it can also convert slides) and updates `pres` without
  `markDirty`, so with the flag on the change never reaches the doc and the
  next collab store overwrites it. Other deck-settings toggles are fine
  (they mutate `pres` + `markDirty`). Bridge or retire with step 4.
- Publish/export read the stored JSON, which can lag live edits by up to one
  persistence debounce window (~2 s).

## Files

- `client/lib/collab/live-doc-binder.js` — the binder core (UI-free,
  Y/codec injected; testable headless in Node against the vendored bundle).
- `client/views/editor/live-edits/index.js` — editor glue: waits for
  provider sync, routes remote changes to the targeted re-renders with the
  focus guards above, drives the save chip / topbar title / undo buttons.
  Dynamic-imported (after the presence module, sharing its provider/doc),
  so flag-off sessions never load it.
- `shared/collab/deck-ydoc.js` — codec additions for the binder:
  single-language builders (`buildSlideForLang`, `buildItemsForLang`, …),
  projectors (`projectSlideForLang`, `projectValueForLang`), `cloneYValue`,
  `textSpecForType`.
- `client/views/editor/editor-controller.js` — the `liveEditsActive`
  branches (markDirty routing, undo delegation, lock/SSE-handler skips).
- `client/views/editor/topbar/language-mode.js` — doc-based language
  loading + translate adoption via the optional `collabLanguage` dep.
- `tests/collab-editor-binder.test.js` — two editor-like clients over a
  real mount: field edits, same-field character merge, items, add/delete/
  reorder, per-user undo/redo, language versions, persisted JSON.
