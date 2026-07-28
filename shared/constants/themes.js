/**
 * Theme-related constants.
 * Centralizes theme values to avoid magic strings throughout the codebase.
 */

/**
 * The default theme ID used when no theme is specified.
 * This is the fallback for presentations, embeds, and theme selectors.
 *
 * `brand` (label "Forest") carries Deckyard's own palette — the forest green
 * and brass the logo mark and deckyard.eu already use. The older `deckyard`
 * theme is violet and keeps its id and label; it is now one example style
 * among the built-ins rather than the default, because a default that
 * contradicts the product's own colours makes every screenshot fight the page
 * it sits on. See docs/developer/themes.md § The built-in set.
 */
export const DEFAULT_THEME_ID = 'brand';

/**
 * Display name for the default theme.
 */
export const DEFAULT_THEME_NAME = 'Forest';