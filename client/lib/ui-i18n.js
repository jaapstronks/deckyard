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

// A `?lang=` URL param names an explicit, per-session UI locale. When
// present and valid it takes priority over the stored/server preference for the
// whole SPA session. Set once by resolveInitialUiLocale() at bootstrap; its
// consumers (app.js render, settings preferences tab) read it back to keep the
// URL's choice winning over a saved preference for the session.
let sessionParamLocale = null;

/**
 * The per-session UI-locale override from a `?lang=` URL param, or
 * null when the session was not deep-linked with a valid locale. Lets callers
 * give the URL param priority over a stored server preference — chiefly the
 * sandbox guest, whose default `uiLocale` is English and would otherwise clobber
 * `?lang=nl`.
 * @returns {string|null}
 */
export function getSessionLocaleOverride() {
  return sessionParamLocale;
}

/**
 * Drop the per-session URL-param override. An explicit in-session locale save
 * supersedes the deep-link param, so the stored preference regains authority
 * for the rest of the session (a reload with the param still in the URL
 * re-establishes it via resolveInitialUiLocale).
 */
export function clearSessionLocaleOverride() {
  sessionParamLocale = null;
}

// Component files that make up the full translation dictionary — the `ui`-loader
// modules in client/i18n/manifest.json. Kept as a literal rather than read from
// the manifest so a failed manifest fetch degrades the language *picker* only,
// never the dictionary itself; tests/i18n-locales.test.js pins the two lists
// against each other so they cannot drift.
export const I18N_COMPONENTS = [
  'auth',
  'common',
  'editor',
  'list',
  'presenter',
  'settings',
  'share',
  'slide-types',
];

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

function readUiLocale() {
  const raw = storage.get(LS_UI_LOCALE, null);
  return normalizeUiLocale(raw) || DEFAULT_LOCALE;
}

function writeUiLocale(locale) {
  const l = normalizeUiLocale(locale);
  if (!l) return;
  storage.set(LS_UI_LOCALE, l);
}

// The query-string key that carries a UI-locale hint. Lets an external origin
// (e.g. deckyard.eu) deep-link into the app or the sandbox in a chosen
// language: `sandbox.deckyard.eu/?lang=en`. `lang` is the only spelling.
const UI_LOCALE_PARAM_KEY = 'lang';

/**
 * Read a normalized UI-locale hint from a URL query string. Returns the
 * well-formed `?lang=` value, or null when absent/malformed.
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
  return normalizeUiLocale(params.get(UI_LOCALE_PARAM_KEY));
}

/**
 * Resolve which locale to apply at first paint. A `?lang=` URL param
 * wins over the stored preference *only* when it names a locale the manifest
 * knows (same bar as the settings picker), so a bogus tag can't blank the
 * dictionary. A valid param is persisted so it survives a reload within the
 * session, and recorded as the session override (see getSessionLocaleOverride)
 * so it also outranks the server-side `uiLocale` once settings load. Otherwise
 * the stored/default locale is used. Precedence:
 * URL param (known) > server preference > localStorage > default.
 *
 * The URL param therefore takes priority for the whole session — chiefly the
 * sandbox guest, whose default `uiLocale` is English and would otherwise clobber
 * a deep-linked `?lang=nl`. An unknown/malformed value is silently ignored.
 * @param {string} [search]
 * @returns {Promise<string>}
 */
export async function resolveInitialUiLocale(search) {
  sessionParamLocale = null;
  const param = readUiLocaleParam(search);
  if (param) {
    const manifest = await fetchUiLocaleManifest();
    const locales = Array.isArray(manifest?.locales) ? manifest.locales : [];
    const match = locales.find(
      (l) =>
        String(l?.id || '')
          .trim()
          .toLowerCase() === param.toLowerCase(),
    );
    if (match) {
      const id = String(match.id).trim();
      sessionParamLocale = id;
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
  const raw = has ? dict[k] : typeof fallback === 'string' ? fallback : k;
  return interpolate(raw, vars);
}

async function fetchJson(url) {
  // Static locale JSON from /client/i18n/ — an asset load, not an /api/*
  // call (and this module sits below api() in the layering).
  // eslint-disable-next-line no-restricted-syntax
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
      I18N_COMPONENTS.map((comp) => fetchJson(`${basePath}/${comp}.json`)),
    );

    for (const result of results) {
      if (
        result.status === 'fulfilled' &&
        result.value &&
        typeof result.value === 'object'
      ) {
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
        new CustomEvent('ui-locale-changed', { detail: { locale: next } }),
      );
    }
  } catch {
    // ignore
  }
}
