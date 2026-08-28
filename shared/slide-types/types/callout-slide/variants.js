/**
 * callout-slide — the variant table.
 *
 * The five kinds of callout are ONE type with a `variant` enum, not five types
 * (decision 1, 2026-07-22): the variant carries the semantics, so the ~40-type
 * list does not balloon and one stylesheet covers the family.
 *
 * Everything that differs per variant is derived from the shared admonition
 * vocabulary (`shared/slide-types/admonitions.js`) and nothing else. It is
 * shared rather than owned here because the aside inset renders the same five
 * promises in a different shape, and a warning that carries one glyph on a
 * slide and another in an inset is two vocabularies wearing one name. In
 * particular the **icon is derived, never authored** — a callout whose glyph
 * disagrees with its kind is worse than no glyph, and an author who wants a
 * free icon wants `icon-card-grid-slide`.
 *
 * Internal to the directory: `index.js` and `render.js` both need the same
 * answers and neither is the natural owner of the other
 * (docs/reference/slide-type-directory.md § The layout).
 */

import {
  ADMONITION_META,
  ADMONITION_VARIANTS,
  resolveAdmonitionVariant,
} from '../../admonitions.js';

/** The variant vocabulary, in picker order: loudest promise first. */
export const CALLOUT_VARIANTS = ADMONITION_VARIANTS;

/** The variant an unset or unrecognised value resolves to. */
export const DEFAULT_CALLOUT_VARIANT = 'insight';

/**
 * Resolve stored content to a variant this type knows.
 * @param {unknown} value - `content.variant` as stored.
 * @returns {string} one of {@link CALLOUT_VARIANTS}
 */
export function calloutVariant(value) {
  return resolveAdmonitionVariant(
    value,
    CALLOUT_VARIANTS,
    DEFAULT_CALLOUT_VARIANT,
  );
}

/**
 * The derived parts of a variant. Takes a raw value, so callers never have to
 * normalise first.
 * @param {unknown} value
 * @returns {{icon: string, copyKey: string}}
 */
export function calloutMeta(value) {
  return ADMONITION_META[calloutVariant(value)];
}
