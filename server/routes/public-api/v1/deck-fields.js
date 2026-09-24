/**
 * Public API v1 - the deck's theme and language fields (B446).
 *
 * A deck's theme and language have one name each on every surface: `theme`
 * and `lang`, the names storage, the deck export and the MCP tools use. The
 * v1 docs used to say `themeId`/`language` while create read `theme`/`lang`,
 * so a client that followed the docs got the default theme and language
 * without a word. The retired spellings are refused with the name to use
 * instead, never accepted beside the canonical one.
 */

import { normalizeLang } from '../../../../shared/i18n-utils.js';
import { findTheme } from '../../../utils/themes.js';
import { apiError } from './middleware.js';

/** Retired spelling → the one name the field has. */
const RETIRED_DECK_FIELDS = Object.freeze({
  themeId: 'theme',
  language: 'lang',
});

/**
 * Refuse a body that names a deck field by a retired spelling.
 * @param {Object} ctx - v1 request context
 * @param {Object} body - parsed request body
 * @returns {Promise<boolean>} true when the request was refused (and answered)
 */
export async function refuseRetiredDeckFields(ctx, body) {
  for (const [retired, canonical] of Object.entries(RETIRED_DECK_FIELDS)) {
    if (Object.hasOwn(body, retired)) {
      await apiError(
        ctx,
        400,
        `Unknown field "${retired}": use "${canonical}"`,
        { details: { field: retired, use: canonical } },
      );
      return true;
    }
  }
  return false;
}

/**
 * Refuse a `lang` that is not a supported deck language. An unsupported tag
 * used to fall back to the default language without a word.
 * @param {Object} ctx - v1 request context
 * @param {Object} body - parsed request body
 * @returns {Promise<boolean>} true when the request was refused (and answered)
 */
export async function refuseUnsupportedLang(ctx, body) {
  if (body.lang === undefined || normalizeLang(body.lang)) return false;
  await apiError(ctx, 400, `Unsupported lang: ${JSON.stringify(body.lang)}`, {
    details: { field: 'lang' },
  });
  return true;
}

/**
 * Refuse a `theme` this instance does not have. An unknown theme used to be
 * stored as named and then drawn as the default.
 * @param {Object} ctx - v1 request context
 * @param {Object} body - parsed request body
 * @returns {Promise<boolean>} true when the request was refused (and answered)
 */
export async function refuseUnknownTheme(ctx, body) {
  if (body.theme === undefined) return false;
  const theme = await findTheme(ctx.repoRoot, body.theme, ctx.storageScope);
  if (theme) return false;
  await apiError(ctx, 400, `Theme not found: ${JSON.stringify(body.theme)}`, {
    details: { field: 'theme' },
  });
  return true;
}
