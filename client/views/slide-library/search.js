/**
 * Language helpers for slide-library items. Searching, filtering and ordering
 * a shelf is the server's (B822, server/storage/slide-library.js).
 */

import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../shared/i18n-utils.js';

/**
 * Get content for a specific language from a slide library item.
 * Falls back to the default content if the language version doesn't exist.
 * @param {Object} item
 * @param {string} lang
 * @returns {Object}
 */
export function getContentForLang(item, lang) {
  const l = normalizeLang(lang);
  if (l && item?.i18n?.versions?.[l]?.content) {
    return item.i18n.versions[l].content;
  }
  // Fallback to default content
  return item?.content || {};
}

/**
 * The language `item.content` is written in.
 *
 * `getContentForLang()` answers "which content for this language"; this is the
 * other direction — "which language is this content". The two are a pair: a
 * surface that renders `item.content` (the base version, what the edit modal
 * shows) must tell the slide renderer
 * which language that is, or the built-in copy of an interactive type falls
 * back to `DEFAULT_SLIDE_COPY_LANG` (`docs/reference/slide-copy-language.md`).
 *
 * Answers `null` rather than guessing when the item names no language, exactly
 * as `resolveDeckLang()` does for a deck.
 *
 * @param {Object} item
 * @returns {string|null}
 */
export function contentLang(item) {
  return normalizeLang(item?.i18n?.dominant) || null;
}

/**
 * Check if an item has content for a specific language.
 * @param {Object} item
 * @param {string} lang
 * @returns {boolean}
 */
export function hasContentForLang(item, lang) {
  const l = normalizeLang(lang);
  if (!l) return false;
  // If item has i18n versions, check if the requested lang exists
  if (item?.i18n?.versions?.[l]?.content) return true;
  // If no i18n, assume it's in the item's dominant language, else the default.
  return l === (normalizeLang(item?.i18n?.dominant) || DEFAULT_DECK_LANG);
}
