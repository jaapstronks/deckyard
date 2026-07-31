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
 * seven near-duplicates, one of which (the List type, briefly registered under
 * both `list-slide` and a Dutch alias) was literally the same object standing
 * beside itself in the picker for months.
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
 * ## The item contract, and why it is the interop currency
 *
 * `structure` started as an internal design tool — the axis that catches
 * duplicates and answers "type or variant?". It is now also the **normative**
 * half of the format's conformance claim, and that is a bigger job than naming
 * six buckets: it needs a statement of what a reader may rely on per structure.
 *
 * That statement is `SLIDE_STRUCTURE_CONTRACTS` below. It matters because it is
 * the only part of the format that **does not scale with the number of types**.
 * A reader that implements the nine core-profile types knows nine things; a
 * reader that implements the six structures plus their item contract can render
 * *any* type, including ones published after it shipped, without guessing.
 * Conformance is therefore two-level — structure level, then profile level —
 * rather than 36-or-nothing. See `docs/reference/deck-conformance.md`.
 *
 * The contract is declared here rather than asserted only in the test, so the
 * guardrail (`tests/slide-type-structure.test.js`) *derives* from the published
 * statement instead of restating it. A promise and its enforcement drifting
 * apart is the failure this facet exists to prevent.
 *
 * @see docs/reference/slide-type-structure.md
 * @see docs/reference/deck-conformance.md
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

/**
 * @typedef {object} StructureContract
 * @property {number|null} itemArrays - how many repeated-item arrays the
 *   content carries; `null` when the payload is not a field shape the registry
 *   can count (see `dataset`).
 * @property {'none'|'authored'|'fixed'|'encoded'} count - what the item count
 *   means: no items at all, the author's choice, part of the type's meaning, or
 *   carried inside an encoded payload.
 * @property {boolean} hasContentFields - false only for `chrome`.
 * @property {string} itemsPhrase - the contract's item clause, in prose, used
 *   both in the docs and in the guardrail's failure message.
 * @property {string} reader - what a reader that knows only this structure may
 *   do with a slide of a type it has never seen.
 */

/**
 * What a reader may rely on per structure — the normative half of the facet.
 *
 * Every entry answers three questions: how many repeated-item arrays the
 * content has, what the count means, and what a reader does with the slide when
 * it does not know the type. The first two are derivable from the field
 * registry, which is what makes {@link structureContractViolation} possible and
 * what keeps this table from being an aspiration.
 *
 * @type {Readonly<Record<string, StructureContract>>}
 */
export const SLIDE_STRUCTURE_CONTRACTS = Object.freeze({
  singleton: Object.freeze({
    itemArrays: 0,
    count: 'none',
    hasContentFields: true,
    itemsPhrase: 'no items[] field',
    reader:
      'Render the named scalar slots in declaration order. There is nothing to ' +
      'iterate, so a reader never has to guess a repetition.',
  }),
  collection: Object.freeze({
    itemArrays: 1,
    count: 'authored',
    hasContentFields: true,
    itemsPhrase: 'exactly one items[] field',
    reader:
      'Iterate the single item array. Every item has the same shape, and the ' +
      'length is the author\'s choice — a reader may reflow, paginate or split ' +
      'across slides without losing meaning.',
  }),
  'fixed-collection': Object.freeze({
    itemArrays: 1,
    count: 'fixed',
    hasContentFields: true,
    itemsPhrase: 'exactly one items[] field whose minItems equals its maxItems',
    reader:
      'Iterate the single item array, but treat the count as meaning: four ' +
      'quadrants are a matrix and five are not. A reader may restyle the ' +
      'arrangement; it must not drop or pad items to fit.',
  }),
  tabular: Object.freeze({
    itemArrays: 1,
    count: 'authored',
    hasContentFields: true,
    itemsPhrase: 'exactly one items[] field (the rows)',
    reader:
      'Read the item array as rows and each item\'s keys as columns. The column ' +
      'set is shared across rows; a reader may render it as a table, as ' +
      'definition pairs, or as one block per row.',
  }),
  dataset: Object.freeze({
    itemArrays: null,
    count: 'encoded',
    hasContentFields: true,
    itemsPhrase: 'an encoded payload plus its encoding, not an items[] field',
    reader:
      'Do not attempt the encoding unless you implement it. Decode the payload ' +
      'to rows and fall back to the tabular contract — that keeps every value ' +
      'and loses only the visual encoding.',
  }),
  chrome: Object.freeze({
    itemArrays: 0,
    count: 'none',
    hasContentFields: false,
    itemsPhrase: 'no content fields at all',
    reader:
      'There is no authored content to preserve. Render the type\'s beat in the ' +
      'deck (a closing slide, an interstitial) or omit the slide; either is ' +
      'lossless, because the slide *is* the chrome.',
  }),
});

/**
 * The contract for a structure, or `null` when the value is not one.
 * @param {unknown} structure
 * @returns {StructureContract|null}
 */
export function structureContract(structure) {
  return isSlideStructure(structure) ? SLIDE_STRUCTURE_CONTRACTS[String(structure)] : null;
}

/**
 * Whether an observed content shape honours its declared structure's contract.
 *
 * Pure and caller-fed: *which* fields count as content is a policy question
 * (globals, `actions[]` and `background` are excluded, see the guardrail), and
 * that policy stays with the caller so this module keeps stating the contract
 * and nothing else.
 *
 * @param {string} structure - the declared structure.
 * @param {{itemArrays?: Array<{key: string, minItems?: any, maxItems?: any}>,
 *          contentFieldKeys?: string[]}} shape - the observed content shape.
 * @returns {string} the violation, or `''` when the shape honours the contract.
 */
export function structureContractViolation(structure, shape) {
  const contract = structureContract(structure);
  if (!contract) return `unknown structure '${structure}'`;

  const arrays = Array.isArray(shape?.itemArrays) ? shape.itemArrays : [];
  const contentKeys = Array.isArray(shape?.contentFieldKeys) ? shape.contentFieldKeys : [];
  const keys = arrays.map((f) => f?.key).join(', ') || 'none';

  if (!contract.hasContentFields && contentKeys.length) {
    return (
      `${structure} carries ${contract.itemsPhrase}, has ` +
      `${contentKeys.length} (${contentKeys.join(', ')})`
    );
  }
  if (contract.itemArrays === null) return '';
  if (arrays.length !== contract.itemArrays) {
    return `${structure} must carry ${contract.itemsPhrase}, has ${arrays.length} (${keys})`;
  }
  if (contract.count === 'fixed') {
    const f = arrays[0];
    const min = Number(f?.minItems);
    const max = Number(f?.maxItems);
    if (!(min > 0 && min === max)) {
      return (
        `${structure} means the count is part of the meaning, so ${f?.key} must ` +
        `pin minItems === maxItems (got ${f?.minItems}..${f?.maxItems})`
      );
    }
  }
  return '';
}
