/**
 * Theme-related constants.
 * Centralizes theme values to avoid magic strings throughout the codebase.
 */

/**
 * The theme value that means "this installation's default" (D232). A deck
 * created without a theme stores it; it is resolved per render, never frozen
 * into the id the default happens to be today. It is also what a client falls
 * back to when a deck names no theme: the one reference that resolves to
 * whatever the default is.
 */
export const DEFAULT_THEME_REF = 'default';

/**
 * The slug of the core seed that is the installation default when the
 * `DEFAULT_THEME` env var names none. A slug, never a theme reference: only
 * the deployment-config boundary resolves it to the seed's record UUID
 * (`installationDefaultThemeId()` in `server/storage/settings.js`, D237).
 *
 * `brand` (label "Forest") carries Deckyard's own palette — the forest green
 * and brass the logo mark and deckyard.eu already use. It is the one branded
 * theme; the other five built-ins are palette-named archetypes (`amethyst`,
 * `corporate`, `editorial`, `midnight`, `playful`) carrying the neutral
 * placeholder logo. A default that contradicts the product's own colours makes
 * every screenshot fight the page it sits on, so `brand` is the default and no
 * other built-in wears the mark. See docs/developer/themes.md § The built-in set.
 */
export const DEFAULT_THEME_SLUG = 'brand';

/**
 * Display name for the default theme.
 */
export const DEFAULT_THEME_NAME = 'Forest';
