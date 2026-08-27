/**
 * callout-slide — the variant table.
 *
 * The five kinds of callout are ONE type with a `variant` enum, not five types
 * (decision 1, 2026-07-22): the variant carries the semantics, so the ~40-type
 * list does not balloon and one stylesheet covers the family.
 *
 * Everything that differs per variant is derived from this table and nothing
 * else. In particular the **icon is derived, never authored** — a callout whose
 * glyph disagrees with its kind is worse than no glyph, and an author who wants
 * a free icon wants `icon-card-grid-slide`.
 *
 * Internal to the directory: `index.js` and `render.js` both need the same
 * answers and neither is the natural owner of the other
 * (docs/reference/slide-type-directory.md § The layout).
 */

/** The variant vocabulary, in picker order: loudest promise first. */
export const CALLOUT_VARIANTS = Object.freeze([
  'insight',
  'warning',
  'definition',
  'note',
  'tip',
]);

/** The variant an unset or unrecognised value resolves to. */
export const DEFAULT_CALLOUT_VARIANT = 'insight';

/**
 * variant → its derived parts.
 *
 * `icon` is a canonical Lucide name from the curated catalog
 * (shared/icon-catalog.js); all five were already vendored, so this table adds
 * no icons. `copyKey` names the eyebrow fallback in `SLIDE_COPY`
 * (shared/slide-types/slide-copy.js) — rendered copy follows the DECK's
 * language, which is why it is slide-copy and not the `t()` UI layer.
 *
 * @type {Readonly<Record<string, {icon: string, copyKey: string}>>}
 */
const VARIANT_META = Object.freeze({
  insight: { icon: 'lightbulb', copyKey: 'calloutInsight' },
  warning: { icon: 'circle-alert', copyKey: 'calloutWarning' },
  definition: { icon: 'book', copyKey: 'calloutDefinition' },
  note: { icon: 'info', copyKey: 'calloutNote' },
  tip: { icon: 'sparkles', copyKey: 'calloutTip' },
});

/**
 * Resolve stored content to a variant this type knows.
 * @param {unknown} value - `content.variant` as stored.
 * @returns {string} one of {@link CALLOUT_VARIANTS}
 */
export function calloutVariant(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return CALLOUT_VARIANTS.includes(v) ? v : DEFAULT_CALLOUT_VARIANT;
}

/**
 * The derived parts of a variant. Takes a raw value, so callers never have to
 * normalise first.
 * @param {unknown} value
 * @returns {{icon: string, copyKey: string}}
 */
export function calloutMeta(value) {
  return VARIANT_META[calloutVariant(value)];
}
