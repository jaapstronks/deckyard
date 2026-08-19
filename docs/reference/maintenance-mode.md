# Maintenance mode

A self-hosted Deckyard restarts on every deploy. Without maintenance mode, an
editor that happens to be open during that window shows failing saves and raw
500s with no explanation: the user assumes their work is gone, and nothing tells
them otherwise. Maintenance mode turns the window into something readable —
writes are refused politely, the editor goes read-only, autosave pauses, and a
banner says the work is kept in the browser and will save when the server is
back.

## The two asymmetries it rests on

**Writes are refused, reads are not.** A read-only Deckyard is still a useful
Deckyard: viewers, presenters and share links keep working. Blocking GETs would
turn a two-minute deploy into a hard outage for people who are not writing
anything. The gate keys on the HTTP method and nothing else
(`isWriteMethod` in `server/config/maintenance.js`).

**The announcement goes out on shutdown, not on boot.** The container that holds
the open SSE connections is the one going away. A fresh container booting with
`MAINTENANCE_MODE=1` would be announcing to an empty room. So the SIGTERM
handler in `server/server.js` calls `announceMaintenance(true, …)` _before_
anything closes — that is the moment the deploy actually reaches users.

## Turning it on

| How                          | When                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `MAINTENANCE_MODE=1` at boot | A deploy you know will break writes — a migration that has not run yet. Seeds the flag before the first request. |
| Automatic, on `SIGTERM`      | Every ordinary restart. Nothing to configure.                                                                    |

`MAINTENANCE_RETRY_AFTER_SECONDS` (default 30) is what clients are told to wait;
it lands in the `Retry-After` header of every refused write.

## What each side does

**Server**

- `server/config/maintenance.js` owns the flag and stays dependency-free, so
  route handlers and tests can read it on every request.
- `server/services/maintenance.js` is the only thing that flips it for real:
  `announceMaintenance()` sets the flag _and_ broadcasts, so the broadcast can
  never be forgotten at one of the call sites.
- `server/routes/api/index.js` refuses writes with
  `503 { ok: false, error: 'maintenance' }` plus `Retry-After`, and serves
  `GET /api/maintenance` (public and unauthenticated — a client reconnecting
  after a restart has to be able to ask "are you back?" before it knows whether
  its session survived, and the answer leaks nothing).
- `broadcastToAll()` in `server/services/comment-events.js` reaches every
  connected client across every presentation.

**Client**

- `client/lib/state/maintenance.js` holds the single answer, so the banner, the
  editor's read-only mode and the autosave pause cannot drift apart. It is
  deliberately _not_ driven by failed requests: a 503 tells you a write was
  refused, only the announcement tells you it will come back, and guessing from
  error codes is how a transient blip becomes a scary banner.
- `client/views/shared/maintenance-banner.js` mounts on `document.body`, outside
  the SPA view root, so it survives navigation. Same pattern as the sandbox
  banner.
- `client/views/editor/read-only-controller.js` owns the editor's read-only
  state and mirrors it onto the shell; maintenance is its one source (slide
  locks gate individual slides, never the whole editor).

## Why it rides the comments SSE stream

The editor opens `/api/presentations/:id/comments/events` on load, not when the
comments panel opens (`editor-controller.js`), and holds it for the whole
session. Reusing it means an announcement reaches every open editor with no
second connection and no polling.

The stream is also how the feature ends, indirectly. The announcement that
maintenance _started_ travels over a connection the restart then drops, so
nothing can announce the end of it the same way. Instead the client asks
`GET /api/maintenance` on every reconnect (`onConnected`). A failed ask leaves
the banner up: "the server did not answer" is not evidence that the server is
back.

## Not built

An admin endpoint to _schedule_ maintenance ("banner: maintenance in 60s") was
listed as optional in the original request and is not here. The SIGTERM path
covers the case that actually happens on every deploy; a countdown only helps
when a human is driving the restart by hand, and it needs an admin surface to be
worth anything.
