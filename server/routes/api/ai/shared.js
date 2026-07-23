import {
  createPresentation,
  updatePresentation,
} from '../../../storage/presentations.js';
import {
  loadDisabledSlideTypes,
  loadCustomSlideTypes,
} from '../../../utils/org-slide-types.js';
import { loadTheme, resolveThemeId } from '../../../utils/themes.js';
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
export function extractThemeContext(theme) {
  if (!theme) return null;

  const ctx = {};

  // Available slide background options (lime, mist, dark are standard)
  const bgOptions = [];
  const vars = theme.cssVars || {};
  if (vars['--t-slide-bg-lime']) bgOptions.push('lime');
  if (vars['--t-slide-bg-mist']) bgOptions.push('mist');
  if (vars['--t-slide-bg-dark']) bgOptions.push('dark');
  if (bgOptions.length) ctx.backgroundOptions = bgOptions;

  // Brand colors
  if (theme.brandColors?.length) {
    ctx.brandColors = theme.brandColors;
  }

  // Whether theme has background image presets
  if (theme.backgroundPresets?.length) {
    ctx.hasBackgroundImages = true;
  }

  return Object.keys(ctx).length ? ctx : null;
}

/**
 * Load the theme-appropriate title slide type and AI theme context for a deck.
 * Loading failures fall back to the default title slide with no theme context.
 *
 * @param {string} repoRoot
 * @param {string} effectiveTheme
 * @returns {Promise<{ titleSlideType: string, themeContext: object|null }>}
 */
export async function loadAiThemeContext(repoRoot, effectiveTheme) {
  let titleSlideType = 'title-slide';
  let themeContext = null;
  try {
    const themeId = resolveThemeId(effectiveTheme);
    const theme = await loadTheme(repoRoot, themeId);
    titleSlideType = theme?.defaultTitleSlide || 'title-slide';
    themeContext = extractThemeContext(theme);
  } catch {
    // ignore theme loading errors, use default
  }
  return { titleSlideType, themeContext };
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
 * Create a presentation and initialize its i18n structure with the generated slides.
 * Consolidates the repeated create→update-with-i18n pattern used across wizard endpoints.
 */
export async function createPresentationWithI18n(
  repoRoot,
  { parts, lang, authedUser, theme, settings, notionSourcePageId }
) {
  const created = await createPresentation(repoRoot, {
    title: parts.title,
    theme,
    ownerEmail: authedUser?.email || null,
    lang: lang || undefined,
    ...(settings ? { settings } : {}),
    ...(notionSourcePageId ? { notionSourcePageId } : {}),
  });

  const activeLang =
    created?.i18n?.active || created?.i18n?.dominant || lang || 'nl';
  const updatedI18n = {
    ...created.i18n,
    versions: {
      ...created.i18n?.versions,
      [activeLang]: {
        title: parts.title,
        slides: parts.slides,
      },
    },
  };

  return updatePresentation(repoRoot, created.id, {
    ...created,
    title: parts.title,
    slides: parts.slides,
    i18n: updatedI18n,
  });
}
