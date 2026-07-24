// UI i18n (application chrome / screens)
// - Default language is Dutch (nl).
// - Translations live in /client/i18n/<locale>/<component>.json (modular structure)
// - Component files: auth, common, editor, list, presenter, settings, share, slide-types
//
// Conventions:
// - Use stable keys: t('settings.title', 'Settings')
// - Keep fallbacks in English.
// - Use simple {var} interpolation: t('list.count', '{count} presentations', { count })

import { storage } from './storage.js';

const LS_UI_LOCALE = 'ps-ui-locale';
const DEFAULT_LOCALE = 'nl';

let currentLocale = DEFAULT_LOCALE;
let dict = Object.create(null);
let dictLoadedFor = null;
let manifestCache = null;

// Component files that make up the full translation dictionary
const I18N_COMPONENTS = ['auth', 'common', 'editor', 'list', 'presenter', 'settings', 'share', 'slide-types'];

export function normalizeUiLocale(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  // Conservative, safe subset of BCP-47-like tags to avoid path traversal and surprises.
  // Examples: en, nl, en-GB, pt-BR, zh-Hant
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(s)) return null;
  return s;
}

export function getUiLocale() {
  return currentLocale;
}

export function defaultUiLocale() {
  return DEFAULT_LOCALE;
}

export function readUiLocale() {
  const raw = storage.get(LS_UI_LOCALE, null);
  return normalizeUiLocale(raw) || DEFAULT_LOCALE;
}

export function writeUiLocale(locale) {
  const l = normalizeUiLocale(locale);
  if (!l) return;
  storage.set(LS_UI_LOCALE, l);
}

// Query-string keys that carry a UI-locale hint, in precedence order. Lets an
// external origin (e.g. deckyard.eu) deep-link into the app or the sandbox in a
// chosen language: `sandbox.deckyard.eu/?lang=en`.
const UI_LOCALE_PARAM_KEYS = ['lang', 'locale'];

/**
 * Read a normalized UI-locale hint from a URL query string. Returns the first
 * well-formed value among the recognized keys, or null when absent/malformed.
 * `search` defaults to the current `window.location.search`; pass it explicitly
 * (e.g. in tests) to parse an arbitrary query string.
 * @param {string} [search]
 * @returns {string|null}
 */
export function readUiLocaleParam(search) {
  let qs = search;
  if (qs == null) {
    try {
      qs = window.location.search;
    } catch {
      qs = '';
    }
  }
  let params;
  try {
    params = new URLSearchParams(qs || '');
  } catch {
    return null;
  }
  for (const key of UI_LOCALE_PARAM_KEYS) {
    const norm = normalizeUiLocale(params.get(key));
    if (norm) return norm;
  }
  return null;
}

/**
 * Resolve which locale to apply at first paint. A `?lang=`/`?locale=` URL param
 * wins over the stored preference *only* when it names a locale the manifest
 * knows (same bar as the settings picker), so a bogus tag can't blank the
 * dictionary. A valid param is persisted so it survives a reload within the
 * session. Otherwise the stored/default locale is used. Precedence:
 * URL param (known) > localStorage > default.
 *
 * For a logged-in user this is only the initial value: `app.js` still overrides
 * it with `mySettings.uiLocale` once settings load. The param therefore matters
 * chiefly for the anonymous sandbox session, which has no saved preference.
 * @param {string} [search]
 * @returns {Promise<string>}
 */
export async function resolveInitialUiLocale(search) {
  const param = readUiLocaleParam(search);
  if (param) {
    const manifest = await fetchUiLocaleManifest();
    const locales = Array.isArray(manifest?.locales) ? manifest.locales : [];
    const match = locales.find(
      (l) => String(l?.id || '').trim().toLowerCase() === param.toLowerCase()
    );
    if (match) {
      const id = String(match.id).trim();
      writeUiLocale(id);
      return id;
    }
  }
  return readUiLocale();
}

function interpolate(str, vars) {
  if (!vars || typeof vars !== 'object') return str;
  return String(str).replace(/\{([a-zA-Z0-9_]+)\}/g, (m, name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return m;
    return String(vars[name]);
  });
}

export function t(key, fallback, vars) {
  const k = String(key || '').trim();
  if (!k) return '';
  const has = dict && typeof dict === 'object' && typeof dict[k] === 'string';
  const raw = has
    ? dict[k]
    : typeof fallback === 'string'
      ? fallback
      : k;
  return interpolate(raw, vars);
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return res.json();
}

export async function fetchUiLocaleManifest() {
  if (manifestCache) return manifestCache;
  try {
    const data = await fetchJson('/client/i18n/manifest.json');
    manifestCache = data && typeof data === 'object' ? data : {};
    return manifestCache;
  } catch {
    manifestCache = {};
    return manifestCache;
  }
}

export async function setUiLocale(locale, { persist = true } = {}) {
  const next = normalizeUiLocale(locale) || DEFAULT_LOCALE;
  if (persist) writeUiLocale(next);
  const prev = currentLocale;
  currentLocale = next;

  try {
    document.documentElement.lang = next;
  } catch {
    // ignore
  }

  // If nothing changes and we've already loaded this locale, avoid churn and rerender loops.
  if (prev === next && dictLoadedFor === next) return;

  // Load all component files in parallel and merge them into one dictionary
  const merged = Object.create(null);
  const basePath = `/client/i18n/${encodeURIComponent(next)}`;

  try {
    const results = await Promise.allSettled(
      I18N_COMPONENTS.map((comp) => fetchJson(`${basePath}/${comp}.json`))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value && typeof result.value === 'object') {
        Object.assign(merged, result.value);
      }
    }
  } catch {
    // ignore
  }

  dict = merged;
  dictLoadedFor = next;

  try {
    // Only notify when the locale changes; otherwise we risk render loops.
    if (prev !== next) {
      window.dispatchEvent(
        new CustomEvent('ui-locale-changed', { detail: { locale: next } })
      );
    }
  } catch {
    // ignore
  }
}
