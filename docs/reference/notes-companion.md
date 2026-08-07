# The notes companion — session-token-scoped reads and writes

The speaker-notes companion is the phone view at `/notes/:sessionId`: a mirror of
the presenter's current slide with the notes for it, an "up next" preview,
optional Q&A, and — when the presenter enables it — remote deck control. It is
reached by scanning the QR code the editor shows (`/notes-join/:sessionId`).

This page describes the **authorization model** the companion runs on, because
it is different from the rest of the app: the companion is authorized by the
live-session id in its link, not by a login.

## The capability

A live-session id is a UUID minted behind deck-write
(`POST /api/live-sessions`, `server/routes/api/live-sessions.js`) and
handed out as a join link. It has a 24-hour idle TTL
(`server/storage/live-sessions/constants.js`).

Handing someone that link is the deck owner's own act. So whoever holds it may:

- follow the session (`GET /state`, `GET /events`),
- read the deck behind it (`GET /deck`),
- **edit that deck's speaker notes** (`PUT /notes/:slideId`).

Logged in or not. A speaker scanning a QR code on a phone that has never seen a
login screen is the case this exists for.

This is the same shape as the follow-along audience, where the live follow code
plays the capability's part (`server/routes/api/follow/*`), and as the share-link
guest, who may write comments on exactly the deck their token addressed.

## Where it lives

| Surface | File |
|---------|------|
| The four capability-based routes | `server/routes/api/live-session-audience.js` |
| Presenter-only routes (state push, interactions, feedback export, control) | `server/routes/api/live-sessions.js` |
| The targeted notes write | `server/storage/presentations/slide-notes.js` |
| The companion view | `client/views/notes/` (edit UI in `notes-editor.js`) |

The audience module is dispatched from the **public block** of
`server/routes/api/index.js`, before the login gate — the same block that serves
`/api/follow/*` and `/api/share/*`. The client mirrors this: `/notes` and
`/notes-join` are handled in the public-routes branch of `client/app.js`, so an
anonymous visitor is never bounced to `/login`.

## The boundary

Three properties, and each has a test in
`tests/live-session-notes-write.test.js`:

1. **The scope is one session.** Every handler resolves the session first and
   then acts only on `session.presentationId`. No handler accepts a presentation
   id from the caller, so a token for session A can never address deck B.
2. **The write touches one field.** `updateSlideNotes` replaces `slides[].notes`
   on one slide and passes `{ slides }` and nothing else to
   `updatePresentation`, whose partial-write rule leaves every unnamed column
   alone. Title, settings, theme and the i18n buffers survive untouched.
3. **The deck's own rules still apply.** The write goes through the shared
   slide-lock policy, so an author-locked slide or one another user holds a
   concurrent lock on is refused with a 423 — the companion is never the author.

An unknown session and an expired one both answer 404. Telling them apart would
let a caller probe which session ids ever existed, and it is the answer the
pre-existing `/state` and `/events` routes already gave.

The deck read is deliberately narrower than `GET /api/presentations/:id`: slides,
title, theme id, deck language, revision. No owner, no collaborators, no
settings, no version history. A join link is not a login.

Anonymous writes are throttled per IP (`allowCompanionNotesWrite` in
`server/utils/rate-limit.js`) — a volume cap rather than a guess cap, since the
caller *is* allowed to write; it just must not be usable to hammer the slides
column. Notes longer than `MAX_NOTES_LENGTH` are a 400.

## Concurrency

Last-write-wins on the one field, with the slide lock as the only guard. Notes
are a single string per slide, so the conflict window is a sentence; a merge
mechanism would cost more than it buys. The companion's editor does two things
to keep that honest:

- **Unsaved text follows its slide.** The companion tracks the presenter, so the
  viewed slide can change mid-edit. The buffer is flushed to the slide it was
  typed on before the swap.
- **A refresh never overwrites a live buffer.** A `deckUpdated` event reloads the
  deck; while the buffer is dirty the incoming text is not applied. A clean
  buffer adopts it immediately.

After a successful write, `updatePresentation` broadcasts `deckUpdated` on the
session's SSE channel, so the desktop editor and any other companion reload.
