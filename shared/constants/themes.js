/**
 * Theme-related constants.
 * Centralizes theme values to avoid magic strings throughout the codebase.
 */

/**
 * The default theme ID used when no theme is specified.
 * This is the fallback for presentations, embeds, and theme selectors.
 *
 * `brand` (label "Forest") carries Deckyard's own palette — the forest green
 * and brass the logo mark and deckyard.eu already use. It is the one branded
 * theme; the other five built-ins are palette-named archetypes (`amethyst`,
 * `corporate`, `editorial`, `midnight`, `playful`) carrying the neutral
 * placeholder logo. A default that contradicts the product's own colours makes
 * every screenshot fight the page it sits on, so `brand` is the default and no
 * other built-in wears the mark. See docs/developer/themes.md § The built-in set.
 */
export const DEFAULT_THEME_ID = 'brand';

/**
 * Display name for the default theme.
 */
export const DEFAULT_THEME_NAME = 'Forest';
