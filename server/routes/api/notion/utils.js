/**
 * Utility functions for Notion API handlers.
 * Text analysis and keyword extraction helpers.
 */

import { jsonError, serveJson } from '../../../utils/http.js';
import { isAppError } from '../../../utils/errors.js';
import { createLogger } from '../../../utils/logger.js';
import { NOTION_NOT_CONFIGURED_MESSAGE } from '../../../utils/notion/index.js';

const log = createLogger('notion');

/**
 * Refuse a Notion route because the integration is switched off.
 *
 * Every Notion handler opens with `if (!notionEnabled()) return
 * refuseNotionUnconfigured(res);` — one 501, one `notion_not_configured` code,
 * one sentence (`NOTION_NOT_CONFIGURED_MESSAGE`). The sentence rides in
 * `message`, never in `details`: `details` is typed by the code (D78) and this
 * code carries no payload.
 *
 * @param {import('node:http').ServerResponse} res
 * @returns {true}
 */
export function refuseNotionUnconfigured(res) {
  return jsonError(
    res,
    501,
    'notion_not_configured',
    NOTION_NOT_CONFIGURED_MESSAGE,
  );
}

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
 * An `AppError` already says what it means in our own words: the seam
 * (`notionFetchJson`) decided a Notion refusal by its status (B416), and the
 * rest are our own refusals (`ValidationError`, the rate limiter). It is
 * answered as it is, status and code included. Everything that is not an
 * `AppError` is an internal failure whose message carries paths and module
 * layout; it is logged and the client gets a fixed `notion_error` 500
 * (js/stack-trace-exposure). Every Notion route ends its catch here - this is
 * the one handler, not a template to inline.
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
  serveJson(res, error.statusCode, error.toJSON());
  return true;
}
