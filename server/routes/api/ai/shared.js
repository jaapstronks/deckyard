import { createPresentation } from '../../../services/presentations.js';
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
