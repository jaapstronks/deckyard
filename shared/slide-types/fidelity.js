/**
 * The `fidelity` facet: how faithfully an export target can write a slide type
 * as something the receiving application can edit.
 *
 * The fourth facet, and like `runtime` it was measured rather than designed.
 * `server/export/pptx.js` wrote one branch — `slide?.type === 'video-slide'` —
 * to answer *does this type have a composition the export can write natively,
 * or does it become a picture?* One name, so it stayed under the branching
 * inventory's threshold and nobody had to account for it; but it is the same
 * shape of mistake `structure` and `runtime` retired, only earlier in its life.
 * The moment a second type gains a native mapper the branch becomes a list, and
 * a list is a thing a new type falls out of silently — the export would keep
 * working and just quietly rasterise a type that could have been editable.
 *
 * So the question moves onto the type, before there is a list to maintain.
 *
 * ## The vocabulary
 *
 * - `native` — the export writes the whole slide as target-native objects: text
 *   frames, tables, shapes, media. Everything on it stays editable.
 * - `mixed` — the text is native, one part of the slide is not. A geometry type
 *   (a funnel, a cycle) whose labels are real text boxes over a picture of the
 *   diagram is `mixed`: the words are editable, the drawing is not.
 * - `raster` — the whole slide travels as one image. Nothing is editable and
 *   nothing is lost either: this is the honest answer, and the safe one.
 *
 * The line is drawn at *what the receiving application can edit*, not at "how
 * good it looks". A raster slide can be a pixel-perfect reproduction and is
 * still `raster`; a native slide can be a plainer arrangement of the same
 * content and is still `native`. Fidelity here means editability, because that
 * is the thing the reader of the exported file gains or does not gain, and the
 * thing "please send me the PowerPoint" is actually asking for.
 *
 * ## Why the value is an object
 *
 * `fidelity: { pptx: 'native' }` rather than a bare string, because the answer
 * belongs to a *pair*: this type, that target. PPTX is the only target with a
 * mapper today; a second one (DOCX, Google Slides) would get its own key rather
 * than a second facet with a second vocabulary. The three values above are
 * deliberately target-independent — they describe the relationship, not the
 * file format — so a new key costs a declaration per type and nothing else.
 *
 * ## What it costs in truthfulness
 *
 * `structure` is derivable from the field schema, `runtime` is not derivable at
 * all, and `fidelity` sits between the two: it has an oracle, but the oracle
 * lives in the export rather than in the type. A type declaring `native` is
 * claiming that a composition for it exists, and
 * `tests/slide-type-fidelity.test.js` checks that claim against the export's
 * own handler map in both directions. That is the whole guardrail — a
 * declaration that outruns the implementation is the one failure mode this
 * facet could otherwise introduce, since the honest default is the same value
 * the timid one would pick.
 *
 * ## Who does not declare
 *
 * A type built in Settings > Slide Types is a database record — a template, CSS
 * and fields. It has no place to put a declaration and no mapper could exist
 * for arbitrary authored markup, so `toRuntimeSlideType()` writes `raster` onto
 * the composed definition explicitly. That is a definition, not a default: the
 * facet is present on every registry entry, whichever registry it is.
 *
 * A file-JS fork type does have a place to declare, so it must
 * ({@link module:shared/slide-types/validate-definition} warns when it does
 * not) and an absent declaration resolves to `raster` — seam rule 5, unknown
 * degrades and never breaks.
 *
 * ## A leaf module
 *
 * Unlike `runtime.js` this one imports nothing, and its lookups take the
 * definition rather than the type name. Two reasons, one practical and one
 * about the seam. The practical one: `validate-definition.js` checks the facet
 * at boot and is itself pulled into the Settings bundle through
 * `custom-type-runtime.js`, so a registry import here would drag all 35 core
 * types into a bundle that wants nine strings — the same weight `compose.js`
 * was split out to avoid. The one about the seam: a caller holding a def holds
 * the *org-scoped* registry, which is the only one a database-backed type is
 * in. Resolving a name against the process-wide `SLIDE_TYPES` would answer
 * `raster` for a custom type by accident rather than by declaration, and the
 * accident would look identical to the truth.
 *
 * @see docs/reference/slide-type-fidelity.md
 * @see docs/reference/slide-type-runtime.md
 * @see docs/reference/slide-type-structure.md
 */

/**
 * The vocabulary. These three partition every (type, target) pair completely.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SLIDE_FIDELITIES = Object.freeze({
  /** The whole slide is written as target-native, editable objects. */
  native: 'The whole slide is written as native, editable objects.',
  /** Text is native; one part of the slide travels as an image. */
  mixed: 'Text is native; one part of the slide travels as an image.',
  /** The whole slide travels as one image. */
  raster: 'The whole slide travels as one image.',
});

/** @type {ReadonlyArray<string>} */
export const SLIDE_FIDELITY_NAMES = Object.freeze(
  Object.keys(SLIDE_FIDELITIES),
);

/**
 * The export targets a type may declare a fidelity for.
 *
 * One entry today. It is a list rather than a bare string so that the coverage
 * test asks its question per target: adding `docx` here makes every core type
 * fail until it says what it means for DOCX, which is the point of declaring.
 *
 * @type {ReadonlyArray<string>}
 */
export const FIDELITY_TARGETS = Object.freeze(['pptx']);

/**
 * The value an undeclared (type, target) pair resolves to.
 *
 * `raster` is the safe answer in the strong sense: it is the only value that is
 * always producible, for any type, without knowing anything about it. Every
 * other value is a claim about an implementation that may not exist.
 *
 * @type {string}
 */
export const DEFAULT_FIDELITY = 'raster';

/**
 * Whether a value is a declared fidelity.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSlideFidelity(value) {
  return typeof value === 'string' && Object.hasOwn(SLIDE_FIDELITIES, value);
}

/**
 * Whether a value is a known export target.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isFidelityTarget(value) {
  return typeof value === 'string' && FIDELITY_TARGETS.includes(value);
}

/**
 * A slide type definition's declared fidelity for one target, or `''` when it
 * declares none (or declares something outside the vocabulary).
 *
 * Validated rather than passed through, for the same reason `slideFallback()`
 * validates: an unrecognised value must read as "no declaration" so the caller
 * takes its own default branch, never as a value the export then fails to
 * dispatch on.
 *
 * @param {any} def - a slide-type definition
 * @param {string} target - an export target, e.g. `'pptx'`
 * @returns {string}
 */
export function slideFidelity(def, target) {
  if (!isFidelityTarget(target)) return '';
  const declared = def?.fidelity?.[target];
  return isSlideFidelity(declared) ? declared : '';
}

/**
 * The fidelity an export should use for a definition and target: the type's own
 * declaration, otherwise {@link DEFAULT_FIDELITY}.
 *
 * The one lookup for this facet, per seam rule 2 — an export calls this instead
 * of writing its own precedence, and an unresolvable type (a deck outliving the
 * code that rendered it) gets the same honest `raster` as an undeclared one.
 *
 * @param {any} def - a slide-type definition, from the registry the caller
 *   resolved the slide against
 * @param {string} target - an export target, e.g. `'pptx'`
 * @returns {string} one of {@link SLIDE_FIDELITY_NAMES}
 */
export function exportFidelity(def, target) {
  return slideFidelity(def, target) || DEFAULT_FIDELITY;
}

/**
 * Whether an export has to compose this type itself rather than photograph it.
 *
 * The predicate an export actually branches on, so that no consumer spells a
 * vocabulary value in a comparison — the same reason `runtime.js` hands out
 * `isLiveSlideType()` instead of leaving every caller to write `=== 'live'`. A
 * typo'd string reads as `false` and rasterises in silence, which is exactly
 * the failure this facet was built to make impossible.
 *
 * `true` covers both `native` and `mixed`: both need a composition, and how
 * much of the slide it covers is the composition's business, not the dispatch's.
 *
 * @param {any} def - a slide-type definition
 * @param {string} target - an export target, e.g. `'pptx'`
 * @returns {boolean}
 */
export function needsNativeComposition(def, target) {
  return exportFidelity(def, target) !== DEFAULT_FIDELITY;
}
