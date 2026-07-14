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
