# Import progress: what the bar means

Every import that can take a minute streams its progress over SSE: file
conversion (`/api/convert/stream`), Notion (`/api/notion/import/stream`) and
the paste-text wizard (`/api/ai/wizard-v2/stream`). They share one progress
model, described here. A second ladder is how the bar started walking
backwards mid-import (B595).

## The ladder

Phase boundaries live in one place, `server/utils/import-progress.js`, and no
route picks its own numbers:

| Phase word        | What happens                         | Range   | Driven by                    |
| ----------------- | ------------------------------------ | ------- | ---------------------------- |
| `outline`         | Reading the source, the outline call | 5 → 55  | **creep**                    |
| `refine`          | The outline is in                    | 55 → 85 | **creep**                    |
| `refine-progress` | A section group is written           | 55 → 85 | one event per finished group |
| `finalize`        | The deck is generated and assembled  | 90      | one event                    |
| `save`            | Writing it to the library            | 95      | one event                    |
| —                 | Done                                 | 100     | the client, on `complete`    |

The ladder is monotone by construction: each phase starts where the previous
one ended.

## One writer

The three streams write their progress through one binder,
`createSseProgress(res, { lang, initialMessages })` in the same module (B758).
It writes the opening `messages` and `status` events when it is created and
returns the three hooks of `generateSlides()` (`onOutline`, `onStatusMessage`,
`onGroupDone`) plus `finalize(slideCount)` and `save()`. A route hands the
hooks to the generation and calls the two closers; it writes only its own
`complete` and `error`. The phase words above are therefore the whole
vocabulary, on every stream, and `tests/import-progress.test.js` § "the binder
has one source" keeps a route from writing a `status` of its own.

The copy follows the language: until the outline is in, the requested deck
language (`auto` reads the default deck language); from `onOutline` on, the
language the generation settled on (its second argument). The rotator's list
while a source is read is per source (`SOURCE_MESSAGES`: `pptx`, `pdf`,
`document`, `file`, `notion`); the wizard has none and shows the `outline`
line until the outline's own messages arrive.

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
began — for messages that described work that had not started. The closing
milestones (`finalize`, `save`) are not paced either: they used to sit 500ms
apart so each closing line was readable, which only delayed a deck that was
already generated (B758).

## Exports

The exports that render in Chrome stream over SSE too, on a ladder of their
own beside this one: `EXPORT_PROGRESS` in `server/export/progress.js`
(B716). An export is a loop over slides, so the measurable unit is a rendered
slide, and the builders report it (`onProgress({ done, total })`):

| Phase                         | Range  | Driven by                    |
| ----------------------------- | ------ | ---------------------------- |
| Accepted, first render starts | 3      | one event                    |
| Rendering slides              | 5 → 90 | one event per rendered slide |
| Packing the file (zip, pptx)  | 95     | the event for the last slide |
| Done                          | 100    | the client, after the file   |

The two rules hold here as well: the bar never walks back, and the PDF, one
Chrome document with nothing inside it that can report, creeps toward 90
instead of standing still. The handoff ZIP renders the deck more than once
(PowerPoint, PDF, PNG folder), so it counts steps against one total
(`unit: 'step'`) rather than restarting a slide counter per artifact.

The client words the counter ("Slide 12 of 54", "Step 40 of 109"); the server
sends numbers, not sentences. The route and its cancel are
[`export-menu.md`](./export-menu.md) § How a row gets its file.

## The event shapes

`status`:

```js
{ message, phase, progress?, creepTo?, creepMs? }
// phase: 'outline' | 'refine' | 'refine-progress' | 'finalize' | 'save'
```

The client binder (`createProgressBinding` in
`client/views/list/modals/new-presentation/handlers.js`) reads two of them by
name: `refine-progress` moves the bar only, `finalize` and `save` stop the
rotator and take over the message line.

`messages`:

```js
{ statusMessages, intervalMs?, loop? }
```

An export's `status`:

```js
{ phase: 'start'|'render'|'pack', progress, done?, total?, unit?, creepTo?, creepMs? }
```

and its `complete` is `{ downloadUrl }`.

Both are SSE import events, not the `/api/*` error envelope; an `error` event
carries `{ message }`, and the export streams add `error: '<code>'`
(`api-error-format.md` § SSE error events).
