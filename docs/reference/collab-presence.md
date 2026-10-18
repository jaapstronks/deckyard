# Collaborator presence (realtime)

How the live-presence layer works. Design rationale is in
[ADR 001](../adr/001-realtime-collaboration.md). With `COLLAB_ENABLED=true`,
awareness is available. `COLLAB_LIVE_EDITS=true` also enables shared document
edits over the same connection; see
[collab-editor-binder.md](collab-editor-binder.md).

## What the user sees

With `COLLAB_ENABLED=true`, everyone with the same deck open in the editor
sees:

- **Topbar avatar stack** — avatars (with a per-user presence color ring) of
  the other people currently in the deck; collapses to `+N` beyond 5.
- **Slide-list indicators** — a name label + colored dot on the slide each
  person is viewing; the dot gains a halo when they are actively editing a
  field there. When a person moves to another slide, their label glides from
  the old thumb to the new one (a transform transition on one persistent
  element per peer; disabled under `prefers-reduced-motion`). A user with
  multiple connections gets one indicator, preferring the connection that is
  actively editing.
- **Field-focus ring** — when someone edits a field on the slide you have
  open, that field gets a colored ring + name label: on the preview canvas
  for WYSIWYG fields (label floats above the ring, pinned with a connector
  line), and as an outline + name chip inside the top-right corner on flat
  surfaces — the side-form field wrapper, the presenter-notes block and the
  inline markdown modal (if you have the same field's modal open, your modal
  shows the other editor's color). If the focused field has no _visible_
  local counterpart — a freshly spawned field/item whose content hasn't
  synced here, or a form field hidden in a collapsed group — a fallback name
  chip appears in the slide's top-right corner instead, so editing presence
  is never invisible.

Presence disappears immediately on tab close/navigate (explicit teardown on
`pagehide`) and within the awareness timeout on hard disconnects. No polling,
no lock TTL bookkeeping.

## Architecture

```
Browser editor ──ws /collab──▶ node:http server (same port 4177)
  presence-session.js            server/collab/mount.js (Hocuspocus)
  (awareness protocol)           server/collab/auth.js  (cookie + authz)
```

- **Transport**: Hocuspocus (Yjs) mounted on the existing HTTP server via a
  `server.on('upgrade')` handler for `/collab` — same-port pattern as the MCP
  mount. Off-flag installs never load the module (lazy import) and register
  no upgrade handler. `server/collab/mount.js`.
- **Auth**: the `sb_session` cookie rides on the WebSocket upgrade;
  `authenticateUpgradeRequest` resolves it with the regular auth module and
  rejects cookieless upgrades with a real HTTP 401. Per-document authorization
  happens on connect (`documentName` = `presentation:<id>`) through the
  presentation service the REST routes use, and **only a user who may write
  the deck connects**. The Y.Doc is the author's document (it carries the AI
  review notes per slide, which every read route strips) and each sync hands
  all of it over, so a read-only connection would be no boundary; viewers,
  commenters and guests use the filtered HTTP routes, and the client only
  opens the socket from the editor. Write permission is checked again on the
  first message after `COLLAB_REAUTHORIZE_MS` (10 s), and at once when the
  collaborators route removes or demotes a collaborator
  (`revalidateCollabAccess`); a connection that fails closes.
  `server/collab/auth.js`, `server/collab/mount.js`.
- **Client session**: `client/views/editor/live-edits/presence-session.js` wraps
  `HocuspocusProvider` (from the vendored bundle) and exposes
  `setViewSlide`, `setFocusField`, `getPeers`, `onPeersChange`. Awareness
  state shape:

  ```js
  { user: { email, name, color }, view: { slideId }|null, focus: { slideId, fieldPath }|null }
  ```

  The presence color is a deterministic hash of the email (like avatar
  initials colors).

- **Editor UI**: `client/views/editor/presence/presence-ui.js`. The slide
  list and preview re-render destructively, so decorations are re-applied
  from the peer list via MutationObservers rather than stored in the DOM.
  Focus rings/labels are absolutely positioned `.thumb` children at real
  screen pixels (the slide is transform-scaled; in-slide borders would be
  microscopic — same rationale as the inline-edit overlay); flat surfaces
  (side-form wrappers, notes, markdown modal — they carry
  `data-collab-field-key` with the same path vocabulary as
  `data-inline-field`) get a CSS outline + name chip instead. Own focus is
  **derived from `document.activeElement`** on document-level
  `focusin`/`focusout` (and re-derived on every refresh as a backstop) —
  never incrementally tracked per element, so a missed `focusout` (Safari
  quirks, a re-render removing the focused node) cannot leave a stale
  "still editing" ring behind on peers.
- **Feature gating**: server `COLLAB_ENABLED` → `server/config/flags-snapshot.js` `collab` →
  client `features.collab`. The editor controller dynamic-imports the
  presence module only when the flag is on, so the yjs vendor bundle is never
  fetched otherwise.

## Vendored client bundle

The client is no-build vanilla ESM, so `yjs` + `@hocuspocus/provider` are
bundled once into `client/vendor/collab.js` (ESM, ~120 KB min) and checked
in. Regenerate after dependency bumps with:

```bash
npm run vendor:collab
```

## Presence-only mode

- When `COLLAB_LIVE_EDITS` is off, Y.Doc content is unused and nothing is
  persisted server-side. Slide edits use autosave PUT plus slide-level merge,
  and slide locks remain the edit-exclusivity mechanism. With live edits on,
  CRDT merging replaces those locks; see
  [collab-editor-binder.md](collab-editor-binder.md).
- Multi-instance deployments would need cross-node awareness fan-out (Redis);
  all Deckyard realtime is process-local today, so presence follows suit.

## Testing

`tests/collab-presence.test.js` runs two headless presence sessions against a
real mounted server: peers converge on each other's view/focus state,
disconnects clean up presence, unknown documents are rejected, and a
cookieless upgrade is refused when auth is on. Node 22's built-in `WebSocket`
is used as the client; note the test process intentionally has two yjs copies
(vendored bundle + server dependency), which is fine for awareness-only
traffic.

`tests/collab-writer-only-sync.test.js` holds the access boundary over real
session cookies with live edits on: the owner and an edit collaborator receive
the AI review notes, a view collaborator is refused both while the document is
loaded and when it opens from a stored binary, and an editor who loses write
permission is disconnected, at once through the collaborator storage and on
the next message after the re-authorization interval otherwise.
