# Text alignment: who decides, and why

How a piece of text on a slide gets its horizontal alignment. Two declarations
answer that, and one resolver composes them.

This is a reference page: it describes what is, not what will change.

## The distinction the model rests on

"Alignment" is two effects wearing one name:

1. the `text-align` **inside** a box, and
2. the placement of **that box** within its container.

The first is a property of the field. The second is only well defined for a
whole visual block. A title, subtitle and meta line are one block; letting each
pick its own box placement is not freedom, it is a way to knock the slide out of
true.

That was not a theoretical worry. On the title slide at a 1600px render the
title box sat 184px left of the slide centre and the subtitle box 344px, both
because a reading-measure cap (`max-width`) also anchored the box to the start.
Setting **all three fields to `center`** still left them centred on axes 160px
apart.

A measure cap is a typographic device for line length. It must never move a
box's centre off its container's alignment axis. Where a cap exists, it is
paired with a `margin-inline` that follows the effective alignment.

## The two declarations

### `role` — what kind of text is this?

`shared/slide-types/text-roles.js`. Intrinsic to the text, reusable across
types, a closed vocabulary of six (`heading`, `prose`, `list-item`, `quote`,
`caption`, `label`). It answers which style options are *meaningful*: a list
item sits next to a bullet marker, so block alignment would detach the text from
its marker — `list-item` therefore offers no alignment at all.

A field declares `role` only when it differs from the safe default.

### `defaultAlign` — what is it aligned at right now?

`shared/slide-types/text-roles.js`. Almost always `left`, and then nobody
declares it. It is a declaration because a handful of types centre in their own
slide CSS: `end-slide` centres its whole `.slide-inner`, `funnel-slide` centres
a stage's description, `pyramid-slide` centres a level's label and text,
`text-blocks-slide` centres a row heading, `lead-capture-slide` centres its
header.

Without the declaration the panel had no way to see any of that. It reported
"Left" over visibly centred text, and clicking "Left" changed nothing — `left`
was treated as "no override", so it stored nothing and emitted no class, and
the type's own slide rule kept winning unopposed.

A type declares it at type level when the whole slide centres, or on a single
`fields[]` entry when only that field does; field beats type. A value outside
the field's role-allowed set is ignored, so no type can default a list item to
centre.

```js
export default {
  defaultAlign: 'center',   // the whole .slide-inner centres
  fields: [ /* … */ ],
};
```

Two consequences worth knowing, because they are the reason this is a
declaration rather than "always emit a class":

- **What counts as an override moves with it.** On a centring type, `left` is a
  real choice and is stored and emitted; `center` is the no-op that gets pruned.
  On every other type the reverse holds, exactly as before.
- **An untouched deck stays byte-identical.** Defaults are still pruned, so
  adding `defaultAlign` starts no classes on decks nobody has styled. The
  always-emit alternative would have rewritten the markup of every deck in
  existence to fix a panel label.

Variant-conditional centring cannot be expressed here — team-cards' circular
shape, icon-card tiles, a single-metric KPI grid, a horizontal process, a
one-block text row all centre based on a content value, and a static field
declaration has no access to that. Those panels still report `left`.

### `group` — which fields move together?

`shared/slide-types/field-groups.js`. Extrinsic, type-local, an arbitrary set
per type. A field declares `group: '<id>'`; the type declares the matching entry
in `fieldGroups[]`, naming the content field that stores the block's alignment:

```js
const HEADER_BLOCK = alignGroup('header-block', 'headerAlign', {
  label: 'Header alignment',
  schematicKind: 'bullets',
});

export default {
  fieldGroups: [HEADER_BLOCK.group],
  layoutVariants: HEADER_BLOCK.variants,
  fields: [
    HEADER_BLOCK.field,
    { key: 'title', group: 'header-block', /* … */ },
    { key: 'subheading', group: 'header-block', /* … */ },
  ],
};
```

`alignGroup()` returns the group, its enum field and its layout tiles together,
because the three must agree — a hand-rolled trio could let the enum options
drift from the group's offered values.

The two are deliberately **not** one vocabulary. Folding group membership into
`role` would multiply it (`heading-in-title-block` next to `heading-standalone`,
per type) and destroy the reuse that makes the role table cheap.

## One resolver

`fieldAlignAffordance(fields, key)` is the single read path. Editor and renderer
both call it, so they cannot disagree.

```js
{ values: string[], owner: 'field' | 'role' | 'group', groupId: string | null }
```

| owner | meaning | editor draws |
| --- | --- | --- |
| `field` | the field decides | the control, with `values` |
| `role` | nothing can align this | no control — the answer is "never" |
| `group` | the block decides | the control **disabled**, pointing at Layout |

`values` is empty for both non-field owners. Returning the *owner* is what makes
"cannot be aligned" distinguishable from "aligned somewhere else"; with only an
empty array those collapse into one silent absence, and a silently missing
control reads as a missing feature.

`fieldAllowedAlignValues()` is the derived view. Because `injectTextStyles`
already gates a stored `align` through it, a value stored on a field *before* it
joined a group goes inert on render with no migration — the same gate that
already drops a list item's alignment.

## Where the value lives, and who owns which axis

The group's alignment is a plain **content field**, written by the toolbar
"Layout" chip through `layoutVariants` (`client/views/editor/layout-switcher.js`)
— the mechanism `content-slide` and `image-text-slide` already used for their
structural variants. There is no second surface.

The align field is deliberately **not** an inspector keep
(`client/views/editor/editor-form/inspector-form.js`), the same convention the
structural `layout` enums follow: the chip is its only control.

Horizontal and vertical are owned by different parties:

| axis | owner | where |
| --- | --- | --- |
| horizontal | the **author**, per slide | group align content field |
| vertical (title slide) | the **theme** | `titleLayout` (`bottom \| center \| top`) |
| vertical (chapter title) | the author | the type's own `layout` enum |

One owner per axis, so there are no precedence rules to reason about. The theme
sets a title slide's posture; the author composes this one slide.

## A marker-anchored list never inherits alignment

A bullet or number `::marker` sits at the content box's start and does not move.
Centre or right-align the block and every line drifts a different distance from
its own marker — three bullets, three indents. So the list itself is pinned to
the logical start, whatever the block around it does; the surrounding prose
still aligns freely.

One rule, in `01-layout-and-title/00-base.css`:

```css
.slide :is(ul, ol):not([class]) {
  text-align: start;
}
```

`:not([class])` is the marker test. A markdown-authored list is emitted bare
(`<ul dir="auto">`, see `buildList` in `shared/markdown.js`) and keeps its
markers, so it is exactly the case this guards — including the content-dependent
one, where an author types `- bla` into a prose field and gets a list without
ever touching an alignment control. The slide types that use a list as a *layout
container* — poll options, funnel stages, pyramid levels, timeline, cycle,
process — all carry a class, all set `list-style: none`, and several centre
their labels inside a shape on purpose. Those are untouched.

The rule is stated in terms of the **marker**, not the mechanism that moved the
block. Its two predecessors were anchored on `tf-align-*`, which covered a block
the author had aligned and missed every type that centres in its own slide CSS —
`end-slide` being the one that surfaced it. `tests/list-alignment.test.js` pins
both halves of the `:not([class])` assumption, so the rule cannot silently stop
firing.

List and step SLIDE types are a separate mechanism: their item fields carry
`role: 'list-item'`, so they never get an align class in the first place.

## Rendering

A non-default group value becomes one class on the slide root
(`is-align-center`), and the type's CSS moves the whole block from it. The
default emits **nothing**, so an untouched deck's markup is byte-identical to
before the model existed.

Two CSS traps worth knowing:

- **`00-base.css` resets `.slide h1..h4` to `text-align: start`** to defeat
  global site typography. That reset beats any inherited value, so a group's
  centred variant must address its heading directly (three classes outrank one
  class plus one element).
- **Capped boxes need `margin-inline: auto`**, not just `text-align: center`.
  Centring only the text leaves the box where it was.

## Which types declare groups

| type | group | members |
| --- | --- | --- |
| `title-slide` | `title-block` | title, subheading, meta |
| `chapter-title-slide` | `title-block` | title, subheading |
| `list-slide`, `lijstje-slide` | `header-block` | title, subheading |
| `logo-wall-slide` | `header-block` | title, subheading |
| `chart-slide` | `header-block` | title, subheading |
| `kpi-metrics-slide` | `header-block` | title, subheading |
| `quote-slide` | `quote-block` | quote, authorName, authorTitle |

Types whose repeated cells each own their box — `text-blocks`,
`content-columns`, `comparison`, `matrix`, `process`, `timeline`, `funnel`,
`cycle`, `pyramid`, `team-cards`, `card-stack`, `poll`, `likert-slider` — are
deliberately **not** grouped. There "centre this field" means "centre it within
its cell", which is exactly right, and their sibling fields already share a
centre.

The shape/node diagram types among these — `cycle`, `funnel`, `pyramid` — are a
decided contract, not an accidental exception (option B, 2026-07-22; #226). Their
labels are marker-anchored like a list item, but each label sits **inside a
shape** (a ring node, a funnel band, a pyramid tier), so centring it within that
node is a legitimate authoring choice rather than the marker-detachment
`list-item` guards against. They therefore carry **no** `list-item` role and keep
block alignment on purpose; `tests/text-roles.test.js` asserts this so tagging
them `list-item` later trips as a regression.

Groups offer **left and centre only**. A right-aligned text block is not a
layout worth handing people, and it is the one value that produced a broken
slide in the deck history (a centred title next to a right-aligned subtitle).
`right` stays in the vocabulary for standalone fields where it is meaningful,
such as a caption under an image.

## The one migration

`quote-slide` used to hardcode this behaviour: it read one designated field's
per-field alignment (`textStyles.quote.align`) and lifted it to a whole-block
treatment. That is now the declared group, so the type keeps a **read fallback**
— `quoteAlign` wins when present, otherwise the legacy value is read. Nothing is
rewritten on disk; the editor writes the new key from now on.

No other type needs one. Across 245 decks and 832 slides there were two stored
`align` values, both on standalone fields, both unaffected.

## Theme locks

A theme cannot restrict which alignment variants are available.
`LOCKABLE_PROPERTIES` is deliberately coarse — `background` and `logo`, "a
handful of high-value brand properties, not a lock per token"
(`shared/theme-locks.js`). Alignment is composition, not brand, so it does not
earn a lock. If a fork ever needs one, the seam is `LOCKABLE_PROPERTIES` plus a
filter on the variant list, not a new mechanism.

## Known gap

`.tf-align-left` sets `text-align: left` (physical) while the no-class default
is `start` (logical). On an RTL deck the explicit choice is therefore wrong and
the default is right; these should be `start`/`end`. Tracked separately — it is
not what `right` is for.
