# Live sessions & SSE

## Purpose & scope

A **live session** is the server-side machinery behind live presenting: a
presenter starts a session for a deck, an audience joins on their own devices,
and the presenter's current slide (plus poll/Q&A/feedback state) is pushed to
everyone over Server-Sent Events. This document covers that session and SSE
layer. The presenter's own two-window UI is described in
[`two-window-presenter.md`](two-window-presenter.md); this doc is the layer
underneath it.

**Naming.** The code calls the entity a **live session** everywhere
(`server/storage/live-sessions/`, `LiveSession*` identifiers,
`/api/live-sessions/…`) since the B41-b sweep. The one exception is the
**physical table `present_sessions`** (and its columns/indexes), kept until a
rename migration is worth doing. Distinguish the entity from the adjective: a
`follow-state` status value of `'live'` means a session whose presenter pushed
state recently — a live session can be `ended` or `not_started`.

## Module map

Storage (`server/storage/live-sessions/`, 10 modules):

- `server/storage/live-sessions/index.js` — barrel; the public surface.
- `server/storage/live-sessions/constants.js` — timing: `TTL_MS` (24 h idle),
  `HEARTBEAT_MS` (15 s), `LIVE_WINDOW_MS` (env `PRESENT_LIVE_WINDOW_MS`, default
  15 min).
- `server/storage/live-sessions/state.js` — the process-local
  `Map<sessionId, session>` of hot session objects (sockets, timers).
- `server/storage/live-sessions/ids.js` — `newSessionId()`, `nowState()`.
- `server/storage/live-sessions/sessions.js` — lifecycle
  (`createLiveSession` create-or-reuse per deck, `getLiveSession`,
  `touchLiveSession`), follow-code minting, in-memory TTL cleanup.
- `server/storage/live-sessions/db.js` — Postgres persistence of the _cold_
  half (`present_sessions` row): `persistSession`, `schedulePersist` (600 ms
  debounce), `hydrateSession`, `sweepExpiredSessions`.
- `server/storage/live-sessions/sse.js` — the SSE fan-out
  (`attachSessionSseClient`, `broadcast`, `updateLiveSessionState`,
  `notifyLiveSessionInteractionState`, `notifyLiveSessionDeckUpdated`,
  `broadcastBranch`). **Process-local only** (see _Implementation status_).
- `server/storage/live-sessions/control.js` — follower remote-control
  (`setLiveSessionControlEnabled`, `sendLiveSessionControlCommand`).
- `server/storage/live-sessions/follow-state.js` — `getFollowStateForPresentation`,
  the read model resolving a deck's most-recent session to
  `live` / `ended` / `not_started` / `not_found`.
- `server/storage/live-sessions/close.js` — `closeSession` (emit `close`,
  tear down, delete row).

Routes:

- `server/routes/api/live-sessions.js` (~416 lines) — **presenter** routes,
  all behind deck-write.
- `server/routes/api/live-session-audience.js` (~267 lines) — **public**
  capability-based routes (the session id is the authorization).
- `server/routes/api/follow.js` + `server/routes/api/follow/` (`state.js`,
  `events.js`, `presentation.js`, `interactions.js`, `questions.js`,
  `questions-events.js`, `status-ticker.js`, `helpers.js`) — the audience
  follow-along layer, keyed by presentation id.

SSE helpers:

- `server/utils/sse.js` — low-level frame helpers (`openSseStream`,
  `sseWrite`, `sseError`, `sseComment` for heartbeats). `sseWrite` is the one
  way a handler writes a frame — it builds the message before writing it (no
  interleaving) and no-ops on an ended stream.
- `server/utils/sse-limiter.js` — DoS guard for unauthenticated long-lived
  streams (`guardSseConnection`): global cap, per-IP cap, absolute-lifetime
  force-close.

## What a live session is

A live session is **two halves** (documented in `db.js`):

1. a **hot object** in `state.js`'s `Map` — the SSE client sockets and
   heartbeat timers, necessarily process-local; and
2. a **small persisted row** in `present_sessions` — which deck, current slide
   state, control flag, follow codes — that survives a restart.

The in-memory copy is authoritative for live state and is debounce-persisted to
the row; on hydrate, the newer of the two (`last_activity_at`) wins.

## Data model

Table `present_sessions` (`server/db/migrations/001_initial_schema.js`, altered
by `server/db/migrations/060_live_session_tables.js`):

| Column                    | Type         | Notes                                                                  |
| ------------------------- | ------------ | ---------------------------------------------------------------------- |
| `session_id`              | varchar(100) | primary key (a UUID string)                                            |
| `presentation_id`         | uuid         | NOT NULL (post-060), FK → `presentations(id)` **ON DELETE CASCADE**    |
| `state`                   | jsonb        | `{slideId, slideIndex, slideType, stepIdx, stepParagraphs, updatedAt}` |
| `control_enabled`         | boolean      | default false                                                          |
| `follow_codes`            | jsonb        | per-language `{nl, en}` join codes                                     |
| `follow_codes_created_at` | timestamptz  | added by 060 (re-mint decision)                                        |
| `created_at`              | timestamptz  | default now()                                                          |
| `last_activity_at`        | timestamptz  | the TTL/freshness key                                                  |

Migration 060 **dropped `organization_id`** from `present_sessions` (a session is
authorized by possession of its id, not by org — see below). The session-scoped
`interactions` / `interaction_votes` / `questions` / `feedback` tables
(`061_live_interaction_tables.js`) FK `session_id → present_sessions.session_id
ON DELETE CASCADE`, so closing a session cascades them away.

## Flows

- **Create** — presenter (deck-write) `POST /api/live-sessions
{presentationId}`. `createLiveSession` reuses a non-expired session for that
  deck (idempotent per deck) or mints a new UUID, mints per-language follow
  codes, and answers `{ok: true, sessionId, joinPath, followCodes}` — the
  mutation shape ([`storage-layer.md`](storage-layer.md) § _Failure
  signalling_). The route unwraps it and serves
  `{sessionId, joinPath, followCodes}` with 201.
- **Join** — audience connects with only the session id (companion) or the
  presentation id via a follow code (follow-along). No login.
- **Advance** — presenter `POST /api/live-sessions/:id/state` pushes the
  slide position; `updateLiveSessionState` stores it and `broadcast`s a
  `state` event to all local clients. A follower with control enabled can
  `POST /api/live-sessions/:id/control` (next/prev/goto), and `control.js`
  computes the target slide and pushes state.
- **Interactions** — the presenter opens/closes/resets a poll, likert, or
  feedback interaction; closing a slide with an `onClose` rule emits a `branch`
  broadcast so viewers auto-navigate.
- **End** — `closeSession` emits a `close` event, tears down timers/sockets, and
  deletes the row. There is **no explicit presenter "end" route**: sessions end
  by TTL expiry (24 h idle), after which a follower's status flips to `ended`
  once nothing pushed state within `LIVE_WINDOW_MS`.

## SSE flow

- **Stream endpoints** (`text/event-stream`): `GET /api/live-sessions/:id/events`
  (companion) and `GET /api/follow/:presentationId/events` (audience). Both call
  `guardSseConnection` first, then set `Cache-Control: no-store`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`.
- **Attach** — both funnel into `attachSessionSseClient`, which registers the
  socket, immediately sends an initial `state` + `controlEnabled` event, and
  starts a 15 s heartbeat (`sseComment`).
- **Events emitted**: `state` (slide position), `controlEnabled`, `control`,
  `interactionState` (poll/likert/feedback aggregates), `deckUpdated` (deck
  edited mid-session), `branch` (auto-navigate), `close` (with `{reason}`), and
  heartbeat comments. The follow stream additionally emits `status` every 2 s.
  There is **no `audience-count` event** — audience size is not tracked.
- **Keeping a follower in sync** — the follow `/events` handler subscribes to a
  shared per-presentation status ticker (`follow/status-ticker.js`, 2 s) that
  fans follow-state to all followers as a `status` event. When status becomes
  `live` with a `sessionId`, the follower also attaches to that session's SSE for
  direct `state`/`interactionState`/`deckUpdated` pushes, and re-attaches on
  session change. The client (`client/views/follow/sse.js`) has a polling
  safety-net when the stream looks unhealthy (>8 s since last event).

## Config & flags

| Name                         | Where                        | Purpose / default                                        |
| ---------------------------- | ---------------------------- | -------------------------------------------------------- |
| `PRESENT_LIVE_WINDOW_MS`     | `live-sessions/constants.js` | Freshness window for `live` status. 15 min (floor 60 s). |
| `SSE_MAX_CONNECTIONS`        | `utils/sse-limiter.js`       | Global concurrent public SSE cap. 2000.                  |
| `SSE_MAX_CONNECTIONS_PER_IP` | `utils/sse-limiter.js`       | Per-IP cap (skipped behind proxy/NAT). 50.               |
| `SSE_MAX_LIFETIME_MS`        | `utils/sse-limiter.js`       | Absolute stream lifetime. 6 h.                           |

Internal constants (not env): `TTL_MS` (24 h idle session), `HEARTBEAT_MS`
(15 s), follow-code TTL (24 h, `server/storage/follow-codes.js`), status tick
(2 s), persist debounce (600 ms). **No feature flag** gates live sessions,
and there is **no max-audience** cap beyond the SSE connection caps.

## Authz & tenancy

- **Start**: deck-write only. Every route in `live-sessions.js` goes through
  `requirePresentationControl` → `withPresentationAuth({permission:'write'})`.
- **Join**: anonymous, capability-based. The audience and follow routes sit in
  the _public_ block of `server/routes/api/index.js`, before the login gate. The
  **session id** authorizes companion routes; the **follow code / presentation
  id** authorizes follow routes. A join link is explicitly not a login — the
  companion deck read is narrowed (slides/notes/title/theme/lang only, no
  owner/collaborators/settings/history).
- **Org-scoping**: live sessions are **not** org-scoped (migration 060 dropped
  the column). Cross-org reads go through `crossOrganizationScope(reason, …)`;
  org deletion still cascades sessions away via `presentation_id`. The anonymous
  speaker-notes write (`PUT /api/live-sessions/:id/notes/:slideId`,
  rate-limited per IP) derives its write scope's `organizationId` from the
  resolved deck, never from the caller. General rules:
  [`tenant-isolation.md`](tenant-isolation.md).

## Implementation status (as of 2026-08-21)

The session lifecycle, SSE fan-out, follower control, and interaction/Q&A/
feedback flows are implemented and shipped. The **known limitation** is that SSE
fan-out is **process-local** (documented in `db.js` and `sse.js`): a follower on
a different worker than the presenter does not receive live pushes and only
re-syncs on the 2 s status tick or a reconnect. Multi-worker fan-out would need a
Redis pub/sub layer, which is not built. Session end is TTL-driven; an explicit
presenter "end session" action does not exist today.
