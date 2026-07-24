/**
 * Utility functions for Notion API handlers.
 * Text analysis and keyword extraction helpers.
 */

import { badRequest, jsonError } from '../../../utils/http.js';

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
  'de', 'het', 'een', 'en', 'of', 'voor', 'van', 'met', 'op', 'aan',
  'in', 'bij', 'naar', 'over', 'door',
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'with',
  'on', 'at', 'by', 'from', 'about',
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
  const paras = t.split(/\n\s*\n/g).map((p) => p.trim()).filter(Boolean);
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
 * Handle common Notion API errors with user-friendly messages.
 * @param {Error} error - Error from Notion API
 * @param {Object} res - HTTP response object
 * @returns {boolean} True if error was handled
 */
export function handleNotionError(error, res) {
  const msg = String(error?.message || error || 'Unknown error');
  const code = error?.statusCode || 500;

  // Helpful error messages for common Notion API errors
  if (msg.includes('Could not find') || code === 404) {
    badRequest(res, 'Page not found. Make sure the page is shared with your Notion integration.');
    return true;
  }
  if (msg.includes('unauthorized') || code === 401 || code === 403) {
    badRequest(res, 'Access denied. Make sure the page is shared with your Notion integration.');
    return true;
  }

  jsonError(res, code >= 400 && code < 600 ? code : 500, 'notion_error', msg);
  return true;
}