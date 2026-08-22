# The `runtime` facet, and what the session does for a slide

`structure` says what shape a slide type's content has. `runtime` says what the
**presenting session** has to do for it beyond serving it.

It is the second facet, and unlike the first it was not designed — it was
measured. Assertion 5 of the `structure` guardrail derived every module that
branches on three or more slide-type names, and found **nine** of them writing
out the same four names (`poll-slide`, `likert-slide`, `likert-slider-slide`,
`feedback-slide`) to answer one question:

> does this slide collect answers from the audience?

None of the nine wanted to know _which_ type it was. They all wanted a
capability the type did not declare, so each re-derived it — and they had
already drifted apart at the edges. The session storage covered three of the
four. The presenter's live set reached past them to `follow-invite-slide`. Every
one of the nine was a place a fifth interaction type would have been forgotten.

## The vocabulary

Defined in `shared/slide-types/runtime.js`; declared as `runtime: '…'` on each
type's definition; served out through `/api/slide-types`.

| `runtime` | Meaning                                                            | Types                                 |
| --------- | ------------------------------------------------------------------ | ------------------------------------- |
| `static`  | the session does nothing for it                                    | every other type                      |
| `timed`   | a presenter-driven clock; the state lives in the presenting window | countdown                             |
| `live`    | the audience answers, and the session collects and aggregates      | poll, likert, likert-slider, feedback |

The line is drawn at **session state**, not at "has behaviour", which is what
makes the edge cases fall out of the definition instead of being argued one at a
time:

- **`countdown-slide` is `timed`, not `live`.** A clock, no audience, no session
  state — the timer runs entirely in the presenting window
  (`client/lib/slide-runtime/countdown-runtime.js`).
- **`follow-invite-slide` is `static`.** The join code it renders is a render
  input the session hands over (`ctx.followCodes`), not state the session keeps
  for that slide.

`timed` has one member and, today, no consumer. It earns its place by keeping
`static` honest: fold the countdown in and `static` starts meaning two different
things, which is exactly the ambiguity the facet exists to remove.

### The near-miss axis

`runtime` is **not** "does this type mount a client runtime". That question has
one consumer (`client/lib/slide-runtime/slide-render.js`, whose two mounts are
follow-invite and countdown) and cuts the set differently — follow-invite is
`static` here and countdown is `timed`. One question, one facet.

## The sub-declaration a `live` type carries

`live` alone did not retire the hand-rolled lists. Five of the nine modules also
re-derived _which kind_ of answer the slide collects, mapping four type names
onto the three values the follow API already puts on the wire as
`interaction.type`. So a `live` type also declares its kind:

| `interaction` | What the audience sends               | Types                 |
| ------------- | ------------------------------------- | --------------------- |
| `poll`        | one choice out of a short option list | poll                  |
| `likert`      | a point on a scale                    | likert, likert-slider |
| `feedback`    | free text                             | feedback              |

It is not a second facet. It is the contract the `live` value implies, it is
meaningless on any other value, and the guardrail asserts both directions.

The pair covers every list the facet replaced: `isLiveSlideType()` is the guard
("may this slide be submitted to?") and `liveInteractionKind()` is the dispatch
("which widget, which aggregate, which payload shape?"). Both read through the
registry, so a fork that overrides a core type by name gets its own answer.

One name check survives on purpose: `likert-slider-slide`. The slider asks for a
point on the same scale a likert slide does — same protocol kind — but its ten
stops are fixed by the widget instead of authored as options. That is
type-specific behaviour, which is what the inventory threshold explicitly
blesses at one or two names.

## The guardrail

`structure` was the first facet because it is **derivable**: the field schema
already knows the shape of the content, so a declaration that lies is
detectable. `runtime` has no such oracle. Nothing in a type's fields says
whether the session aggregates answers for it — that is a fact about the server.

So `tests/slide-type-runtime.test.js` checks truthfulness from the other end:

1. **Completeness** — every core type declares a runtime from the vocabulary.
   Silence must not become a fourth answer.
2. **Coherence** — a `live` type declares an interaction kind and nothing else
   does; a `live` type is not `chrome`; and every `live` type carries a
   `question` field. That last one is the closest thing to derivation this facet
   has, and it holds in one direction only: a slide that asks the room something
   must have somewhere to put the question, but a `question` field does not make
   a type live.
3. **No second definition** — no module re-derives the live set by hand. This is
   the measurement that produced the facet, kept and inverted. Brief B's
   assertion 5 asserted a _floor_ (at least eight modules hard-code the quartet,
   so build the facet) and was written to fail the moment the count dropped;
   this is a _ceiling_ (no module hard-codes it, and none may start).

The ceiling skips per-type tables — a table has a row for each live type for the
same reason it has one for every type — and, for the sparse tables that have no
kind to lean on, it distinguishes by proportion: a module naming the live types
_and little else_ is answering "is this slide live?", while one that also names
twenty other types is a table that happens to have rows for them.

## What moved

Ten modules left the name-branching inventory when the facet landed: the nine
the measurement counted, plus the presenter's deck controller, which answered a
neighbouring question a tenth way.

| Module                                           | What it hard-coded                                                         | What it asks now                              |
| ------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------- |
| `client/views/editor/slides-panel.js`            | the four, to decide which insert needs a follow-invite slide               | `isLiveSlideType()`                           |
| `client/views/follow/interactions.js`            | the four, to decide whether to show a widget, plus feedback-vs-choice      | `isLiveSlideType()` + `liveInteractionKind()` |
| `client/views/presenter/interaction-controls.js` | the four, twice: the guard and the kind                                    | both helpers                                  |
| `server/utils/interaction-helpers.js`            | `isInteractiveSlideType()`, the closest thing to a home the capability had | deleted; callers use the facet                |
| `server/routes/api/follow/helpers.js`            | the four, computing the audience's capabilities                            | `liveInteractionKind()`                       |
| `server/routes/api/follow/interactions.js`       | the four, in three handlers                                                | `liveInteractionKind()`                       |
| `server/routes/api/live-sessions.js`             | the four, guarding open/close/reset and the feedback export                | `liveInteractionKind()`                       |
| `server/storage/live-sessions/control.js`        | three of the four (poll missing from the branch, harmlessly)               | `liveInteractionKind()`                       |
| `scripts/test-concurrent-votes.js`               | three, to find a votable slide to hammer                                   | `liveInteractionKind()`                       |
| `client/views/presenter/deck-controller.js`      | `follow-invite` + poll + feedback, to pass follow codes                    | `isLiveSlideType()` + follow-invite           |

Only the last one changed behaviour, and deliberately. It was passing
`ctx.followCodes` to the renderers that read them — follow-invite, poll and
feedback — which was correct precisely as long as those stayed the only live
renderers showing a join hint. It now passes them to every live slide. The two
likert renderers ignore the option, so nothing renders differently today; what
changes is that a fifth live type would get its codes instead of silently not.

## See also

- `shared/slide-types/runtime.js` — the vocabulary and the two helpers.
- `tests/slide-type-runtime.test.js` — the guardrail.
- [`slide-type-structure.md`](./slide-type-structure.md) — the first facet, the
  type-versus-variant rule, and why facets rather than a hierarchy.
- [`slide-type-companions.md`](./slide-type-companions.md) — the name-branching
  inventory this facet emptied ten entries out of.
