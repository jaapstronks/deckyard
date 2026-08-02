/**
 * The `group` axis: which curated shelf a slide type is *offered* on.
 *
 * Until this module the grouping lived in two hand-written tables — the
 * editor's `PICKER_GROUPS` and the settings tab's `CATEGORIES` — and those two
 * disagreed about five of the 33 offerable types. Both degraded silently for a
 * type they had never heard of (each folds the unknown into an "Other" bucket),
 * which is why the drift went unnoticed for months, and why a type could stand
 * beside itself in the picker under two tiles both labelled "List".
 *
 * ## Why this is its own axis and not derived from `structure`
 *
 * The obvious move is to drop the axis entirely and group by the `structure`
 * facet, which is already declared, already derivable from the schema, and
 * already CI-enforced. It was measured and it does not work. `structure`
 * answers *what shape is the content*; someone opening the insert picker is
 * asking *what am I putting on this slide*. Deriving from it splits `media`
 * across two buckets (image/video/embed are `singleton`, gallery/logo-wall/
 * team-cards are `collection`), scatters the eight `data` types over five
 * buckets, and leaves `chart-slide` and `table-slide` alone in single-tile
 * groups that the picker's fold rule drops into "Other". Full measurement in
 * the typology umbrella brief.
 *
 * So the grouping stays its own declarative axis, orthogonal to `structure` and
 * `runtime`, and the two tables become derivations of it.
 *
 * ## The honest limit of the guardrail
 *
 * `structure` is checkable against the field schema and `runtime` against the
 * modules that consume it. This axis is **a judgement call** — the same limit
 * `intent` will have. Nothing can prove that `comparison-slide` belongs under
 * `data` rather than `layouts`. So the tests assert only that every offerable
 * type declares *a* group from the vocabulary, that a deprecated type declares
 * none, and that no consumer keeps a competing membership list. There is no
 * truthfulness assertion and there cannot be one; saying so here keeps the
 * guardrail from looking stronger than it is.
 *
 * ## Membership here, order in the consumer
 *
 * A consumer's array encodes *order* as well as membership, and order is a
 * cross-type curation decision that belongs to the surface making it — the
 * picker deliberately shows the most-reached-for types first, which is not a
 * fact about any one type. So each consumer keeps an order hint and derives
 * membership from here. A type missing from a hint sorts last; a hint naming a
 * retired type is ignored. Both are harmless, unlike a stale membership table.
 *
 * ## The aggregator seam
 *
 * `SLIDE_TYPE_AUTHORING` is generated over the core type directories, so a
 * lookup that reads it *first* answers a narrower question than it looks like:
 * "what does core say", not "what does this type declare". A fork type in
 * `custom/slide-types/` declaring `group: 'media'` would be dropped without a
 * word. Both lookups below therefore follow the seam rule — definition first,
 * aggregator as core's fallback, enumeration over the live map. Same rule and
 * same order in `./authoring-companions.js` for the other two companions.
 *
 * @see docs/reference/slide-type-groups.md
 */

import { SLIDE_TYPE_AUTHORING } from './authoring.js';

/**
 * The vocabulary. Six shelves covering the 33 offerable types; `other` is a
 * real home for the long tail rather than an overflow bucket, which is why it
 * is in the vocabulary instead of being "everything undeclared".
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SLIDE_TYPE_GROUPS = Object.freeze({
  /** The handful most decks are actually built from. Familiarity, not shape. */
  basic: 'The types most decks are built from.',
  /** The slide is mostly a carrier for an image, a video or an embed. */
  media: 'Carries an image, video or embedded page.',
  /** Structured arrangements of blocks, cards or steps. */
  layouts: 'A structured arrangement of blocks, cards or steps.',
  /** Argues with figures: tables, charts, comparisons, diagrams. */
  data: 'Argues with figures, comparisons or diagrams.',
  /** The audience touches it, or it runs on a clock. */
  interaction: 'The audience answers, or the slide runs on a clock.',
  /** The long tail: closing slides and the escape hatch. */
  other: 'The long tail — closing slides and the escape hatch.',
});

/**
 * Whether a value is a declared group.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSlideTypeGroup(value) {
  return typeof value === 'string' && Object.hasOwn(SLIDE_TYPE_GROUPS, value);
}

/**
 * A slide type's group: the definition's own declaration first, this build's
 * authoring aggregator second.
 *
 * That order is the aggregator-seam rule (see the module header). The
 * aggregator is generated over `shared/slide-types/types/<name>/authoring.js`,
 * so it holds core and only core; reading it *first* would mean a type from
 * `custom/slide-types/` could declare `group: 'media'` and be silently ignored.
 * Reading the definition first makes the declaration the authority and the
 * aggregator core's answer to it — the same precedence `slideTypeSchematic()`
 * and `slideTypeSample()` use, and the same one `slideStructure(def)` gets for
 * free by living on the definition.
 *
 * Passing only a name still works and still resolves core: that is the
 * fallback, not the rule.
 *
 * @param {string} type - registry type name
 * @param {{group?: unknown}|null} [def] - the slide-type definition as it
 *   exists at runtime (registry entry, or the `/api/slide-types` metadata)
 * @returns {string} a group from the vocabulary, or `''` (a deprecated type, a
 *   type that declares none, or a declaration outside the vocabulary)
 */
export function slideTypeGroup(type, def = null) {
  const declared = def?.group;
  if (isSlideTypeGroup(declared)) return declared;
  const core = SLIDE_TYPE_AUTHORING[type]?.group;
  return isSlideTypeGroup(core) ? core : '';
}

/**
 * Type name -> group, for every type that declares one. Exported as a map
 * because the companion-coverage test reads it by name.
 * @type {Readonly<Record<string, string>>}
 */
export const SLIDE_TYPE_GROUP = Object.freeze(
  Object.fromEntries(
    Object.keys(SLIDE_TYPE_AUTHORING)
      .map((type) => [type, slideTypeGroup(type)])
      .filter(([, group]) => group)
  )
);

/**
 * The types on one shelf, in the consumer's preferred order.
 *
 * Membership comes from the declarations; `order` is only a hint. A member the
 * hint does not name sorts after the ones it does (alphabetically among
 * themselves), so forgetting to curate a new type costs its position and
 * nothing else.
 *
 * **Enumerate the live map, not the build artifact.** A consumer holds the
 * types the app actually has — the registry on the server, the
 * `/api/slide-types` response in the editor — and that map is what `types`
 * takes. Iterating SLIDE_TYPE_GROUP instead would answer "which *core* types
 * are on this shelf", which is the same core-only trap `slideTypeGroup()`
 * avoids one level down. Omitting `types` falls back to core, for callers (the
 * guardrail test, mostly) that have no live map to offer.
 *
 * @param {string} group - a key from SLIDE_TYPE_GROUPS
 * @param {string[]} [order] - preferred display order, may be partial or stale
 * @param {Record<string, object>|null} [types] - the live type map to enumerate
 * @returns {string[]} type names
 */
export function typesInGroup(group, order = [], types = null) {
  const rank = new Map(order.map((type, i) => [type, i]));
  const last = Number.MAX_SAFE_INTEGER;
  const members = types
    ? Object.keys(types).filter((type) => slideTypeGroup(type, types[type]) === group)
    : Object.keys(SLIDE_TYPE_GROUP).filter((type) => SLIDE_TYPE_GROUP[type] === group);
  return members.sort((a, b) => {
    const diff = (rank.get(a) ?? last) - (rank.get(b) ?? last);
    return diff || a.localeCompare(b);
  });
}
