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

- **membership** comes from the declarations, via `typesInGroup(group, order)`;
- **order** stays with the consumer, as a *hint*: `PICKER_GROUP_ORDER` in
  `client/views/editor/slide-type-picker/data.js` and `CATEGORY_ORDER` in
  `client/views/settings/tabs/slide-types-tab/categories.js`.

A member the hint does not name sorts after the ones it does. A name in a hint
that no longer declares that group is ignored. Both are harmless — which is the
whole point, because a stale *membership* table was not.

## The guardrail, and its ceiling

`tests/slide-type-groups.test.js`:

1. **Completeness** — every offerable core type declares a group.
2. **Vocabulary** — no type declares a group outside the six.
3. **Deprecated declares none.**
4. **Every shelf is used, and a type is on exactly one.**
5. **The consumers derive** — both surfaces resolve to the same membership, and
   each order hint only reorders: it can neither add a type nor drop one.
6. **The ceiling** — no module outside the declaration and its two consumers has
   a type vocabulary that is *exactly* one shelf.

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

- `shared/slide-types/authoring-groups.js` — the vocabulary and `typesInGroup()`.
- [`slide-type-structure.md`](./slide-type-structure.md) — the first facet, and
  why a facet beats a hierarchy.
- [`slide-type-runtime.md`](./slide-type-runtime.md) — the second facet, and the
  floor-to-ceiling move this page reuses.
- [`slide-type-directory.md`](./slide-type-directory.md) — what else a type's own
  directory owns.
