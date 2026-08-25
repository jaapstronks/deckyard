/**
 * Theme-owned background presets.
 *
 * A theme declares the background images its title slides may use via
 * `theme.backgroundPresets`. This is the *only* mechanism — the repo used to
 * ship a hardcoded `TITLE_BG_PRESETS` list of four demo photos that any deck
 * could land on regardless of its theme, which meant a fork's brand decks came
 * out wearing Deckyard's stock imagery.
 *
 * A theme with no presets yields no automatic background. That is deliberate:
 * a flat, on-brand title slide beats an off-brand photo.
 */

/**
 * Read a theme's background preset URLs.
 * @param {Object} [theme] - a loaded theme (file JSON or DB-built)
 * @returns {string[]} preset URLs; empty when the theme declares none
 */
export function getBackgroundPresets(theme) {
  if (!theme || typeof theme !== 'object') return [];
  if (!Array.isArray(theme.backgroundPresets)) return [];
  return theme.backgroundPresets.filter(
    (url) => typeof url === 'string' && url.trim(),
  );
}

/**
 * Pick a background image for a new title slide.
 *
 * @param {Object} [theme] - the active theme, when the caller has one
 * @returns {string} a preset URL, or '' when there is no theme context or the
 *   theme declares no presets — callers should treat '' as "leave it empty"
 */
export function pickBackgroundPreset(theme) {
  const presets = getBackgroundPresets(theme);
  if (!presets.length) return '';
  return presets[Math.floor(Math.random() * presets.length)];
}

/**
 * Seed a new slide's background from the theme presets, for types declaring
 * `autoBackgroundPreset`. Writes the CANONICAL `slideBgImage` key — the one
 * the shared background layer paints and the inspector's Background section
 * edits. A no-op for types without the flag, and never overwrites a background
 * the caller already put on the content (including an author's deliberate
 * empty string).
 *
 * One helper because the two callers (server-side `newSlide`, the editor's
 * insert path) used to disagree: both wrote the legacy `bgImage` key, but only
 * one of them gated on the key already existing — so the same type got a random
 * photo from one surface and a flat slide from the other.
 *
 * @param {Object} content - slide content, mutated in place
 * @param {Object} [def] - the slide type definition
 * @param {Object} [theme] - the active theme
 * @returns {Object} the same content object
 */
export function seedAutoBackgroundPreset(content, def, theme) {
  if (!content || typeof content !== 'object') return content;
  if (!def?.autoBackgroundPreset) return content;
  if (Object.prototype.hasOwnProperty.call(content, 'slideBgImage')) {
    return content;
  }
  // Never stack a preset on top of a legacy background either: un-migrated
  // content (e.g. a pre-fold slide-library item) with a non-empty `bgImage`
  // still renders it via the read-only fallback and folds into `slideBgImage`
  // on first edit — the same stance as the deck-import seed in deck.js. A
  // legacy key that is merely present-but-empty (a fork type's field default)
  // does not block seeding.
  if (typeof content.bgImage === 'string' && content.bgImage.trim()) {
    return content;
  }
  const preset = pickBackgroundPreset(theme);
  if (preset) content.slideBgImage = preset;
  return content;
}
