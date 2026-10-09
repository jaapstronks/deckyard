import { createPresentation } from '../../../services/presentations.js';
import {
  loadDisabledSlideTypes,
  loadCustomSlideTypes,
} from '../../../utils/org-slide-types.js';
import { settleNewDeckTheme } from '../../../utils/themes.js';
import { createLogger } from '../../../utils/logger.js';

/** Shared logger for all AI route handlers. */
export const log = createLogger('ai');

/**
 * A dispatch context, forwarded verbatim to every AI route handler.
 *
 * @typedef {object} AiContext
 * @property {string} repoRoot
 * @property {import('http').IncomingMessage} req
 * @property {import('http').ServerResponse} res
 * @property {URL} url
 * @property {object|null} authedUser
 * @property {import('../../../storage/scope.js').StorageScope} storageScope
 */

/**
 * Load disabled and custom slide type context for the authenticated user's org.
 */
export async function loadSlideTypeContext(authedUser) {
  const [disabled, custom] = await Promise.all([
    loadDisabledSlideTypes(authedUser),
    loadCustomSlideTypes(authedUser),
  ]);
  return { disabled, custom };
}

/**
 * Extract theme context for AI generation.
 * Provides the AI with theme-specific information to make better content decisions.
 */
function extractThemeContext(theme) {
  if (!theme) return null;

  const ctx = {};

  // The theme's slide-background variants. Which grounds a slide can take is
  // decided per type (its `background` field joined with these), so the prompt
  // derives that offer itself; carrying the variants keeps the context present
  // for every theme, also one that only has the declared options.
  ctx.slideBackgrounds = Array.isArray(theme.slideBackgrounds)
    ? theme.slideBackgrounds
    : [];

  // Brand colors
  if (theme.brandColors?.length) {
    ctx.brandColors = theme.brandColors;
  }

  // Whether theme has background image presets
  if (theme.backgroundPresets?.length) {
    ctx.hasBackgroundImages = true;
  }

  return ctx;
}

/**
 * Settle the theme of a deck the AI is about to generate, and load its
 * title slide type and AI theme context. The theme is checked by the rule
 * every create runs (`settleNewDeckTheme`, B486), before the generation, so an
 * unknown theme is refused without an LLM call.
 *
 * The loaded theme comes back too: the AI routes normalize their generated deck
 * through `deckToPresentationParts`, and the slide factory behind it reads the
 * theme for background presets and slide-background variants. Returning it here
 * is what keeps them from loading the same theme a second time — or, as they
 * did before, composing their slides against no theme at all.
 *
 * @param {string} repoRoot
 * @param {unknown} requestedTheme - the theme the request named, or absent
 * @param {Object} [storageScope]
 * @returns {Promise<{ themeId: string, titleSlideType: string, themeContext: object|null, theme: object|null }>}
 * @throws {AppError} 400 `invalid`, `details.field` = `theme`
 */
export async function loadAiThemeContext(
  repoRoot,
  requestedTheme,
  storageScope = null,
) {
  const { themeId, theme } = await settleNewDeckTheme(
    repoRoot,
    requestedTheme,
    storageScope,
  );
  return {
    themeId,
    titleSlideType: theme?.defaultTitleSlide || 'title-slide',
    themeContext: theme ? extractThemeContext(theme) : null,
    theme,
  };
}

/**
 * Re-attach AI review metadata (reasoning + alternative types) to normalized
 * slides. deckToPresentationParts strips unknown slide keys, and both arrays
 * map 1:1 by index, so this restores what the pipeline produced.
 */
export function reattachAiMeta(normalizedSlides, sourceSlides) {
  (normalizedSlides || []).forEach((s, i) => {
    const src = sourceSlides?.[i];
    if (!src || !s || typeof s !== 'object') return;
    if (src._aiReasoning) s._aiReasoning = src._aiReasoning;
    if (Array.isArray(src._aiAlternatives) && src._aiAlternatives.length) {
      s._aiAlternatives = src._aiAlternatives;
    }
  });
}

/**
 * Create the deck an AI wizard generated, content and all, in one create.
 *
 * The wizards used to create an empty deck and then write the generated
 * slides into it with a second storage call, building the i18n block by hand
 * in between. `createPresentation` takes the slides itself: the factory seeds
 * the language version from them, re-keys their ids and instance keys against
 * the new deck and runs them through the write seam, so a refused slide
 * leaves no empty deck behind (B609).
 *
 * @param {import('../../../storage/scope.js').StorageScope} storageScope
 * @param {Object} input
 * @param {{ title: string, slides: Object[] }} input.parts - the generated
 *   deck as `deckToPresentationParts` normalized it
 * @param {string|null|undefined} input.lang - the deck language, or absent
 *   for the installation default
 * @param {Object} input.authedUser - the creating actor
 * @param {string} input.theme - the settled theme id
 * @param {Object} [input.settings]
 * @param {string} [input.notionSourcePageId]
 * @returns {Promise<Object>} The created presentation.
 */
export function createDeckFromParts(
  storageScope,
  { parts, lang, authedUser, theme, settings, notionSourcePageId },
) {
  return createPresentation(
    storageScope,
    { actor: authedUser },
    {
      title: parts.title,
      slides: parts.slides,
      theme,
      lang: lang || undefined,
      ...(settings ? { settings } : {}),
      ...(notionSourcePageId ? { notionSourcePageId } : {}),
    },
  );
}
