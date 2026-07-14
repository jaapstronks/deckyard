# Two-window presenter view

> Status: **Implemented**

Lets a presenter run the console on their laptop while a **clean deck plays
full-screen on the beamer in a second browser window**. A single window can only
fullscreen one display, so the second window is what makes "console here, clean
deck there" possible.

## Roles

- **Master** — the normal presenter view (`/present/:id`, `client/views/presenter.js`).
  Owns keyboard nav, the console rail, the elapsed timer, the highlighter, and
  the SSE present-session. It is the single source of truth.
- **Projector** — a lightweight follower view (`/present/:id/window`,
  `client/views/present-window.js`). No keys, no session, no console. It reuses
  the **deck-controller** as its render engine and mirrors the master's state.
  Auth carries over via cookies in the same browser.

The master opens the projector with the **"Second screen"** button
(`window.open`, stable window name so re-clicking focuses it) and auto-enables
its own console so the laptop keeps notes/next/timer.

## The sync bus: `present-channel`

`client/lib/present-channel.js` wraps a `BroadcastChannel` named
`deckyard:present:<id>`. It is **local** (same-origin, same-browser) and instant
— no server round-trip. This deliberately complements, rather than duplicates,
the SSE present-session, which handles cross-*device* follow/companion. A no-op
fallback keeps things working where `BroadcastChannel` is unavailable.

Message kinds (`{ kind, state? }`):

| kind    | payload                                   | direction            |
|---------|-------------------------------------------|----------------------|
| `hello` | —                                         | projector → master   |
| `state` | `{ slideIndex, stepIdx, stepParagraphs }` | master → projector   |
| `hl`    | highlighter mirror event (slide-space)    | master → projector   |
| `codes` | `{ nl, en }` session join codes           | master → projector   |
| `bye`   | —                                         | either, on teardown  |

A projector emits `hello` on load; the master replies with the current `state`,
a highlighter `emitSnapshot()`, and the follow `codes` — so a window opened
mid-presentation catches up immediately.

## How each thing is mirrored

- **Slide + step** — the deck-controller (`client/views/presenter/deck-controller.js`)
  gained two hooks that keep it the single navigation engine:
  `onStateChange` (fires on every change, independent of the SSE session, so the
  master can broadcast) and `applyRemoteState` (the projector's mirror). On a
  slide change the projector delegates to `show(idx, {direction})` — whose
  natural step reset already matches how the master resets on a jump; a
  same-slide update sets `stepIdx` and re-applies. Same-slide updates never
  involve a transition, so there's no race with morph/cube.
- **Laser / drawings** — `client/views/presenter/highlighter.js` emits mirror
  events in **slide-space** (base 1600×900, window-size independent) via
  `onEvent`; the projector runs the same module with `interactive: false` (a
  display-only overlay that never captures input) and replays them through
  `applyRemoteEvent`. Coordinates convert canvas-px → slide-space on the master
  and back on the projector, so the dot lands at the same slide position
  regardless of the two windows' sizes. Laser position is coalesced to one event
  per animation frame, and the whole per-frame stream is gated on a connected
  projector (`hasProjector`) so an active laser doesn't post to nobody.
- **Follow join codes** — the projector holds no session, so follow-invite /
  poll / feedback slides would render without the alternative `/go` codes. The
  master broadcasts the session codes (`postCodes`) once the session is ready
  and in the `hello` reply; the projector stores them, returns them from
  `getFollowCodes`, and re-renders the deck (preserving the current slide).

## Disconnect

The master sends `bye` on unmount (SPA cleanup) and on `pagehide` (hard tab
close / reload). The projector keeps the last slide up and shows a "Presenter
disconnected" pill.

## Known limitations

- Persistent drawings are stored in canvas-px, so they don't rescale if the
  projector window is resized after a stroke — same as the master's local
  behavior. The live laser is unaffected (it updates from fresh coords each
  frame).
- Same-browser only by design. Cross-device second screens are the job of the
  follow/companion SSE surfaces.
