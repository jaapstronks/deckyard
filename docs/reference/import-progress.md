# Import progress: what the bar means

Every import that can take a minute streams its progress over SSE: file
conversion (`/api/convert/stream`), Notion (`/api/notion/import/stream`) and
the paste-text wizard (`/api/ai/wizard-v2/stream`). They share one progress
model, described here. A second ladder is how the bar started walking
backwards mid-import (B595).

## The ladder

Phase boundaries live in one place, `server/utils/import-progress.js`, and no
route picks its own numbers:

| Phase                                    | Range   | Driven by                    |
| ---------------------------------------- | ------- | ---------------------------- |
| Accepted, reading and parsing the source | 5       | one event                    |
| Outline (one model call)                 | 5 → 55  | **creep**                    |
| Writing section groups                   | 55 → 85 | one event per finished group |
| Assembling the deck                      | 90      | one event                    |
| Writing it to the library                | 95      | one event                    |
| Done                                     | 100     | the client, on `complete`    |

The ladder is monotone by construction: each phase starts where the previous
one ended.

## Two rules that keep it honest

**The bar never walks backwards.** `showLoadingModal().setProgress()` keeps
the highest value it was given. A later event reporting a lower number is
ignored rather than obeyed, so no ordering accident between the stream, a
fallback and a rotation index can undo visible progress.

**A phase without events creeps, it does not stall.** The outline call is a
single model call: nothing inside it can report. Measured at ~34s for a
document import, it used to hold the bar on one number for most of the
import's wall-clock. A `status` event may therefore carry `creepTo` (and
`creepMs`), and the modal eases the bar toward that ceiling asymptotically —
it covers ~95% of the distance in `creepMs` and never arrives. The next real
`setProgress` cancels the creep and takes over, so a slow call keeps moving
and a fast one is simply overtaken.

A creep is honest because it never reaches its ceiling and never passes the
floor of the phase that follows. It is not a substitute for a real event: when
work can report, it reports (`onGroupDone` in
`server/utils/ai/refine-slides.js` is why the refine phase needs no creep).

## Who owns which surface

The modal has two surfaces, and they have different owners:

- **The bar** belongs to the modal, driven by `progress` and `creepTo`.
- **The message line** belongs to the rotator
  (`client/lib/dom/status-message-rotator.js`) as soon as the server has sent
  it a `messages` event. The rotator cycles _text only_; a rotation index is
  not progress.

So `phase: 'refine-progress'` ("Sectie 2 van 3 geschreven…") moves the bar and
leaves the text alone: the content-aware messages from the outline keep
running beside it, and the counter is already visible as the bar. Only the
closing phases (`finalize`, `save`) stop the rotator and take over both.

## No sleeping on the server

The server does not sleep before work with `setTimeout`. It hands the client
a list and starts working; the rotator fills the wait (`loop: true` for a list
that must cover a phase of unknown length, `intervalMs` for its pace). Pacing
on the server made the import measurably longer — 4.8s of it, before any work
began — for messages that described work that had not started. The one
exception is deliberate: two 500ms beats between the closing milestones
(`finalize`, `save`), so the snapped closing messages are perceptible at all —
they separate work that is already done.

## The event shapes

`status`:

```js
{ message, phase, progress?, creepTo?, creepMs? }
```

`messages`:

```js
{ statusMessages, intervalMs?, loop? }
```

Both are SSE import events, not the `/api/*` error envelope; an `error` event
carries `{ message }` (`api-error-format.md` § SSE error events).
