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
- **Slide locks**: fully retired (concurrent editing is the point). The
  slide-lock manager is never initialized (no SSE listener, no refresh
  timer, no acquisitions), slide selection skips acquisition, and the
  presence-lock module is never attached — so the topbar lock-request UI
  stays dormant and no lock endpoints are called at all. The machinery
  itself is untouched and keeps serving flag-off editors byte-for-byte.
  Author locks (`lockedByAuthor`) are checked directly on the slide data
  and keep working in both modes.
- **Language switching** reads the requested version from the live doc
  (`projectLanguage`) instead of the server JSON. Translate endpoints write
  server-side; since step 4 the server applies that write to the live doc
  itself, and it reaches every client (including the initiating one) as a
  regular remote update.

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
  insert of a deep clone (all languages preserved).
- **Selected slide deleted remotely**: selection falls back to the first
  slide.

### Conflict semantics (pinned by tests)

`tests/collab-conflict-semantics.test.js` pins the accepted outcome for
every conflicting-pair case deterministically (two offline replicas, edits
before any exchange):

- **Delete vs edit of the same slide** → the delete wins; the edit vanishes
  with the slide. The inline (WYSIWYG) editor commits to the slide the edit
  *started* on (pinned by id): when that slide was deleted remotely
  mid-edit, the commit is dropped and the canvas repaints — without the id
  pin, the commit would resolve the *current* selection (which fell back to
  another slide) and write the text into the wrong slide. Found and fixed
  in the step-5 browser verification.
- **Move vs delete of the same slide** → the move wins: the concurrent
  delete removes the original, but the move's inserted clone is a new
  object that delete never saw — the slide survives at its new position.
- **Move vs concurrent edit inside the moved slide** → the edit is lost
  (it landed in the original the move deleted; the clone predates it). The
  accepted cost of clone-based moves.
- **Same field, two discrete edits** → character-level merge (Y.Text).
- **Same field while one user stays focused** → field-level LWW: the
  focused user's next keystroke deletes the other's merged-in characters
  (see above).
- **Adding a language version concurrent with content edits** → both
  survive; the new version shares the edited structure.
- **Server translate (three-way apply) vs concurrent client edit** → both
  survive; the translation reflects the base the server read, so a text
  edited during the translate keeps its edit and gets picked up by the
  next translate run.

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

## Server-side writes (step 4)

Server-side writes (MCP tools, public API, AI endpoints, `/change-theme`,
the translate endpoints) are applied to the live doc by the storage facade
itself — see "Server as collaborator" in
[collab-deck-doc.md](collab-deck-doc.md). Consequences for the editor:

- The theme-change flow needs no client bridge: the server write reaches
  the doc, arrives here as a remote update (metaChanged → preview repaint),
  and converges with the response-based `pres` update the modal already
  does.
- The step-3 translate bridge (`adoptLanguageVersion`) is **removed**, not
  kept as a fallback: with the server also writing the translation into the
  doc, a client-side write of the same texts would race it — two replicas
  independently inserting the same string into one Y.Text duplicates it on
  merge ("HalloHallo"). One writer only; the server is it. The initiating
  client may briefly show the pre-translate state until the remote update
  lands (typically same-tick with the HTTP response), after which the
  binder re-renders.
- Server writes transact under Hocuspocus' own origin and arrive here under
  the provider's origin, so `Y.UndoManager` (tracking only the binder's
  local origin) never makes them undoable.

## Revision hygiene (If-Match side routes)

Collab stores bump the deck revision server-side on every debounce, but the
editor never adopts those bumps into `pres.revision` (server-managed keys
are deliberately not synced through the doc). If-Match-guarded side routes
(scope change in the share dropdown, version restore) would therefore 409
after the first few edits of a live session.

The fix is client-side and call-site-local: `if-match-revision.js` fetches
the current revision right before the guarded call when live edits are
active (flag off: pass-through of `pres.revision`, which autosave keeps
fresh). Two alternatives were rejected deliberately: reading the revision
from the doc's `extra` is wrong because only server-side writes
(live-apply) refresh it there — the client-driven collab stores that
dominate a live session don't write back into the doc; and relaxing
If-Match server-side would weaken the flag-off API contract. The remaining
fetch-to-PATCH race window is no wider than any client-held revision ever
was, and the server-side guard still runs.

Restore during a live session behaves like any server write (step 4): the
restored deck is applied to the live doc as a three-way diff, so a
collaborator's in-flight (not yet stored) edits survive the restore rather
than being reset with the rest of the deck. The restoring client reloads
its editor afterwards, as before.

## Known limitations

- Publish/export read the stored JSON, which can lag live edits by up to one
  persistence debounce window (~2 s).
- A scope change made by one collaborator does not update `pres.scope` in
  other open editors (server-managed keys are not adopted from the doc);
  it lands on their next editor load. Cosmetic — the server enforces scope
  on every request.

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
- `client/views/editor/if-match-revision.js` — collab-aware If-Match value
  for the side routes (scope change, restore); see "Revision hygiene".
- `tests/collab-editor-binder.test.js` — two editor-like clients over a
  real mount: field edits, same-field character merge, items, add/delete/
  reorder, per-user undo/redo, language versions, persisted JSON.
- `tests/collab-conflict-semantics.test.js` — deterministic two-replica
  conflict tests pinning the accepted merge semantics (see above).
