# The `group` axis — which shelf a type is offered on

Two surfaces offer slide types to a person rather than render them: the editor's
insert picker, and the settings tab where an org curates which types its authors
may reach for. Both group the types, and until this axis landed both did it from
their own hand-written table.

Those two tables disagreed. Of the 33 offerable types they agreed on 28:

| Type | Picker said | Settings said |
|---|---|---|
| `process-slide` | `layouts` | `process`, a heading of its own |
| `timeline-slide` | `layouts` | `process` |
| `payoff-slide` | *absent* → computed "Other" | `other`, spelled out |
| `end-slide` | *absent* → computed "Other" | `other`, spelled out |
| `custom-html-slide` | *absent* → computed "Other" | `other`, spelled out |

The disagreement is not the interesting part; the reason it survived is. Both
surfaces fold a type they have never heard of into an "Other" bucket without
complaining, so a type could be missing from a table, or in the wrong one, and
nothing anywhere would say so. That is the same failure mode that let
`lijstje-slide` stand beside `list-slide` in the picker for months under two
tiles both labelled "List".

## The declaration

Each type declares one key in its own `authoring.js`:

```js
// shared/slide-types/types/timeline-slide/authoring.js
export default {
  group: 'layouts',
  …
};
```

The vocabulary is six shelves, defined in `shared/slide-types/authoring-groups.js`:

| `group` | What it means | Members |
|---|---|---|
| `basic` | the handful most decks are actually built from — familiarity, not shape | 5 |
| `media` | carries an image, video or embedded page | 7 |
| `layouts` | a structured arrangement of blocks, cards or steps | 4 |
| `data` | argues with figures, comparisons or diagrams | 8 |
| `interaction` | the audience answers, or the slide runs on a clock | 6 |
| `other` | the long tail: closing slides and the escape hatch | 3 |

A deprecated type declares none: curation is about what an author may *insert*,
and a deprecated type is already unreachable from every insertion path.

`other` is in the vocabulary rather than being "everything undeclared", because
for the settings tab it is a real heading with real members. The picker still
computes its "Other" at render time from everything uncurated, so a type
declaring `other` lands there without the picker naming a shelf for it.

## Why this is not derived from `structure`

The tempting move is to delete the axis and group by the `structure` facet,
which is already declared, derivable from the field schema, and CI-enforced.
That was measured, and it does not work.

`structure` answers *what shape is the content*. Someone opening the insert
picker is asking *what am I putting on this slide*. Deriving one from the other
gives:

- **`media` disappears.** `image-slide`, `image-text-slide`, `video-slide` and
  `embed-slide` are `singleton`; `gallery-slide`, `logo-wall-slide` and
  `team-cards-slide` are `collection`. Nothing reconstructs the shelf — the
  facet that would is `payload`, which is deliberately unbuilt for want of a
  consumer.
- **`data` scatters** across five buckets.
- **`chart-slide` and `table-slide` fall out of view.** They are the only
  `dataset` and the only `tabular` type, and the picker folds a single-tile
  group into "Other" (a section heading over one card wastes a row).
- **Two walls of twelve tiles** are left where the curated shelves were.

So the grouping stays its own declarative axis, orthogonal to `structure` and
`runtime`. Full measurement in the typology umbrella brief.

## Membership here, order in the consumer

A consumer's array encodes order as well as membership, and order is a curation
decision about that surface — the picker puts the most-reached-for tiles first,
which is not a fact about any one type. So:

- **membership** comes from the declarations, via
  `typesInGroup(group, order, types)`;
- **order** stays with the consumer, as a *hint*: `PICKER_GROUP_ORDER` in
  `client/views/editor/slide-type-picker/data.js` and `CATEGORY_ORDER` in
  `client/views/settings/tabs/slide-types-tab/categories.js`.

A member the hint does not name sorts after the ones it does. A name in a hint
that no longer declares that group is ignored. Both are harmless — which is the
whole point, because a stale *membership* table was not.

## Anyone may declare a shelf

`SLIDE_TYPE_AUTHORING` is generated over `shared/slide-types/types/`, so it holds
core and only core. The first version of this axis read it directly, which meant
a type in `custom/slide-types/` could declare `group: 'media'` and be dropped
without a word — not "forks are excluded" (they are offered, on a hardcoded
*Custom* shelf), but the narrower and worse **a fork cannot choose its shelf**.
Under the model Deckyard is aiming at, a fork is a peer implementation rather
than a patch on ours, so "core declares, everyone else gets a fixed shelf" is the
wrong asymmetry.

The lookup therefore asks the definition first and treats the aggregator as
core's answer to the same question:

```js
slideTypeGroup(type, def)   // def.group, else core's declaration, else ''
typesInGroup(group, order, types)   // enumerates the live map, not the artifact
```

Three consequences worth stating outright:

- **A declared group wins over the Custom shelf.** A fork type that declares
  `media` is offered beside the other media types, because someone inserting a
  slide is asking what goes on it, not who wrote the type. *Custom* is then the
  shelf for a type that declares nothing — which is also how an org keeps its own
  types together, if that is what it wants: by declaring nothing.
- **The declaration travels.** The editor holds the `/api/slide-types` response,
  not the registry, so the route serves `group` (along with `schematic` and
  `sampleContent`, which had the same gap). A companion the browser needs and the
  wire drops is a fallback branch that can never fire.
- **Unknown degrades.** A value outside the vocabulary falls back to core's
  answer, or to no shelf — never to a made-up heading.

Tier-2 (builder-UI) types have no `group` column yet, so they declare nothing and
land on *Custom*. That is the fallback doing its job, not a rule about where
database-backed types belong.

The general form of this — it applies to every companion derived from a generated
aggregator — is written out as the five-rule seam rule in
[`slide-type-directory.md`](./slide-type-directory.md).

## The guardrail, and its ceiling

`tests/slide-type-groups.test.js`:

1. **Completeness** — every offerable core type declares a group.
2. **Vocabulary** — no type declares a group outside the six.
3. **Deprecated declares none.**
4. **Every shelf is used, and a live map partitions** — resolution runs per type,
   so nothing lands on two shelves. (Over core alone this is vacuous:
   `SLIDE_TYPE_GROUP` maps a name to one string. It has content over a live map,
   which is what the consumers enumerate.)
5. **The consumers derive** — both surfaces resolve to the same membership, and
   each order hint only reorders: it can neither add a type nor drop one.
6. **The ceiling** — no module outside the declaration and its two consumers has
   a type vocabulary that is *exactly* one shelf.
7. **The seam** — the definition beats the aggregator, a non-core declarant gets
   its shelf, and an unknown value degrades. Plus, in
   `tests/slide-type-api-companions.test.js`, that the route serves what the
   facet modules resolve.

**There is no truthfulness assertion, and there cannot be one.** `structure` is
checkable against the field schema and `runtime` against the modules that
consume it. Nothing can prove that `comparison-slide` belongs under `data`
rather than `layouts` — this axis is a judgement call, the same limit `intent`
will have. Saying so here is deliberate: a guardrail that looks stronger than it
is, is worse than a weak one that is labelled.

The ceiling (6) is likewise narrower than it sounds, and its rule is written out
in the test rather than implied. It fires only when a module's whole type
vocabulary is one shelf. Looser rules were tried and are unusable: an exhaustive
per-type table like `INSPECTOR_KEEPS` contains every shelf by construction, and
`basic` is five common types that any module touching titles and body copy
collides with. A gate that cries wolf gets suppressed, and a suppressed gate
guards nothing.

## See also

- `shared/slide-types/authoring-groups.js` — the vocabulary, `slideTypeGroup()`
  and `typesInGroup()`.
- `shared/slide-types/authoring-companions.js` — the same seam for the picker's
  glyph and its sample content.
- [`slide-type-structure.md`](./slide-type-structure.md) — the first facet, and
  why a facet beats a hierarchy.
- [`slide-type-runtime.md`](./slide-type-runtime.md) — the second facet, and the
  floor-to-ceiling move this page reuses.
- [`slide-type-directory.md`](./slide-type-directory.md) — what else a type's own
  directory owns.
