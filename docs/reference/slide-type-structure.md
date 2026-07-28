# The `structure` facet, and when something is a type

Deckyard has 38 core slide types. Until the `structure` facet there was no
statement anywhere about how any of them relate to any other: the registry is a
flat `name -> definition` map, so every type is a sibling of every other type.

The only grouping that existed lived in the presentation layer, was written out
by hand in two places (`slide-type-picker/data.js` and
`settings/tabs/slide-types-tab/categories.js`), and those two already disagreed.
Worse, they mixed four independent axes: `basic` is familiarity, `media` and
`data` are payload, `process` is rhetorical function, `interaction` is runtime
behaviour. So there was no place a new type *belonged*, no rule for when
something is its own type versus a variant of one, and no way to see that two
types do the same thing.

The cost was measurable: seven near-duplicates, one of which (`list-slide` and
`lijstje-slide`) was literally the same definition standing beside itself in the
picker for months, under two tiles both labelled "List".

## Facets, not a hierarchy

Not one tree. Every tree goes wrong the moment types differ along independent
axes — `funnel` and `timeline` are both ordered collections *and* different
rhetorical moves, and a single hierarchy has to pick one and lie about the
other. Instead: a small number of **orthogonal, declarative facets** on the type
definition, with the picker, the settings categories, the AI catalog and the
conversion map as *derivations* rather than sources.

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

| `structure` | Meaning | Examples |
|---|---|---|
| `singleton` | a fixed set of scalar slots | title, content, quote, image-text, video, comparison |
| `collection` | *n* items of one repeated shape, *n* is the author's choice | list, process, timeline, funnel, gallery, team-cards |
| `fixed-collection` | exactly *n* items; the count is part of the meaning | matrix (4 quadrants), poll, likert |
| `tabular` | rows × columns | table |
| `dataset` | data points plus an encoding | chart |
| `chrome` | no content fields at all | payoff, follow-invite |

These six partition the current 38 completely. There is no "other" bucket, which
is the best evidence available that the axis is the right one.

## The rule: type or variant?

> **A variant is a render choice that every valid instance of the content
> survives without loss. A type boundary is where content has to be added or
> thrown away.**

The operational test is a round-trip: flip the variant, flip it back. If a
content-bearing field is orphaned, it was never a variant.

Worked on the case the question came from — `image-text-slide`, which offers 9
layout tiles over ~180 renderable combinations (`layout` × `imageSide` ×
`imageWidth` × `textColumns` × `imageFit` × `imageBackground`):

| Tile | Fields | Verdict |
|---|---|---|
| `split` / `corner` / `row-top` / `row-bottom` | `image`, `title`, `body` | real variants ✅ |
| "Text without image" | `image` left empty | not a variant but the *absence* of the payload; the result is a `content-slide` under a different type id ⚠️ |
| `duo` / "own text per column" | reads `images[0-3]` | flipping back to `split` orphans images 2 and 3 → **boundary crossed** ⚠️ |

The combinatorial explosion is therefore not the problem — that is exactly what a
variant axis is for. The problem is that two of the nine tiles are a *different
contract* under the same id.

## The guardrail

`tests/slide-type-structure.test.js` runs two assertions:

1. **Completeness** — every registered type declares a `structure` from the
   vocabulary.
2. **Truthfulness** — the declaration matches the schema. `singleton` carries no
   `items[]` field; `collection` carries exactly one; `fixed-collection` carries
   one whose `minItems === maxItems`; `chrome` carries no content field at all.
   `dataset`'s payload is an encoded blob, so there is nothing derivable to
   check and the test says so rather than pretending.

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

| Type | What the schema says | Why it is not a relabelling |
|---|---|---|
| `image-text-slide` | declared `singleton`, carries `images[0-3]` | the `duo` tile is a second contract; the cut (image-text strictly one image, plural cases to the image collection) is a product decision |
| `quote-slide` | declared `singleton`, carries `quotes[0-2]` beside scalar `quote`/`authorName` | one type, two representations — the legacy-mirror disease; fix by retiring one side |
| `content-columns-slide` | declared `collection`, has no `items[]` at all (130 numbered `col{N}*` scalars) | deprecated with `text-blocks-slide` as successor, so the entry dies with rung 3 |
| `poll-slide` | declared `fixed-collection`, carries `option1..option4` as scalars | never got the `items[]` migration the other collections did |
| `likert-slide` | same, `option1..option10` | as poll-slide |

## What is not here yet

- **Three more assertions.** No two active types sharing a field signature (the
  test that would have caught `lijstje-slide` on day one); every value of a
  `layoutVariants` enum carrying the same content-bearing fields (which
  codifies the rule above); and the companion matrix having no hole. Each finds
  real violations and needs its own burndown.
- **Derivation.** `PICKER_GROUPS` and the settings `CATEGORIES` are still two
  hand-written tables that disagree. They become derivations once the consumers
  read from the registry — that is slide-type-seam work, not facet work.
- **The other facets.** `intent` (frame / enumerate / sequence / compare /
  quantify / ask), `runtime` (static / live / timed) and `payload` are all real,
  and all still without a consumer. Built when there is one.

## See also

- `shared/slide-types/structure.js` — the vocabulary.
- `tests/slide-type-structure.test.js` — the guardrail and the burndown.
- [`slide-type-removal.md`](./slide-type-removal.md) — the deprecation ladder,
  including the alias-versus-deprecation distinction.
- [`slide-type-companions.md`](./slide-type-companions.md) — the per-type
  hand-maintained entries and what gates them.
