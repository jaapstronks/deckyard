/**
 * Server-side i18n for emails and API responses.
 * Mirrors the client-side ui-i18n.js pattern.
 *
 * Usage:
 *   import { t, setLocale, getLocale } from './i18n/index.js';
 *   const msg = t('email.passwordReset.subject', 'Reset your password');
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_LOCALE = 'en';
const SUPPORTED_LOCALES = ['en', 'nl', 'de', 'fr', 'es', 'pt', 'da', 'sv', 'no'];

// Cache for loaded translations
const translationCache = new Map();

// Current locale (can be set per-request in a real app, here we use a default)
let currentLocale = DEFAULT_LOCALE;

/**
 * Normalize locale string.
 * @param {string} locale - Locale string
 * @returns {string|null} Normalized locale or null if invalid
 */
function normalizeLocale(locale) {
  const s = String(locale || '').trim().toLowerCase();
  if (!s) return null;
  // Handle full locale codes like 'en-GB' -> 'en'
  const base = s.split('-')[0];
  if (SUPPORTED_LOCALES.includes(base)) return base;
  return null;
}

/**
 * Load translations for a locale.
 * @param {string} locale - Locale to load
 * @returns {Object} Translation dictionary
 */
function loadTranslations(locale) {
  const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;

  if (translationCache.has(normalized)) {
    return translationCache.get(normalized);
  }

  try {
    const filePath = join(__dirname, 'locales', `${normalized}.json`);
    const content = readFileSync(filePath, 'utf8');
    const translations = JSON.parse(content);
    translationCache.set(normalized, translations);
    return translations;
  } catch {
    // Fall back to English if locale file not found
    if (normalized !== DEFAULT_LOCALE) {
      return loadTranslations(DEFAULT_LOCALE);
    }
    // Return empty object if even English fails
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

  const useLocale = locale ? (normalizeLocale(locale) || currentLocale) : currentLocale;
  const dict = loadTranslations(useLocale);

  const has = dict && typeof dict === 'object' && typeof dict[k] === 'string';
  const raw = has ? dict[k] : (typeof fallback === 'string' ? fallback : k);

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

