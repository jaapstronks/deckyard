/**
 * Utility functions for Notion API handlers.
 * Text analysis and keyword extraction helpers.
 */

import { badRequest, jsonError } from '../../../utils/http.js';
import { isAppError } from '../../../utils/errors.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('notion');

/**
 * Normalize a name string for comparison.
 * @param {string} s - Input string
 * @returns {string} Normalized string
 */
export function normName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Stop words to filter out during keyword extraction.
 */
const STOP_WORDS = new Set([
  // NL + EN (very small; just for keyword extraction heuristics)
  'de',
  'het',
  'een',
  'en',
  'of',
  'voor',
  'van',
  'met',
  'op',
  'aan',
  'in',
  'bij',
  'naar',
  'over',
  'door',
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'in',
  'for',
  'with',
  'on',
  'at',
  'by',
  'from',
  'about',
]);

/**
 * Extract keywords from a title string.
 * @param {string} title - Title to extract keywords from
 * @returns {string[]} Array of keywords
 */
export function extractKeywordsFromTitle(title) {
  const t = String(title || '')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\u00C0-\u024F]+/gi, ' ')
    .trim();
  const parts = t.split(/\s+/g).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.length < 4) continue;
    if (STOP_WORDS.has(p)) continue;
    if (out.includes(p)) continue;
    out.push(p);
  }
  return out;
}

/**
 * Pick the first keyword from a page title.
 * @param {Object} p - Page object with title property
 * @returns {string} First keyword or empty string
 */
export function pickKeywordForPage(p) {
  const title = String(p?.title || '').trim();
  const kws = extractKeywordsFromTitle(title);
  return kws[0] || '';
}

/**
 * Check if text looks like a usable document for conversion.
 * @param {string} text - Text content to check
 * @returns {boolean} True if text appears to be a usable document
 */
export function looksLikeUsableDoc(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  // Must have at least 2 "paragraph-ish" chunks and some minimum length.
  const paras = t
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);
  const charCount = t.replace(/\s+/g, ' ').trim().length;
  // Either:
  // - multiple paragraphs with a moderate amount of text, or
  // - one big chunk of text.
  if (charCount >= 700) return true;
  if (charCount < 300) return false;
  if (paras.length < 2) return false;
  return true;
}

/**
 * Turn a thrown Notion failure into the canonical error envelope.
 *
 * The Notion client throws `AppError`s — upstream status + Notion's own
 * message (`notionFetchJson`), or a `ValidationError` for bad input — and those
 * are the contract: a "not found"/"unauthorized" gets the shared-with-the-
 * integration hint, anything else passes through with its status and message.
 * Everything that is not an `AppError` is an internal failure whose message
 * carries paths and module layout; it is logged and the client gets a fixed
 * `notion_error` 500 (js/stack-trace-exposure). Every Notion route ends its
 * catch here — this is the one handler, not a template to inline.
 *
 * @param {Error} error - Error from the Notion flow
 * @param {Object} res - HTTP response object
 * @returns {true}
 */
export function handleNotionError(error, res) {
  if (!isAppError(error)) {
    log.error('Notion request failed:', error);
    return jsonError(res, 500, 'notion_error', 'Notion request failed');
  }
  const msg = String(error.message || '');
  const code = error.statusCode;

  // Helpful error messages for common Notion API errors
  if (msg.includes('Could not find') || code === 404) {
    return badRequest(
      res,
      'Notion page not found. Make sure the page is shared with your Notion integration.',
    );
  }
  if (msg.includes('unauthorized') || code === 401 || code === 403) {
    return badRequest(
      res,
      'Access denied. Make sure the page is shared with your Notion integration.',
    );
  }

  return jsonError(
    res,
    code >= 400 && code < 600 ? code : 500,
    'notion_error',
    msg || 'Notion request failed',
  );
}
