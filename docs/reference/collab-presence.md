# Collaborator presence (realtime, phase 1)

*How the live-presence layer works. Design rationale in
[ADR 001](../adr/001-realtime-collaboration.md); this phase ships awareness
only — no shared document edits yet (that's phase 2).*

## What the user sees

With `COLLAB_ENABLED=true`, everyone with the same deck open in the editor
sees:

- **Topbar avatar stack** — avatars (with a per-user presence color ring) of
  the other people currently in the deck; collapses to `+N` beyond 5.
- **Slide-list indicators** — a colored dot on the slide each person is
  viewing; the dot gains a halo when they are actively editing a field there.
- **Field-focus ring** — when someone edits a field on the slide you have
  open, that field gets a colored ring + name label on the preview canvas.

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
  happens on connect (`documentName` = `presentation:<id>`) with the same
  `getCollaboratorPermission` + `canRead/canWritePresentation` pair the REST
  routes use; non-writers (viewers, guests) get read-only connections.
  `server/collab/auth.js`.
- **Client session**: `client/lib/collab/presence-session.js` wraps
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
  microscopic — same rationale as the inline-edit overlay). Own focus is
  reported from `focusin`/`focusout` on `[data-inline-field]` elements.
- **Feature gating**: server `COLLAB_ENABLED` → `feature-flags.js` `collab` →
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

## Phase 1 boundaries (deliberate)

- The Y.Doc content is unused; nothing is persisted server-side. Slide edits
  still flow through the normal save path (autosave PUT + slide-level merge),
  and the existing slide-lock system remains the edit-exclusivity mechanism.
  (With `COLLAB_LIVE_EDITS` also on — phase 2 — the lock system is retired
  in favour of CRDT merging; see
  [collab-editor-binder.md](collab-editor-binder.md).)
- Multi-instance deployments would need cross-node awareness fan-out (Redis);
  all Deckyard realtime is process-local today, so presence follows suit.
- Phase 2 (live CRDT edits through the same connection) is specced in
  [ADR 001](../adr/001-realtime-collaboration.md).

## Testing

`tests/collab-presence.test.js` runs two headless presence sessions against a
real mounted server: peers converge on each other's view/focus state,
disconnects clean up presence, unknown documents are rejected, and a
cookieless upgrade is refused when auth is on. Node 22's built-in `WebSocket`
is used as the client; note the test process intentionally has two yjs copies
(vendored bundle + server dependency), which is fine for awareness-only
traffic.
