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
    (url) => typeof url === 'string' && url.trim()
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
