/**
 * Server-side i18n for emails and API responses.
 * Mirrors the client-side ui-i18n.js pattern.
 *
 * Usage:
 *   import { t, createTranslator } from './i18n/index.js';
 *   const msg = t('email.passwordReset.subject', 'Reset your password');
 *   const tr = createTranslator('nl'); // bound to one recipient's locale
 *
 * There is no ambient "current locale": a process serves every recipient, so
 * the locale travels with the call. Outgoing mail gets it from
 * `resolveRecipientLocale()` (server/integrations/email/recipient-locale.js).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOCALES_DIR = join(__dirname, 'locales');

// Not exported: the *default* language is a policy shared with the client and
// is settled separately (D190/B380). This module owns only the question of
// which locales exist on disk.
const DEFAULT_LOCALE = 'en';

/**
 * The locales this server has strings for — **derived from the files in
 * `locales/`, never declared**. A hand-maintained list named nine languages
 * while the directory held two, so seven "supported" locales resolved every
 * key to its English fallback and the admin panel offered template tabs that
 * could not differ from English (B379). Adding `de.json` is now the whole act
 * of supporting German.
 *
 * The default locale leads; the rest follow alphabetically, so the admin
 * panel's tab order is stable across machines regardless of readdir order.
 *
 * @type {string[]}
 */
export const SUPPORTED_LOCALES = Object.freeze(
  readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort((a, b) => {
      if (a === DEFAULT_LOCALE) return -1;
      if (b === DEFAULT_LOCALE) return 1;
      return a.localeCompare(b);
    }),
);

// Cache for loaded translations
const translationCache = new Map();

/**
 * Narrow any locale tag to one this server has strings for.
 *
 * The one authority on "is this locale supported": callers that hold a stored
 * preference (`uiLocale` is a BCP-47-ish tag, so `en-GB` arrives here) run it
 * through this instead of testing {@link SUPPORTED_LOCALES} themselves.
 *
 * @param {string} locale - Locale string
 * @returns {string|null} Normalized locale or null if unsupported
 */
export function normalizeLocale(locale) {
  const s = String(locale || '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  // Handle full locale codes like 'en-GB' -> 'en'
  const base = s.split('-')[0];
  if (SUPPORTED_LOCALES.includes(base)) return base;
  return null;
}

/**
 * Load translations for an already-normalized locale.
 * @param {string} normalized - Supported locale code (see {@link normalizeLocale})
 * @returns {Object} Translation dictionary
 */
function loadTranslations(normalized) {
  if (translationCache.has(normalized)) {
    return translationCache.get(normalized);
  }

  try {
    const filePath = join(LOCALES_DIR, `${normalized}.json`);
    const content = readFileSync(filePath, 'utf8');
    const translations = JSON.parse(content);
    translationCache.set(normalized, translations);
    return translations;
  } catch {
    // The file exists — the list is read from the directory — so this is an
    // unreadable or malformed one. English still carries every key as a
    // fallback string in the `t()` call, so an empty dictionary degrades to
    // English copy rather than to key names.
    if (normalized !== DEFAULT_LOCALE) {
      return loadTranslations(DEFAULT_LOCALE);
    }
    return {};
  }
}

/**
 * Interpolate variables into a string.
 * @param {string} str - String with {var} placeholders
 * @param {Object} vars - Variables to interpolate
 * @returns {string} Interpolated string
 */
function interpolate(str, vars) {
  if (!vars || typeof vars !== 'object') return str;
  return String(str).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return match;
    return String(vars[name]);
  });
}

/**
 * Translate a key with optional fallback and variables.
 * @param {string} key - Translation key (e.g., 'email.passwordReset.subject')
 * @param {string} [fallback] - Fallback text if key not found
 * @param {Object} [vars] - Variables for interpolation
 * @param {string} [locale] - Override locale (optional)
 * @returns {string} Translated string
 */
export function t(key, fallback, vars, locale) {
  const k = String(key || '').trim();
  if (!k) return '';

  const useLocale = normalizeLocale(locale) || DEFAULT_LOCALE;
  const dict = loadTranslations(useLocale);

  const has = dict && typeof dict === 'object' && typeof dict[k] === 'string';
  const raw = has ? dict[k] : typeof fallback === 'string' ? fallback : k;

  return interpolate(raw, vars);
}

/**
 * Create a translator bound to a specific locale.
 * Useful for per-request locale handling.
 * @param {string} locale - Locale to bind
 * @returns {Function} Bound translate function
 */
export function createTranslator(locale) {
  const boundLocale = normalizeLocale(locale) || DEFAULT_LOCALE;
  return (key, fallback, vars) => t(key, fallback, vars, boundLocale);
}
