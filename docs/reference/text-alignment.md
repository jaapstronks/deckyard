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
`cycle`, `team-cards`, `card-stack`, `poll`, `likert-slider` — are deliberately
**not** grouped. There "centre this field" means "centre it within its cell",
which is exactly right, and their sibling fields already share a centre.

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
