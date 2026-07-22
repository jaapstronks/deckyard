// Build reveal styles — how body fragments (bullets / paragraphs) appear when a
// deck reveals content step-by-step ("builds"). Phase 1 of the build-animations
// track: a single global style, resolved theme default → deck override, with no
// per-element UI yet. See docs/plans/briefs/build-animations.md.
//
// Shared between client (presenter reveal + editor settings) and any server-side
// consumer, so it stays framework-free.

/** The reveal styles a deck may choose from. */
export const REVEAL_STYLES = ['default', 'typewriter'];

/** Fallback when neither the deck nor its theme sets a style. */
export const DEFAULT_REVEAL_STYLE = 'default';

/**
 * Coerce an arbitrary value to a known reveal style, or null if unrecognized.
 * @param {*} value
 * @returns {'default'|'typewriter'|null}
 */
export function normalizeRevealStyle(value) {
  return REVEAL_STYLES.includes(value) ? value : null;
}

/**
 * Resolve the effective body-reveal style for a deck.
 * Precedence: deck setting → theme default → DEFAULT_REVEAL_STYLE.
 * @param {Object} [opts]
 * @param {Object} [opts.settings] - Deck settings (pres.settings).
 * @param {Object} [opts.theme] - Loaded theme object.
 * @returns {'default'|'typewriter'}
 */
export function resolveRevealStyle({ settings, theme } = {}) {
  return (
    normalizeRevealStyle(settings?.revealStyle) ||
    normalizeRevealStyle(theme?.revealStyle) ||
    DEFAULT_REVEAL_STYLE
  );
}
