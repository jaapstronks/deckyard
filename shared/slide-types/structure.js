/**
 * The `structure` facet: what shape a slide type's primary content has.
 *
 * Deckyard has 38 core slide types and, until this module, no statement about
 * how any of them relate to any other. The registry is a flat name -> definition
 * map, so every type is a sibling of every other type. The only grouping that
 * existed lived in the presentation layer, was written out by hand twice
 * (`slide-type-picker/data.js` and `settings/tabs/slide-types-tab/categories.js`),
 * and those two already disagreed - and they mixed four independent axes:
 * `basic` is familiarity, `media`/`data` are payload, `process` is rhetorical
 * function, `interaction` is runtime behaviour. So there was no place a new type
 * *belonged*, no rule for when something is its own type versus a variant, and
 * no way to see that two types do the same thing. The result was measurable:
 * seven near-duplicates, one of which (`list-slide` / `lijstje-slide`) was
 * literally the same object standing beside itself in the picker for months.
 *
 * The fix is not one hierarchy - every tree goes wrong the moment types differ
 * along independent axes - but a small number of orthogonal, declarative facets,
 * with the picker, the settings categories, the AI catalog and the conversion
 * map as *derivations* rather than sources.
 *
 * `structure` is the first facet, and deliberately the first: it describes the
 * shape of the content, which is **derivable from the field schema**, and a
 * derivable declaration is one a test can catch lying. (`intent` - the
 * editorial promise the slide makes to a viewer - is a judgement call, so no
 * guardrail is possible; it comes later.) It is also the facet that catches the
 * duplicates.
 *
 * The declaration is additive to the deck-format spec: an optional key on the
 * type descriptor, visible through `/api/slide-types`, which is well inside the
 * stability promise.
 *
 * ## The rule underneath it
 *
 * > A **variant** is a render choice that every valid instance of the content
 * > survives without loss. A **type boundary** is where content has to be added
 * > or thrown away.
 *
 * The operational test is a round-trip: flip the variant and flip it back; if a
 * content-bearing field is orphaned, it was never a variant. That is what makes
 * `image-text-slide`'s `duo` tile (which reads `images[0-3]`) a second contract
 * under one id rather than a ninth layout, while `split`/`corner`/`row-top` are
 * exactly what a variant axis is for.
 *
 * @see docs/reference/slide-type-structure.md
 */

/**
 * The vocabulary. These six partition the current 38 types completely - there is
 * no "other" bucket, which is the best evidence available that the axis is the
 * right one.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SLIDE_STRUCTURES = Object.freeze({
  /** A fixed set of scalar slots (title + body + image). */
  singleton: 'A fixed set of scalar slots.',
  /** *n* items of one repeated shape; *n* is the author's choice. */
  collection: 'n items of one repeated shape.',
  /** Exactly *n* items, where the count is part of the meaning (4 quadrants). */
  'fixed-collection': 'Exactly n items; the count carries meaning.',
  /** Rows x columns. */
  tabular: 'Rows and columns.',
  /** Data points plus an encoding. */
  dataset: 'Data points plus an encoding.',
  /** Carries zero content fields; the slide *is* the chrome. */
  chrome: 'No content fields at all.',
});

/** @type {ReadonlyArray<string>} */
export const SLIDE_STRUCTURE_NAMES = Object.freeze(Object.keys(SLIDE_STRUCTURES));

/**
 * Whether a value is a declared structure.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSlideStructure(value) {
  return typeof value === 'string' && Object.hasOwn(SLIDE_STRUCTURES, value);
}

/**
 * A slide type's declared structure, or `''` when it declares none.
 * @param {any} def - a slide-type definition
 * @returns {string}
 */
export function slideStructure(def) {
  const s = def?.structure;
  return isSlideStructure(s) ? s : '';
}
