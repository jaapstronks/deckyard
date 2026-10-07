# Text styles: role, group and offer

How an author styles one piece of text on a slide - its alignment and its size -
and why most text cannot be styled at all. Three declarations answer three
different questions; this page says which is which, how the choice is stored,
and what the write path refuses.

This is a reference page: it describes what is, not what will change.

## Three questions, three declarations

| Question                                     | Declaration                                                  | Where                                |
| -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| May the author style this text, and how far? | the **offer**: `textStyle`, `itemTextStyle`, `textStyleSets` | `shared/slide-types/text-styles.js`  |
| Which alignment values make sense for it?    | the **role** (`role: 'quote'`, `'list-item'`, …)             | `shared/slide-types/text-roles.js`   |
| Does a block decide its alignment instead?   | the **group** (`group: 'title-block'` + `fieldGroups`)       | `shared/slide-types/field-groups.js` |

The offer decides whether a control exists. The role narrows the values an
offered alignment may take (a quote never aligns right, a list item never
aligns). The group owns alignment for its members, so a member never offers
`align` of its own; the inspector shows the block's alignment disabled with a
pointer to the Layout chip. Role and group are described in
[`text-alignment.md`](text-alignment.md).

## The offer (D220)

**A text field offers nothing unless its type offers it on purpose.** There is
no default control: the "This text" tab shows the sentence "This text follows
the slide's layout" for a field without an offer. The vocabulary is `align`
and `size`. **Per-field text colour does not exist** (D221): the slide
background decides text colour, and switching it switches every text at once.

The offer sits where the structure decides its scope, so a type never says
"not per instance" field by field:

```js
fields: [
  // A standalone field: styled on its own.
  { key: 'body', type: 'markdown', textStyle: ['align', 'size'] },

  // An array: every instance of the item field at once. A nested array
  // declares on the inner array and covers every item of every parent.
  {
    key: 'quotes',
    type: 'items',
    itemTextStyle: { quote: ['size'] },
    itemFields: [{ key: 'quote', type: 'string' }, …],
  },
],

// A fixed set of siblings without an array, styled as one.
textStyleSets: [
  { id: 'column-titles', fields: ['leftTitle', 'rightTitle'], textStyle: ['align'] },
],
```

**There is no per-instance style on a field that has siblings.** An item field
is styled through its array; a set member only through its set.

**Declaring `size` is a promise the CSS keeps.** The field's `font-size` reads
`calc(<base> * var(--tf-size-scale, 1))`; `tf-size-sm` sets the scale to 0.85,
`tf-size-lg` to 1.2, and `md` is the default that emits nothing. A plain `em`
multiplier would replace the size the type sets with a fraction of the parent
size, so the scale composes on the type's own step instead
(`client/styles/slides/03-components/97-text-styles.css`).

### What the definition check refuses

`validateSlideTypeDefinition` reports these as errors, so a core type fails its
test and a fork type does not load:

- an offer that is not a non-empty list of `align` and `size` (colour included);
- `textStyle` on a non-text field, or on an item field (declare `itemTextStyle`
  on its array instead);
- `itemTextStyle` on a field without `itemFields`, or naming no text item field;
- `align` on a group member, or on a role that never aligns (`list-item`);
- a set with fewer than two top-level text fields, a member that also offers on
  its own, or a field in two sets.

## Storage

One key per offer in `content.textStyles`:

```js
content.textStyles = {
  body: { align: 'center', size: 'lg' }, // a standalone field
  'quotes.*.quote': { size: 'sm' },       // every instance of an item field
  'rows.*.blocks.*.title': { … },         // nested: every block of every row
  '@column-titles': { align: 'right' },   // a declared set: `@` + its id
}
```

`*` stands for every index; `@<id>` names a set. Values are the field's choice
of `align` (`left` / `center` / `right`, narrowed by its role) and `size`
(`sm` / `md` / `lg`). The field's own default alignment and `md` are no-ops:
`normalizeTextStyles` drops them, so a click-to-default leaves the deck
unchanged.

## Rendering

The shared `renderSlideHtml` runs one string post-pass, `injectTextStyles`,
that adds `tf-align-*` / `tf-size-*` to every element whose `data-inline-field`
the key covers (`quotes.0.quote`, `quotes.1.quote`, … for `quotes.*.quote`).
One code path, so the editor canvas, present mode and every export show the
same thing. A stored key the type does not offer emits nothing. The classes
survive `stripEditorOnlyAttrs`; their CSS is anchored on the class, not the
attribute.

## Refusals on the write path

`normalizeSlides` (`server/storage/presentations/slides.js`) is the seam every
stored slide passes, on the internal API, the public v1 API and MCP alike. A
`textStyles` map that asks for anything the type does not offer is **refused,
not pruned**, so the writer learns the style did not land: `400`,
`error: 'invalid'`, `details: { field: 'slides', index, reason }`, and a
message naming the key and why.

| `details.reason`                  | When                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `text_style_per_instance`         | a concrete index (`quotes.1.quote`) or one set member, where the type offers the shared key; the message names it |
| `text_style_not_offered`          | a key the type offers nothing for (`members.3.name` on Image blocks)                                              |
| `text_style_property_not_offered` | a property outside the offer, `color` always                                                                      |
| `text_style_value_not_offered`    | a value outside the vocabulary, or an alignment the role rules out                                                |
| `text_style_malformed`            | `textStyles` or one of its entries is not an object                                                               |

## Published contract

Every outside surface reads the same offers the write path refuses against,
through `acceptedTextStyles(def)` (each offered key with the values its
properties take) and `TEXT_STYLE_REFUSAL_REASONS`:

- **JSON Schema** (`/api/v1/schema/slide-types/{type}.json`, and every type in
  `deck.json`): a type that offers styling publishes `content.textStyles` with
  exactly its offer keys and per key an `enum` for `align` and `size`, closed
  with `additionalProperties: false` at both levels while `content` itself
  stays lenient. A type that offers nothing publishes no `textStyles`.
- **MCP**: each `get_slide_types` entry carries `textStyles` (omitted when the
  type offers nothing); `create_presentation_from_slides`, `update_slide` and
  `add_slide` describe the rule once. MCP returns the refusal message, which
  names the key and why; the `details.reason` code travels on the HTTP API.
  `create_presentation_from_slides` runs the write seam before it creates the
  deck, so a refusal leaves nothing behind.
- **`docs/openapi.yaml`**: `Slide.content.textStyles` and the
  `TextStyleRefusal` details shape.

`tests/text-style-api-surface.test.js` pins all of these to the derivation.

## Stored decks

The v17 → v18 schema step (`foldTextStyles` in
`shared/slide-types/schema-version.js`) folds every stored map into this shape,
on every read, write and import: every `color` goes; per-instance keys fold into
the shared key where every instance stored the same value (otherwise the
property goes, because folding would restyle instances nobody touched); what the
type does not offer goes. A type the registry does not know there keeps its map
minus colour, for its own reader.

## What core offers

Everything not listed offers nothing. The per-type list is generated, not
kept here: the **Text style offer** column of the coverage table in
[`editor-inspector.md`](editor-inspector.md) § Per-type coverage audit, derived
by `scripts/generate-slide-type-docs.js` from the same `textStyleOffers()` the
renderer, the inspector and the write path read. Today that is: content
`title` and `body`, callout, image-text and image-set `body` (align, size);
title-slide `title` and `subheading`, chapter-title `title`, and quote
`quotes[].quote` as one set (size).

On the title slide, chapter title and quote the block owns alignment (the
Layout chip), so those fields offer size only. The title slide's size composes
with its content-aware cover scale: `coverFontScale()` budgets room for an L
title or subtitle, so the fullest legal block still fits the frame; its meta
line offers nothing (D241). The list slide offers no text-style size: its
slide-level `density` setting is the one size control for list items (D241).

### No control without an effect

`tests/text-style-render-guard.test.js` renders every core offer in a real
browser and measures it: an offered size makes every covered element smaller
at S and larger at L and leaves every other field alone; every offered
alignment value lands as the computed alignment of every covered element. The
title slide's fullest block is checked with title and subtitle at L across the
six core themes and three `titleLayout`s.

One alignment case is content-dependent: a markdown field whose text is only a
bullet or numbered list stays on its markers whatever the block does
([`text-alignment.md`](text-alignment.md)). The inspector then shows the
alignment control disabled with that reason, and live again once the text has a
paragraph (`isListOnlyMarkdown()` in `shared/markdown.js`).
