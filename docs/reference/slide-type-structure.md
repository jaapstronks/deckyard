# The `structure` facet, and when something is a type

Deckyard has <!--gen:slide-type-count-->33<!--/gen:slide-type-count--> core slide types. Until the `structure` facet there was no
statement anywhere about how any of them relate to any other: the registry is a
flat `name -> definition` map, so every type is a sibling of every other type.

The only grouping that existed lived in the presentation layer, was written out
by hand in two places (`slide-type-picker/data.js` and
`settings/tabs/slide-types-tab/categories.js`), and those two already disagreed.
Worse, they mixed four independent axes: `basic` is familiarity, `media` and
`data` are payload, `process` is rhetorical function, `interaction` is runtime
behaviour. So there was no place a new type _belonged_, no rule for when
something is its own type versus a variant of one, and no way to see that two
types do the same thing.

The cost was measurable: seven near-duplicates, one of which (the List type,
briefly registered under both `list-slide` and a Dutch alias) was literally the
same definition standing beside itself in the picker for months, under two tiles
both labelled "List".

## Facets, not a hierarchy

Not one tree. Every tree goes wrong the moment types differ along independent
axes — `funnel` and `timeline` are both ordered collections _and_ different
rhetorical moves, and a single hierarchy has to pick one and lie about the
other. Instead: a small number of **orthogonal, declarative facets** on the type
definition, with the picker, the settings categories, the AI catalog and the
conversion map as _derivations_ rather than sources.

There is deliberately **no inheritance**. No `extends` in the spec: composition
already works (`withGlobalSlideFields()`, field groups), and inheritance across
implementation boundaries gives version skew and diamond problems — a second
implementor would have to reproduce our resolution order exactly.

`structure` is the first facet and deliberately so: it describes the shape of the
content, which is **derivable from the field schema**, so a declaration that
lies is detectable. (`intent` — the editorial promise the slide makes to a
viewer — is a judgement call, so no guardrail is possible. It comes later.) It is
also the facet that catches the duplicates.

## The vocabulary

Defined in `shared/slide-types/structure.js`; declared as `structure: '…'` on
each type's definition; served out through `/api/slide-types`.

| `structure`        | Meaning                                                     | Examples                                             |
| ------------------ | ----------------------------------------------------------- | ---------------------------------------------------- |
| `singleton`        | a fixed set of scalar slots                                 | title, content, quote, image-text, video, comparison |
| `collection`       | _n_ items of one repeated shape, _n_ is the author's choice | list, process, timeline, funnel, gallery, team-cards |
| `fixed-collection` | exactly _n_ items; the count is part of the meaning         | matrix (4 quadrants), poll, likert                   |
| `tabular`          | rows × columns                                              | table                                                |
| `dataset`          | data points plus an encoding                                | chart                                                |
| `chrome`           | no content fields at all                                    | payoff, follow-invite                                |

These six partition the current <!--gen:slide-type-count-->33<!--/gen:slide-type-count--> completely. There is no "other" bucket, which
is the best evidence available that the axis is the right one.

## The item contract (normative)

`structure` began as an internal design tool. It is now also the normative half
of the format's conformance claim, and that asks more of it than naming six
buckets: it has to say **what a reader may rely on** for each one.

`SLIDE_STRUCTURE_CONTRACTS` in `shared/slide-types/structure.js` is that
statement, and it is why conformance is two-level rather than 36-or-nothing —
see [`deck-conformance.md`](./deck-conformance.md), which holds the full table
and the reader rules.

| `structure`        | The content carries                             | The count means            |
| ------------------ | ----------------------------------------------- | -------------------------- |
| `singleton`        | no repeated-item array                          | nothing to count           |
| `collection`       | exactly one item array                          | the author's choice        |
| `fixed-collection` | exactly one item array, `minItems === maxItems` | part of the type's meaning |
| `tabular`          | exactly one item array (the rows)               | the author's choice        |
| `dataset`          | an encoded payload plus its encoding            | inside the payload         |
| `chrome`           | no content fields at all                        | nothing to count           |

The reason this is worth writing down at all: **it is the only part of the
format that does not scale with the number of types.** A reader that implements
nine type contracts knows nine things and is stale the day a tenth is published;
a reader that implements six structure contracts can render a type that did not
exist when it shipped.

The contract is declared beside the vocabulary rather than only asserted in the
test, and assertion 2 below _derives_ from it. A promise and its enforcement
keeping separate copies of the same rule is the drift this facet exists to
prevent.

## The rule: type or variant?

> **A variant is a render choice that every valid instance of the content
> survives without loss. A type boundary is where content has to be added or
> thrown away.**

The operational test is a round-trip: flip the variant, flip it back. If a
content-bearing field is orphaned, it was never a variant.

Worked on the case the question came from — `image-text-slide`, which offers 9
layout tiles over ~180 renderable combinations (`layout` × `imageSide` ×
`imageWidth` × `textColumns` × `imageFit` × `imageBackground`):

| Tile                                          | Fields                   | Verdict                                                                                                      |
| --------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `split` / `corner` / `row-top` / `row-bottom` | `image`, `title`, `body` | real variants ✅                                                                                             |
| "Text without image"                          | `image` left empty       | not a variant but the _absence_ of the payload; the result is a `content-slide` under a different type id ⚠️ |
| `duo` / "own text per column"                 | reads `images[0-3]`      | flipping back to `split` orphans images 2 and 3 → **boundary crossed** ⚠️                                    |

The combinatorial explosion is therefore not the problem — that is exactly what a
variant axis is for. The problem is that two of the nine tiles are a _different
contract_ under the same id.

## The guardrail

`tests/slide-type-structure.test.js` runs four assertions:

1. **Completeness** — every registered type declares a `structure` from the
   vocabulary.
2. **Truthfulness** — the declaration matches the schema, checked against the
   item contract above via `structureContractViolation()`: `singleton` carries no
   `items[]` field; `collection` carries exactly one; `fixed-collection` carries
   one whose `minItems === maxItems`; `chrome` carries no content field at all.
   `dataset`'s payload is an encoded blob, so there is nothing derivable to
   check and the contract says so with a `null` rather than pretending.
3. **No duplicates** — no two types offer the same **field signature** (every
   content field as `key:type`, sorted, with repeated-item fields carrying their
   item shape). This is the assertion that would have caught the List type's
   duplicate registration on day one. The signature is deliberately coarse: it ignores enum options and
   length limits, so it collides easily, and "they really are different, here is
   why" is an answer the burndown can carry. `chrome` types are skipped — they
   have the empty signature by construction, so colliding there says nothing.
4. **Variants are lossless** — every same-type `layoutVariants` tile of a type
   renders the same content. The rule at the top of this page, made operational:
   populate the type completely with sentinel values, flip to each tile, render,
   and see which values still reach the output. A value that survives one tile
   and not another is content the author loses by switching, which makes it a
   type boundary. Tiles with `convertTo` are cross-type exits through the convert
   seam — a boundary already modelled correctly — and are out of scope.

Assertions 3 and 4 are gates first: they each carry exactly one violation today
and their value is what they stop from being added tomorrow. Assertion 4 checks
ten types with variant sets and clears nine of them.

`actions[]` is excluded from "content". `content-slide` and `image-text-slide`
both carry an `actions[0-3]` array beside their scalar slots, and by field type
that would make them collections — but a call-to-action affordance is not a
content shape. It belongs with the global fields `withGlobalSlideFields()`
injects; moving it there is open work, and until then the exclusion is written
down in the test rather than silently distorting the facet.

### What the facet found

Five types whose declaration contradicts their schema. They sit in an explicit
`BURNDOWN` map in the test — the gate is on from day one for everything new, and
the existing violations are a shrinking list rather than a reason to weaken the
rule (the pattern `eslint-suppressions.json` established). Recording them is the
point: this is what the facet was built to make visible.

| Type               | What the schema says                                                           | Why it is not a relabelling                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `image-text-slide` | declared `singleton`, carries `images[0-3]`                                    | the `duo` tile is a second contract; the cut (image-text strictly one image, plural cases to the image collection) is a product decision |
| `quote-slide`      | declared `singleton`, carries `quotes[0-2]` beside scalar `quote`/`authorName` | one type, two representations — the legacy-mirror disease; fix by retiring one side                                                      |
| `poll-slide`       | declared `fixed-collection`, carries `option1..option4` as scalars             | never got the `items[]` migration the other collections did                                                                              |
| `likert-slide`     | same, `option1..option10`                                                      | as poll-slide                                                                                                                            |

Assertion 3's `SIGNATURE_BURNDOWN` is now empty: its one pair was the List type
registered under both `list-slide` and a Dutch alias, and rung 3 of the list
consolidation removed the alias, so no two core types share a field signature.

Assertion 4 adds one type, in `VARIANT_BURNDOWN`:

| Type               | Why                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image-text-slide` | the tiles disagree about how many images they render — `split`/`corner` one cell, `duo` two, the rows up to three — so flipping `duo` → `split` orphans image 2. The same finding as the structure burndown, reached from the render side instead of the schema side |

That the two assertions converge on `image-text-slide` from opposite directions
is the useful part: the schema says it declares `singleton` while carrying
`images[0-3]`, and the renderer says its tiles are not interchangeable. One
boundary, two witnesses.

## The fifth assertion

**The companion matrix has no hole.** It lives in
`tests/slide-type-name-branching.test.js` rather than beside the four above,
because it guards the codebase around the types rather than the types
themselves, and it is the only one of the five that comes from a real regression
(PR #451) rather than from design. Every tracked module that branches on three
or more type names must be accounted for, with a kind and a reason; 46 modules
qualify. Full account in
[`slide-type-companions.md`](./slide-type-companions.md#the-name-branching-inventory--no-hole-in-the-matrix).

Its most useful finding was an argument for the next facet: **nine modules
re-derived the live-interaction quartet by hand**, all asking one question the
types could not answer — does this slide collect answers from the audience?
That is `runtime`, and it now exists: see
[`slide-type-runtime.md`](./slide-type-runtime.md). Ten modules left the
inventory when it landed, and the floor assertion that measured them was
replaced by a ceiling that forbids the pattern.

## What is not here yet

- ~~**Derivation.**~~ Done. The picker shelves and the settings curation
  headings were two hand-written tables that disagreed about five types; both
  are now derived from a `group` declared on the type. It is deliberately _not_
  derived from `structure` — that was measured and it dismembers `media` and
  drops `chart` and `table` out of view. See
  [`slide-type-groups.md`](./slide-type-groups.md).
- **The other facets.** `intent` (frame / enumerate / sequence / compare /
  quantify / ask) and `payload` are real and still without a consumer; built
  when there is one. `runtime` (static / live / timed) shipped as the second
  facet — nine modules were hand-rolling it — and has its own page.

## See also

- `shared/slide-types/structure.js` — the vocabulary and the item contract.
- [`deck-conformance.md`](./deck-conformance.md) — the two conformance levels
  this facet's contract makes possible.
- [`slide-type-tiers.md`](./slide-type-tiers.md) — the tier ladder and the
  `fallback` facet, the other half of the conformance claim.
- `tests/slide-type-structure.test.js` — the guardrail and the burndown.
- [`slide-type-runtime.md`](./slide-type-runtime.md) — the second facet: what
  the presenting session has to do for a type.
- [`slide-type-removal.md`](./slide-type-removal.md) — the deprecation ladder,
  including the alias-versus-deprecation distinction.
- [`slide-type-companions.md`](./slide-type-companions.md) — the per-type
  hand-maintained entries and what gates them.
