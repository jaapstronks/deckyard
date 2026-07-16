# ADR 001 — Real-time collaboration: Yjs + Hocuspocus as an optional layer

- **Status**: proposed (awaiting go/no-go per phase)
- **Date**: 2026-07-15
- **Research**: [docs/reference/collab-research.md](../reference/collab-research.md)

## Context

Deckyard needs Miro/Google-Docs-style collaboration: visible presence (who is
here, which slide are they on, what did they select) and live edits from
other collaborators, including edits made *by the server* (AI iterations, MCP
tools, public API, background translate jobs). Constraints from the briefing:

- proven CRDT library, no home-grown conflict resolution;
- self-hosted, open source, no proprietary sync SaaS in the core;
- collaboration must be an **optional layer** — single-user Deckyard without a
  sync server keeps working unchanged;
- framework-agnostic (vanilla JS ESM, no bundler);
- backwards compatible with the existing deck JSON format and storage.

Key research findings that shape the decision: decks are single JSON blobs
saved whole-deck with revision checks and a slide-level server merge; all
server-applied mutations funnel through one facade (`updatePresentation`);
the client addresses every editable field by `slideId` + dotted field-path;
there is no WebSocket layer yet; i18n keeps a full copy of the slides array
per language; undo is whole-deck snapshots.

## Decision

### 1. CRDT library: **Yjs**

Yjs is the production default in 2026: the largest ecosystem, plain-JS (no
WASM loading complications in a no-bundler client), framework-agnostic,
first-class awareness protocol, `Y.UndoManager` with origin scoping, and
offline support via y-indexeddb when we want it (phase 3).

Alternatives considered, per the briefing's instruction to only deviate for
concrete reasons — none found:

- **Automerge**: its differentiator is git-like document history and
  branching. Deckyard already has a snapshot/versions system serving that
  product need; paying Automerge's performance/WASM cost for a redundant
  feature is a bad trade.
- **Loro**: fastest in benchmarks and the smallest encodings, but its API and
  encoding schema were still flagged experimental/pre-stability as of
  mid-2026, and the ecosystem (providers, persistence, awareness tooling) is
  a fraction of Yjs's. Wrong risk profile for a load-bearing layer.

Sources (checked 2026-07-15): [Hocuspocus repo](https://github.com/ueberdosis/hocuspocus),
[Hocuspocus v4 release notes](https://github.com/ueberdosis/hocuspocus/blob/main/RELEASE_NOTES_V4.md),
[Yjs vs Automerge vs Loro 2026](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026),
[crdt-benchmarks](https://github.com/dmonad/crdt-benchmarks).

### 2. Sync server: **Hocuspocus (v4), mounted in the existing Node process**

Hocuspocus fits every constraint: MIT, self-hosted, Node 22+ (matches our
`engines`), attaches to the existing `node:http` server via an upgrade
handler on port 4177 (same pattern as the MCP mount at `/mcp`; Caddy proxies
WS transparently, so zero deploy changes), and provides exactly the hooks we
need:

- `onAuthenticate` → parse the `sb_session` cookie from the upgrade request
  with `getUserFromRequestAsync`, then the canonical
  `getCollaboratorPermission` + `canWritePresentation` check. Editors get
  read-write; viewers/commenters/share-link guests get `readOnly`
  connections (presence-visible, no document writes).
- `onLoadDocument` → load the stored Y.Doc binary, or bootstrap it from the
  deck JSON on first collab open.
- `onStoreDocument` (debounced) → persist the Y.Doc binary **and** serialize
  to deck JSON through the existing storage layer.
- `openDirectConnection().transact()` → the server-as-collaborator API for
  AI/MCP/API mutations.

The alternative (bare `y-websocket` server) would mean hand-rolling auth,
persistence and direct connections — Hocuspocus is those hooks.

New dependencies: `yjs`, `@hocuspocus/server` (server); `yjs`,
`y-protocols`, `@hocuspocus/provider` vendored as a one-time ESM bundle into
`client/vendor/` (same approach as `vendor-lucide.js`). App code stays
no-build.

### 3. Document granularity: **one Y.Doc per deck**

Room name `presentation:<id>`. Decks are presentation-sized (tens of slides,
usually well under 1 MB of text) — far inside Yjs's comfort zone, so
subdocuments per slide would add lifecycle complexity (N connections or
manual subdoc loading, awareness fragmentation) for no measurable win.
Revisit only if profiling ever shows doc-load pain on pathological decks
(phase 3 lists compaction/GC levers first).

### 4. Schema mapping: structure shared, content per language

```
ydoc
├── meta: Y.Map            // title (Y.Map<lang, string>), theme, settings…
└── slides: Y.Array<Y.Map> // order = array order (one array, all languages)
    └── slide: Y.Map
        ├── id, type, parentId, visibility, duration, …  (plain LWW values)
        ├── notes: Y.Map<lang, Y.Text>
        └── content: Y.Map
            ├── <plain field>: LWW value (enums, numbers, image refs, colors)
            ├── <text field>:  Y.Map<lang, Y.Text>   // string + markdown fields
            └── <array field>: Y.Array<Y.Map>        // items/rows/cards, recursive
```

- **Y.Text** for `string`/`markdown` fields (exactly the set the i18n layer
  already classifies as translatable) — character-level merging where two
  people type in the same field. Everything else is last-write-wins via
  Y.Map, which matches how those fields behave today.
- **Y.Array** for slide order and for item/row/card lists, so concurrent
  insert/reorder/delete merge structurally. Nesting stays `parentId`-based,
  as today.
- **i18n restructure (the one real data-model change)**: the CRDT doc stores
  structure **once** and per-language values inside each translatable field,
  instead of today's full slides-array copy per language. The legacy JSON
  format is preserved at the serialization boundary: the doc→JSON serializer
  *projects* `i18n.versions[lang].slides` arrays back out (and top-level
  `slides` from the dominant language), so storage, exports, presenter,
  publish and the public API see the exact format they see today. The
  JSON→doc bootstrapper does the inverse. This removes the need to replicate
  structural ops across N language arrays — the current normalize step's job
  — by construction.

### 5. Persistence: Y.Doc is live truth while collab is active; JSON stays the durable format

- New adapter methods `getYDocState(id)` / `setYDocState(id, bytes)`:
  Postgres → `presentation_ydoc(presentation_id pk, state bytea, updated_at)`;
  file backend → `data/presentation-ydocs/<id>.bin`. Stored as one merged
  update (Yjs GC on), not an append log — the existing versions system keeps
  history.
- `onStoreDocument` (debounce ~2 s, plus on last-client-disconnect):
  1. store the Y.Doc binary;
  2. serialize to legacy JSON and call the existing `updatePresentation`
     with an internal `origin: 'collab'` flag that bypasses the revision
     conflict check (the doc *is* the merge) while keeping validation,
     normalization, cache invalidation, `deckUpdated` SSE and auto-snapshots.
- If serialization/validation fails, keep the binary, log loudly, and do not
  clobber the JSON — the JSON is then at most one debounce window stale.
- Decks never opened collaboratively never get a Y.Doc; nothing changes for
  them.

### 6. Server-side mutations: one seam in the facade

`updatePresentation` (`server/storage/presentations.js`) gains a guard: if
collab is enabled **and** the deck has a loaded collab document, the incoming
whole-deck JSON is applied *to the Y.Doc* via
`openDirectConnection().transact()` using a structural differ (match slides
by id, fields by path — the Yjs twin of the existing
`mergeSlidesAtSlideLevel`), and persistence then flows through
`onStoreDocument`. Otherwise it writes the row directly, as today.

Because **every** server-applied write already goes through this facade (MCP
tools, public API, AI wizard, translate worker, change-theme, restore,
publish — verified exhaustively in the research), no tool or route needs to
know Yjs exists, and split-brain is prevented at the only place it could
arise. Client-applied AI suggestions (iterate/refine/append) need no work at
all: the editor applies them to its own Y.Doc.

**Precondition (independent bug fix, do first):** MCP mutating tools
currently perform no per-deck authorization, and the public API uses a weaker
check than the editor (see research §4). Fix both before wiring machine
clients into live documents.

### 7. Presence (awareness)

Yjs awareness protocol on the same connection, from phase 1 (before any
content sync):

```js
awareness.setLocalState({
  user:  { name, email, color },     // color: hash of email → palette
  view:  { slideId },                // which slide I'm looking at
  focus: { slideId, fieldPath } | null  // what I'm editing/selecting
})
```

UI: avatar stack in the topbar; colored ring/avatar dot on slide-list
thumbnails; colored outline + name tag on the focused field in the preview.
Stale presence is handled by the awareness protocol's built-in timeout plus
explicit `beforeunload` teardown — no polling, no TTL bookkeeping of our own.
The existing slide-lock system stays authoritative for edit exclusivity in
phase 1 and is retired in phase 2 when CRDT merging makes locks unnecessary
(the lock UI concepts — badges on thumbnails — become presence indicators).

### 8. Feature flag & migration path

- Env `COLLAB_ENABLED` (default **off**) → `feature-flags.js` → client
  `features.collab`. Off = today's Deckyard, byte-for-byte behavior; the
  sync endpoint isn't even mounted. This satisfies "core works without
  collaboration" — no separate process is required either way (Hocuspocus
  lives in the same Node process).
- Phase 2 adds `COLLAB_LIVE_EDITS` (presence can ship and soak alone).
- Per-deck migration is lazy: a deck becomes collaborative the first time an
  editor opens it with the flag on (JSON → Y.Doc bootstrap); it can always be
  read back from JSON (the durable format never changes).
- Rollback path: turn the flag off — decks keep their last serialized JSON;
  ydoc binaries become inert and can be deleted.

### 9. Client integration (no framework rewrite)

The editor keeps its `pres` object as the render model. A new binder module
makes the Y.Doc the **write target**: the existing mutation seams (the
`render-field` onChange closures, inline-edit `setByPath`, slide-list
actions/drag handlers) write to Y types keyed by the same field paths;
Y observers project changes back into `pres` and invoke the existing
targeted re-renders (`rerenderPreview`, `updateSelectedSlideListItem`,
`rerenderEditor`), reusing the existing "don't re-render while inline
editing" guard for remote updates. Undo switches to `Y.UndoManager`
(`trackedOrigins`: local origin only) behind the same topbar buttons.
Autosave/`If-Match`/conflict+remote-merge modals are bypassed when the flag
is on (persistence is server-side); they remain untouched for flag-off.

A Svelte/React rewrite was explicitly considered (see briefing) and
**rejected**: Yjs is framework-agnostic; the editor already has manual but
*targeted* re-render seams and a stable field addressing scheme, which is all
a binding needs; and the one genuinely hard UI problem (caret-stable
collaborative text in one field) requires a Y.Text↔contenteditable binding
regardless of framework. A rewrite would cost months, freeze the roadmap, and
leave the actual integration work (~the binder) the same size.

## Phasing

- **Phase 1 — Presence** (small; no data-model change, no content sync):
  Hocuspocus mount + auth hook, vendored client bundle, awareness manager +
  avatar stack / slide indicators / field-focus outlines, `COLLAB_ENABLED`
  flag, disconnect hygiene. Slide locks stay. Independently valuable; all
  infrastructure carries into phase 2.
- **Phase 2 — Live edits** (the big one): i18n-aware schema mapping +
  serializer/bootstrapper with round-trip tests, ydoc persistence in both
  adapters, editor binder + Y.UndoManager, `updatePresentation` direct-
  connection seam (AI/MCP/API live), retire slide locks, convergence tests
  (two headless clients), conflict-behavior tests (reorder vs delete,
  same-field typing, i18n edits). Preconditions: MCP/public-API authz fixes.
- **Phase 3 — Robustness** (sketch only): y-indexeddb offline + reconnect
  resync; version history stays on the existing snapshot system (snapshot on
  collab session end); update compaction + GC policy; Redis pub/sub
  (y-redis-style) only if multi-instance ever happens — the rest of
  Deckyard's realtime is process-local anyway.

## Consequences

**Positive**: presence and live edits comparable to Figma-class tools;
conflict handling becomes principled instead of merge-heuristic; the i18n
restructure deletes today's most fragile normalize logic; server mutations
appear live in open editors (a visible wow for the AI/MCP story); the whole
layer is deletable via one flag.

**Negative / accepted risks**: first heavyweight-ish dependencies in a
deliberately dependency-light codebase (yjs + hocuspocus, both MIT, both
replaceable behind our own binder/persistence seams); two sources of truth
during active sessions (mitigated by the single serialize path + JSON-wins
recovery); the doc→JSON→doc round-trip must be lossless (dedicated test
suite); phase 2 touches the editor's mutation seams broadly (mitigated by
the small number of seams — verified in research §2).
