/**
 * The tier ladder and the `fallback` facet: which slide types we *promise*, and
 * what a reader that implements only the promised ones does with the rest.
 *
 * Deckyard publishes its slide types as a format (`deckyard.eu/schema/v3/`), and
 * every name in there is an implicit promise that was never explicitly bounded.
 * The type set was not designed as a spec — it grew as a product line inside one
 * organisation (the CIIIC fork came first; upstream was abstracted out of it),
 * which is why there are six diagram geometries and three ways to show a set of
 * cards. Publishing that as "the format" asks a second implementer to build all
 * of it, or to be incomplete.
 *
 * The reframe that fixes it is **not "which types do we remove" but "which types
 * do we promise"**. Removing is destructive and irreversible once a name is
 * published; a tier is free and reversible. So nothing is removed and nothing
 * moves to the fork — instead the set is split into three tiers, of which only
 * the first is normative.
 *
 * ## The three tiers
 *
 * 1. **Core profile** — the nine types in `CORE_PROFILE`. Normative: what a
 *    conforming implementation must be able to render. Covered by the existing
 *    stability promise.
 * 2. **Deckyard set** — every other core type. We ship them, publish them and
 *    document them, but they version with the app and may walk the removal
 *    ladder (`docs/reference/slide-type-removal.md`).
 * 3. **Extension** — fork types (`custom/slide-types/`), org types from the
 *    builder UI, and third-party types later. The declarant's promise, not ours.
 *    We promise nothing about them and we do not ignore them.
 *
 * **The tier is a property of the name, not of the definition.** A fork that
 * overrides `title-slide` answers a tier-1 name and inherits the tier-1 promise;
 * that is what choosing the name means. A fork type under a new name is tier 3
 * however good it is.
 *
 * ## The rule that makes the tiers enforceable
 *
 * > **Every tier-2 type declares a `fallback` to a tier-1 type.**
 *
 * One extra declarative key, the same shape as `structure` and `runtime`, and it
 * buys four things:
 *
 * 1. A tier-1-only reader renders *every* Deckyard deck **without dropping
 *    content**: a funnel degrades to a list, a KPI grid to a list, a gallery to
 *    images. That is what "good citizen" means in practice.
 * 2. The removal ladder gets its `successor` candidate for free.
 * 3. The conformance kit gets a testable expectation per type instead of only a
 *    fixture.
 * 4. "Should this be its own type?" gets a second test beside the
 *    type-versus-variant rule: a type with no sensible tier-1 degradation is
 *    probably a theme variant, not a slide type.
 *
 * **The fallback names a tier-1 *contract*, not a one-for-one slide swap.** A
 * gallery falling back to `image-slide` means "this content is images, render it
 * the way you render images", and a reader is free to emit more than one slide.
 * Which contract a type points at is decided by *what holds its content without
 * losing any*, not by family resemblance — `video-slide` falls back to
 * `content-slide` rather than `image-slide` because it carries a title and a URL
 * and no image at all.
 *
 * A tier-1 type declares no fallback: it *is* the floor.
 *
 * ## What this is not
 *
 * - Not `extends`. `fallback` is a degradation hint, not a type relation, and it
 *   carries no fields (inheritance stays rejected, decision 2026-07-28).
 * - Not the unknown-type render contract. That one (a reader meeting a type it
 *   has never heard of renders the structure plus the text and shows the type
 *   name) is about *unknown* types and is A8.3's normative text. `fallback` is
 *   about types that are known but not implemented.
 *
 * @see docs/reference/slide-type-tiers.md
 * @see docs/reference/slide-type-structure.md
 * @see docs/reference/slide-type-runtime.md
 */

import { CORE_SLIDE_TYPE_NAMES } from './registry.js';

/**
 * The tier vocabulary. Numeric because "tier 1" is how everyone says it, and
 * because a number is the cheapest thing to put on the wire.
 *
 * @type {Readonly<Record<number, string>>}
 */
export const SLIDE_TIERS = Object.freeze({
  1: 'Core profile — normative; a conforming implementation renders these.',
  2: 'Deckyard set — we ship and publish them; they version with the app.',
  3: 'Extension — declared by a fork, an org or a third party.',
});

/** Named constants for the three tiers, so call sites do not spell out digits. */
export const SLIDE_TIER = Object.freeze({
  CORE_PROFILE: 1,
  DECKYARD_SET: 2,
  EXTENSION: 3,
});

/**
 * The core profile: the nine normative types.
 *
 * The choice is a criterion rather than a taste. This is the minimal set that
 * expresses an ordinary presentation without loss — title, section break, prose,
 * enumeration, quotation, image, image-with-text, table, closing. Everything
 * outside it adds expressiveness that has an acceptable degradation *inside* it,
 * which is exactly what the `fallback` declaration writes down.
 *
 * `chart-slide` is deliberately **not** here. It requires a charting library, and
 * the success criterion for a second implementation is a weekend of work
 * (`deck-format-spec-decisions.md`, point 7). A profile that demands a charting
 * runtime is no longer an entry threshold.
 *
 * @type {ReadonlyArray<string>}
 */
export const CORE_PROFILE = Object.freeze([
  'title-slide',
  'chapter-title-slide',
  'content-slide',
  'list-slide',
  'quote-slide',
  'image-slide',
  'image-text-slide',
  'table-slide',
  'end-slide',
]);

const CORE_PROFILE_SET = new Set(CORE_PROFILE);
const CORE_NAMES_SET = new Set(CORE_SLIDE_TYPE_NAMES);

/**
 * Slide types that are **declared but not built**: the name, the tier and the
 * fallback are part of the published format, and no implementation exists yet.
 *
 * Declaring is deliberately decoupled from building (the move borrowed from
 * teal.fm, see `atproto-interop.md`). A name that is reserved and pointed at a
 * tier-1 fallback costs nothing to honour — a reader that does not implement it
 * degrades exactly as it would for any other tier-2 type — and it stops the same
 * gap being rediscovered and then filled ad hoc under a worse name.
 *
 * The bar for adding an entry is high on purpose, and it is now a question with
 * an answer rather than a matter of taste: **which tier-1 type is the fallback,
 * and why is that loss unacceptable?** The temptation to declare a wishlist is
 * precisely how a set ends up at 38 again.
 *
 * A declared name must not be in the registry: the moment something renders it,
 * it is a normal type declaring its own `fallback` and its entry here goes.
 *
 * @type {Readonly<Record<string, {tier: number, fallback: string, structure: string, why: string}>>}
 */
export const DECLARED_SLIDE_TYPES = Object.freeze({
  'code-slide': Object.freeze({
    tier: SLIDE_TIER.DECKYARD_SET,
    fallback: 'content-slide',
    structure: 'singleton',
    why:
      'A code / monospace slide is genuinely missing. Without it the options are ' +
      'custom-html-slide or a text slide, and in both cases the semantics are ' +
      'gone: nothing says "this is source, render it monospaced, do not reflow ' +
      'it, do not smarten the quotes". The fallback loses the monospacing, not ' +
      'the code.',
  }),
});

/** @type {ReadonlyArray<string>} */
export const DECLARED_SLIDE_TYPE_NAMES = Object.freeze(
  Object.keys(DECLARED_SLIDE_TYPES)
);

/**
 * Whether a name is one of the nine normative types.
 * @param {unknown} name
 * @returns {boolean}
 */
export function isCoreProfileType(name) {
  return typeof name === 'string' && CORE_PROFILE_SET.has(name);
}

/**
 * The tier a slide-type name sits in.
 *
 * Resolved off the *name*, for the reason in the module header: the tier is what
 * we promise about a name, and a fork that answers a core name takes on that
 * promise rather than escaping it.
 *
 * Unknown names are tier 3 — the honest answer for a type nobody here declared,
 * and the one that keeps rule 5 of the seam ("unknown degrades, never breaks").
 *
 * @param {string} name - a slide type name
 * @returns {number} 1, 2 or 3
 */
export function slideTypeTier(name) {
  if (typeof name !== 'string' || !name) return SLIDE_TIER.EXTENSION;
  if (CORE_PROFILE_SET.has(name)) return SLIDE_TIER.CORE_PROFILE;
  if (CORE_NAMES_SET.has(name)) return SLIDE_TIER.DECKYARD_SET;
  if (Object.hasOwn(DECLARED_SLIDE_TYPES, name)) {
    return DECLARED_SLIDE_TYPES[name].tier;
  }
  return SLIDE_TIER.EXTENSION;
}

/**
 * A definition's declared fallback, or `''` when it declares none or declares
 * something that is not a tier-1 type.
 *
 * Validated rather than passed through, because the whole value of the facet is
 * that the target is guaranteed renderable by a tier-1-only reader. An
 * unrecognised value degrades to "no declaration", which lets the caller take its
 * own default branch — seam rule 5, never a throw.
 *
 * @param {any} def - a slide-type definition
 * @returns {string}
 */
export function slideFallback(def) {
  const f = def?.fallback;
  return isCoreProfileType(f) ? f : '';
}

/**
 * The tier-1 contract a reader should use for a slide type: the type itself when
 * it is already tier 1, otherwise its declared fallback, otherwise `''`.
 *
 * The one lookup for this facet, per seam rule 2 — consumers call this instead
 * of writing their own precedence. Definition first (rule 1): the `def` a caller
 * holds at runtime is the one that answers, so a fork type's own declaration is
 * heard.
 *
 * `''` means "no tier-1 contract is declared for this", which is the expected
 * answer for a tier-3 type that declares nothing. That is where the *unknown*
 * type render contract takes over, not this facet.
 *
 * @param {string} name - a slide type name
 * @param {any} [def] - its definition, when the caller holds one
 * @returns {string}
 */
export function coreProfileContract(name, def) {
  if (isCoreProfileType(name)) return name;
  const declared = slideFallback(def);
  if (declared) return declared;
  const reserved = DECLARED_SLIDE_TYPES[name];
  return reserved && isCoreProfileType(reserved.fallback) ? reserved.fallback : '';
}
