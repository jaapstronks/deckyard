# Conformance: what a second implementation actually owes

Deckyard publishes its deck format, and a published format has to be able to
answer one question: **what does an implementation have to do to say it reads
Deckyard decks?**

Until this page, the only available answer was "all of it" — <!--gen:slide-type-count-->36<!--/gen:slide-type-count--> slide types,
each with its own field contract. That is not a threshold anyone clears, so in
practice it meant every implementation was incomplete and none could say what it
did support. A format whose only conformance claim is unreachable has no
conformance claim.

The answer here is **two levels**, and the point of the split is that the first
one does not scale with the number of types.

| Level | You implement | You may claim |
|---|---|---|
| **1 — Structure** | the envelope, the six `structure` contracts, and the unknown-type behaviour | *reads Deckyard decks* — every deck renders, nothing is dropped |
| **2 — Core profile** | level 1, plus the nine tier-1 types' own field contracts, plus `fallback` | *renders the Deckyard core profile* — every deck renders the way it was authored, up to declared degradation |

Neither level requires all <!--gen:slide-type-count-->36<!--/gen:slide-type-count--> types. Tier 2 is not a conformance surface: we
ship those types and version them with the app
([`slide-type-tiers.md`](./slide-type-tiers.md)), and a reader meets them
through the level-1 structure contract or their declared `fallback`.

## Level 1 — structure conformance

The whole of level 1 is: read the envelope, and for each slide, look at the
slide type's `structure` rather than its name.

This is the interop currency, because **it is the only part of the format that
does not grow when the type set does.** A reader that learns nine type contracts
knows nine things and is stale the day a tenth is published. A reader that
learns six structure contracts can render a type that did not exist when it
shipped.

To reach level 1:

1. **Parse the envelope.** `format`, `version`, `title`, `theme`, `slideTypes`,
   `slides` — see [`deck-format.md`](./deck-format.md). Unknown top-level keys
   are ignored, never rejected.
2. **Accept any well-formed type id.** `slides[].type` is `name`,
   `namespace/name` or `namespace/name@version`. The published JSON Schema
   constrains it by that shape and not by a list of names, precisely so a fork
   type, an org type or a third-party type stays valid.
3. **Honour the item contract** for the slide type's declared `structure`
   (below). `structure` travels on `GET /api/slide-types` and is part of the
   published type description.
4. **Render an unknown type from its structure plus its text.** A type you have
   never seen still has a structure and still has string-valued content; render
   those and show the type name rather than dropping the slide.

Step 4's exact normative wording is A8.3 work and is not final on this page yet;
the behaviour it describes is what steps 1 to 3 already imply.

### The item contract

Declared in `shared/slide-types/structure.js` (`SLIDE_STRUCTURE_CONTRACTS`) and
enforced against every built-in type by `tests/slide-type-structure.test.js`, so
the table below is a statement the code has to keep true rather than a
description of it.

| `structure` | The content carries | The count means | A reader that knows only this |
|---|---|---|---|
| `singleton` | no repeated-item array | nothing to count | render the named scalar slots in declaration order |
| `collection` | exactly one item array | the author's choice | iterate; you may reflow, paginate or split across slides |
| `fixed-collection` | exactly one item array, `minItems === maxItems` | part of the type's meaning | iterate, but never drop or pad items to fit a layout |
| `tabular` | exactly one item array (the rows) | the author's choice | items are rows, item keys are columns, the column set is shared |
| `dataset` | an encoded payload plus its encoding | inside the payload | decode to rows and fall back to `tabular`; only the visual encoding is lost |
| `chrome` | no content fields at all | nothing to count | render the beat it occupies, or omit the slide — either is lossless |

Two consequences worth stating outright:

- **`collection` and `fixed-collection` differ only in whether the count is
  meaning.** That is exactly why they are separate: a reader may reflow a list
  of six into two columns, and may not turn a four-quadrant matrix into three.
- **`dataset` is the one structure whose payload the registry cannot check.**
  The contract says so with a `null` rather than pretending, and it names the
  degradation (decode, then treat as tabular) instead of leaving the reader to
  invent one.

## Level 2 — core-profile conformance

Level 2 adds the nine tier-1 types and their field contracts:

`title-slide`, `chapter-title-slide`, `content-slide`, `list-slide`,
`quote-slide`, `image-slide`, `image-text-slide`, `table-slide`, `end-slide`.

Their per-type content schemas are published at
`https://deckyard.eu/schema/v<N>/slide-types/<type>.schema.json` and generated
from the same field registry the editor uses — there is no hand-synced copy.

Level 2 also means **honouring `fallback`**. Every tier-2 type declares which
tier-1 contract holds its content without losing any: a funnel falls back to
`list-slide`, a gallery to `image-slide`, a chart to `table-slide`. A level-2
reader meeting `funnel-slide` renders it as a list rather than as generic
structure-plus-text, which is strictly more faithful than level 1 for the same
deck. The full mapping is generated into
[`slide-type-inventory.md`](./slide-type-inventory.md).

The nine were chosen on a criterion, not on taste: the minimal set that
expresses an ordinary presentation without loss. `chart-slide` is deliberately
outside it because it demands a charting runtime, and the success criterion for
a second implementation is a weekend of work. Full argument in
[`slide-type-tiers.md`](./slide-type-tiers.md).

## What this does not yet include

- **A conformance kit.** These are the levels, not a test suite that certifies
  someone against them. Today the closest thing is
  `tests/fixtures/example-deck.json` plus `tests/deck-format-spec.test.js` — the
  fixture a second implementation can round-trip. Turning that into a kit that
  exercises both levels (including the `fallback` expectations per type) is open
  work.
- **The normative text on `/spec/`.** This page is the reference; publishing the
  claim in both languages on `deckyard.eu` lands together with the tiers and the
  evolution rule, as one hand-off rather than three rewrites of the same page.

## See also

- [`deck-format.md`](./deck-format.md) — the envelope, the identity manifest,
  the round-trip guarantee.
- [`slide-type-structure.md`](./slide-type-structure.md) — where `structure`
  came from, and the type-versus-variant rule it answers.
- [`slide-type-tiers.md`](./slide-type-tiers.md) — the three tiers and the
  `fallback` facet.
- `shared/slide-types/structure.js` — the vocabulary and the item contract.
- `shared/slide-types/json-schema.js` — the generated, open deck schema.
