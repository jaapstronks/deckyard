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
2. **Accept any well-formed type id.** `slides[].type` is the canonical
   reverse-DNS id (`eu.deckyard.slide.title`) or one of its equivalent
   spellings — `name`, `namespace/name`, either with `@version`. The published
   JSON Schema constrains it by that shape and not by a list of names, precisely
   so a fork type, an org type or a third-party type stays valid. All spellings
   of one id name one type: see [type ids](#type-ids-one-identity-three-spellings).
3. **Honour the item contract** for the slide type's declared `structure`
   (below). `structure` travels on `GET /api/slide-types` and is part of the
   published type description.
4. **Render an unknown type from its structure plus its text**, per the
   [unknown-type contract](#the-unknown-type-contract). A type you have never
   seen still has a structure and still has string-valued content; render those
   and show the type name rather than dropping the slide.

### Type ids: one identity, three spellings

The canonical id is **reverse-DNS**: `eu.deckyard.slide.title`. Whoever owns the
domain may define the type, which makes collisions structurally impossible
instead of socially managed — `acme/hero` and `nl.ciiic.slide.hero` are both
plain strings until a second fork exists, and after that only the first is a
problem. The `-slide` suffix is gone from the canonical name because `slide` is
already in the authority.

Two older spellings stay valid **forever**, and a reader MUST accept all three:

| Spelling | Example | Where it appears |
|---|---|---|
| Canonical reverse-DNS | `eu.deckyard.slide.title` | the `slideTypes` manifest, `GET /api/slide-types`, anything newly published |
| Qualified | `core/title-slide` | decks written against the earlier identity model |
| Bare key | `title-slide` | `slides[].type` in every deck, past and present |

**Storage did not move.** `slides[].type` still holds the bare key, so the
rename cost no deck a rewrite and a reader that only ever sees bare keys is not
behind. A reader MUST treat the three as one identity: the published JSON
Schema applies the same content contract to each spelling, and comparing ids
means comparing identities, not strings (`shared/slide-types/type-id.js`,
`sameType()`).

The `@version` suffix is a **compatibility hint about a definition, not a
different type**. A reader that does not have the named version renders the
version it has; it MUST NOT treat `title-slide@2` as an unknown type.

### The unknown-type contract

This is what "nothing is dropped" means when a reader meets a `type` it has no
declaration for at all — a fork type, an org type, a type published after the
reader shipped. It is the floor under level 1, and it is normative.

A reader that does not recognise `slides[].type`:

1. **MUST render the slide.** Dropping it silently changes the slide count, the
   numbering and the argument the deck is making. A reader MUST NOT reject the
   deck either: one unknown type is not a malformed deck.
2. **MUST render every string-valued entry of `content` as text**, in the order
   the keys appear in `content` — a producer writes them in the type's declared
   field order, so that order is the author's. A reader whose parser does not
   preserve member order MUST pick a stable order (lexicographic will do) rather
   than an arbitrary one. Non-string scalars render as their text form; the
   empty string means *unset* and MAY be skipped.
3. **MUST render each element of an array-valued entry as a repeated item**, in
   array order, applying rule 2 within each element. This is the `collection`
   contract, which is the honest reading of an array whose meaning is unknown:
   it may be reflowed, it may not be reordered or truncated.
4. **MUST show the type reference**, as written in `type`, on or beside the
   slide. A viewer has to be able to tell a generic rendering from an authored
   one — silently pretty output is how "we support Deckyard" becomes untrue
   without anyone noticing.
5. **MUST honour the global slide keys it already knows** — `notes`,
   `duration`, `visibility`, and the `a11y*` / `slideBg*` / `slideLogo` content
   keys. Those are envelope-level and their meaning does not depend on the type.
6. **SHOULD render it in the deck's theme**, so an unknown type reads as a plain
   slide rather than as breakage.
7. **MUST NOT invent content.** No synthesized headings, no filled-in blanks, no
   reordering. Rendering less faithfully than the author wrote is a degradation;
   rendering something the author did not write is a bug.

A value that is neither a scalar nor an array or object of scalars (a nested
payload a reader cannot interpret) MAY be omitted — rule 7 outranks
completeness, and a reader must not guess at a shape it does not know.

**This contract is the last resort, not the first.** Three cases, in order:

| The reader has | It does |
|---|---|
| the type, implemented | renders it natively |
| the type's declaration but no implementation | uses `structure` + the item contract, or the declared `fallback` (level 2) |
| nothing but the slide | the unknown-type contract above |

A reader that reaches case 3 for a *Deckyard* type is a reader that has not read
`GET /api/slide-types` or the deck's `slideTypes` manifest; both carry the
declaration. Case 3 is for types that are genuinely nobody's business but their
declarant's — which is exactly the case a format has to survive to be open.

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
  exercises both levels (including the `fallback` expectations per type and the
  unknown-type contract) is open work.
- **The normative text on `/spec/`.** This page is the reference; publishing the
  claim in both languages on `deckyard.eu` lands together with the tiers and the
  evolution rule, as one hand-off rather than three rewrites of the same page.

## See also

- [`deck-format.md`](./deck-format.md) — the envelope, the identity manifest,
  the round-trip guarantee, and the [evolution
  rule](./deck-format.md#evolution-rule) this page's leniency requirements are
  the reader half of.
- [`slide-type-structure.md`](./slide-type-structure.md) — where `structure`
  came from, and the type-versus-variant rule it answers.
- [`slide-type-tiers.md`](./slide-type-tiers.md) — the three tiers and the
  `fallback` facet.
- `shared/slide-types/structure.js` — the vocabulary and the item contract.
- `shared/slide-types/json-schema.js` — the generated, open deck schema.
