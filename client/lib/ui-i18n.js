// UI i18n (application chrome / screens)
// - Default language is DEFAULT_UI_LOCALE (`en`, shared with the server).
// - Pages without a session (share link, follow, /go) resolve their language
//   through resolveViewerUiLocale(): the visitor's deck, then browser (D322).
// - Translations live in /client/i18n/<locale>/<component>.json (modular structure)
// - Component files: auth, common, editor, list, presenter, settings, share, slide-types
//
// Conventions:
// - Use stable keys: t('settings.title', 'Settings')
// - Keep fallbacks in English.
// - Use simple {var} interpolation: t('editor.remoteMerge.slideN', 'Slide {n}', { n })
// - Counted nouns pass both forms: t('list.section.count', { one: '1 presentation', many: '{count} presentations' }, { count })

import { storage } from './storage.js';
import { queryString } from './state/router.js';
import { DEFAULT_UI_LOCALE } from '../../shared/constants/ui-locale.js';

const LS_UI_LOCALE = 'ps-ui-locale';

let currentLocale = DEFAULT_UI_LOCALE;
let dict = Object.create(null);
let dictLoadedFor = null;
let manifestCache = null;

// A `?locale=` URL param names an explicit, per-session UI locale. When
// present and valid it takes priority over the stored/server preference for the
// whole SPA session. Set once by resolveInitialUiLocale() at bootstrap; its
// consumers (app.js render, settings preferences tab) read it back to keep the
// URL's choice winning over a saved preference for the session.
let sessionParamLocale = null;

// "The whole session" outlives one document: a reload drops the param from the
// URL, and the Present popup is a new document opened with `window.open`. Both
// started with `sessionParamLocale = null`, so the sandbox guest's server
// default (`en`) won again — editor Dutch, presenter window English (B357). The
// override is therefore mirrored into sessionStorage, which survives a reload
// and which a `window.open` child inherits from its opener, and read back when
// a document starts without the param. A `noopener` popup does not inherit
// sessionStorage; its opener hands the override over on the URL instead
// (`withSessionLocaleParam()`).
const SS_UI_LOCALE_SESSION = 'ps-ui-locale-session';

function readSessionLocaleRecord() {
  try {
    return normalizeUiLocale(sessionStorage.getItem(SS_UI_LOCALE_SESSION));
  } catch {
    return null;
  }
}

function writeSessionLocaleRecord(locale) {
  try {
    if (locale) sessionStorage.setItem(SS_UI_LOCALE_SESSION, locale);
    else sessionStorage.removeItem(SS_UI_LOCALE_SESSION);
    /* eslint-disable-next-line no-restricted-syntax -- No sessionStorage (blocked storage, a bare test): nothing to record and nothing lost but the cross-document carry; the override still holds for this document. */
  } catch {
    // See the disable above.
  }
}

/**
 * The per-session UI-locale override from a `?locale=` URL param, or
 * null when the session was not deep-linked with a valid locale. Lets callers
 * give the URL param priority over a stored server preference — chiefly the
 * sandbox guest, whose default `uiLocale` is English and would otherwise clobber
 * `?locale=nl`.
 * @returns {string|null}
 */
export function getSessionLocaleOverride() {
  return sessionParamLocale;
}

/**
 * Carry the session's UI-locale override onto a URL that opens a new window.
 *
 * A popup opened with `noopener` (the Present window) gets a fresh
 * sessionStorage, not a copy of the opener's, so the override would not reach
 * it; naming it as `?locale=` on the URL hands it over explicitly, and the new
 * document records it for itself. No-op without an override.
 *
 * @param {URL} url - mutated in place
 * @returns {URL}
 */
export function withSessionLocaleParam(url) {
  if (sessionParamLocale && url?.searchParams) {
    url.searchParams.set(UI_LOCALE_PARAM_KEY, sessionParamLocale);
  }
  return url;
}

/**
 * Drop the per-session URL-param override. An explicit in-session locale save
 * supersedes the deep-link param, so the stored preference regains authority
 * for the rest of the session (a reload with the param still in the URL
 * re-establishes it via resolveInitialUiLocale).
 */
export function clearSessionLocaleOverride() {
  sessionParamLocale = null;
  writeSessionLocaleRecord(null);
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

/** The saved interface preference, or null when this browser has none. */
function readStoredUiLocale() {
  return normalizeUiLocale(storage.get(LS_UI_LOCALE, null));
}

function writeUiLocale(locale) {
  const l = normalizeUiLocale(locale);
  if (!l) return;
  storage.set(LS_UI_LOCALE, l);
}

// The query-string key that carries a UI-locale hint. Lets an external origin
// (e.g. deckyard.eu) deep-link into the app or the sandbox in a chosen
// interface language: `sandbox.deckyard.eu/?locale=en`.
//
// It used to be `lang`, shared with the deck-language axis — one key, two
// vocabularies, validated against two different lists by seven different
// modules. `?lang=nl` was valid in both, so a shared editor link set the deck
// language *and* switched the recipient's entire interface to Dutch, while
// `?lang=en-GB` was silently dropped here because the manifest keys English
// `en`. D61 split them: `?lang=` stays the deck language (the older meaning,
// and the one already inside shared links), the interface moved here. `?ui=`
// was the first proposal and was rejected — `?ui=min` already means something
// else.
const UI_LOCALE_PARAM_KEY = 'locale';

/**
 * Read a normalized UI-locale hint from a URL query string. Returns the
 * well-formed `?locale=` value, or null when absent/malformed.
 * `search` defaults to the router's view of the current query string; pass it
 * explicitly (e.g. in tests) to parse an arbitrary query string.
 * @param {string} [search]
 * @returns {string|null}
 */
export function readUiLocaleParam(search) {
  let qs = search;
  if (qs == null) qs = queryString();
  let params;
  try {
    params = new URLSearchParams(qs || '');
  } catch {
    return null;
  }
  return normalizeUiLocale(params.get(UI_LOCALE_PARAM_KEY));
}

/**
 * Resolve which locale to apply at first paint. A `?locale=` URL param
 * wins over the stored preference *only* when it names a locale the manifest
 * knows (same bar as the settings picker), so a bogus tag can't blank the
 * dictionary. A valid param is persisted so it survives a reload within the
 * session, and recorded as the session override (see getSessionLocaleOverride)
 * so it also outranks the server-side `uiLocale` once settings load. Otherwise
 * the stored/default locale is used. Precedence:
 * URL param (known) > the session's recorded param (sessionStorage) > server
 * preference > localStorage > DEFAULT_UI_LOCALE.
 *
 * The URL param therefore takes priority for the whole session — chiefly the
 * sandbox guest, whose default `uiLocale` is English and would otherwise clobber
 * a deep-linked `?locale=nl`. An unknown/malformed value is silently ignored.
 * @param {string} [search]
 * @returns {Promise<string>}
 */
export async function resolveInitialUiLocale(search) {
  return (await resolveChosenUiLocale(search)) || DEFAULT_UI_LOCALE;
}

/**
 * The locale someone chose, or null when nobody did: a manifest-known
 * `?locale=` (recorded as the session override), the override recorded
 * earlier in the session, or the saved preference. The shared head of
 * resolveInitialUiLocale() and resolveViewerUiLocale(); they differ only in
 * what they derive when this is null.
 * @param {string} [search]
 * @returns {Promise<string|null>}
 */
async function resolveChosenUiLocale(search) {
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
      writeSessionLocaleRecord(id);
      writeUiLocale(id);
      return id;
    }
  }
  // No (valid) param on this document: an override recorded earlier in the
  // session — before a reload, or in the window that opened this one — still
  // holds.
  const recorded = readSessionLocaleRecord();
  if (recorded) {
    sessionParamLocale = recorded;
    return recorded;
  }
  return readStoredUiLocale();
}

/**
 * The manifest id a language tag lands on, or null: the exact id (any case),
 * else the id of its primary subtag, so the deck axis's `en-GB` and a
 * browser's `pt-BR` both find the manifest's `en` and `pt`.
 * @param {string} tag
 * @param {string[]} known - manifest locale ids
 * @returns {string|null}
 */
export function matchUiLocale(tag, known) {
  const s = normalizeUiLocale(tag)?.toLowerCase();
  if (!s) return null;
  const ids = (known || []).map((id) => String(id || '').trim());
  const exact = ids.find((id) => id.toLowerCase() === s);
  if (exact) return exact;
  const primary = s.split('-')[0];
  return ids.find((id) => id.toLowerCase() === primary) || null;
}

/**
 * The interface language of a page without a session (D322), as a pure
 * decision: a chosen locale wins; then the deck's language, because the
 * chrome belongs with the content on screen; then the first browser
 * language the manifest knows; then DEFAULT_UI_LOCALE.
 * @param {{ chosen?: string|null, deckLang?: string|null,
 *   browserLangs?: readonly string[], known?: string[] }} input
 * @returns {string}
 */
export function pickViewerUiLocale({
  chosen = null,
  deckLang = null,
  browserLangs = [],
  known = [],
} = {}) {
  if (chosen) return chosen;
  const fromDeck = deckLang ? matchUiLocale(deckLang, known) : null;
  if (fromDeck) return fromDeck;
  for (const tag of browserLangs || []) {
    const match = matchUiLocale(tag, known);
    if (match) return match;
  }
  return DEFAULT_UI_LOCALE;
}

function readBrowserLangs() {
  try {
    const nav = globalThis.navigator;
    if (Array.isArray(nav?.languages) && nav.languages.length) {
      return nav.languages;
    }
    return nav?.language ? [nav.language] : [];
  } catch {
    return [];
  }
}

/**
 * Resolve the interface language for a page a visitor reaches without a
 * session: the share viewer, follow-along and `/go` (D322). See
 * pickViewerUiLocale() for the order. The derived language is never written
 * to localStorage — one visited share link must not set the language of the
 * app shell for later.
 * @param {{ deckLang?: string|null, search?: string,
 *   browserLangs?: readonly string[] }} [options]
 * @returns {Promise<string>}
 */
export async function resolveViewerUiLocale({
  deckLang = null,
  search,
  browserLangs = readBrowserLangs(),
} = {}) {
  const chosen = await resolveChosenUiLocale(search);
  if (chosen) return chosen;
  const manifest = await fetchUiLocaleManifest();
  const known = Array.isArray(manifest?.locales)
    ? manifest.locales.map((l) => l?.id)
    : [];
  return pickViewerUiLocale({ deckLang, browserLangs, known });
}

/**
 * Put a viewer page in its resolved language before it builds its chrome.
 * Quiet: the page is about to render in it, so no `ui-locale-changed`
 * (which would make the router mount the page a second time).
 * @param {{ deckLang?: string|null }} [options]
 * @returns {Promise<string>} the applied locale
 */
export async function applyViewerUiLocale({ deckLang = null } = {}) {
  const locale = await resolveViewerUiLocale({ deckLang });
  await setUiLocale(locale, { persist: false, announce: false });
  return locale;
}

function interpolate(str, vars) {
  if (!vars || typeof vars !== 'object') return str;
  return String(str).replace(/\{([a-zA-Z0-9_]+)\}/g, (m, name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return m;
    return String(vars[name]);
  });
}

// One Intl.PluralRules per locale; PluralRules construction is not free and
// t() runs on every render.
const pluralRulesCache = new Map();

/**
 * The plural form a count takes in a locale, folded onto the two suffixes the
 * dictionaries carry: `one` where the language's rules say so, `many` for
 * every other category (`other`, `few`, `zero`, …). Two forms are what the
 * Tier-1 locales need; a language with more keeps its richer `many` wording
 * until a third suffix earns its place.
 *
 * @param {string} locale
 * @param {number} count
 * @returns {'one'|'many'}
 */
export function pluralForm(locale, count) {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules('en');
    }
    pluralRulesCache.set(locale, rules);
  }
  return rules.select(Number(count)) === 'one' ? 'one' : 'many';
}

/**
 * Translate a UI string.
 *
 * `fallback` is the English the call site renders when the dictionary lacks
 * the key (D73: an untranslated key is absent). A **plural** key passes it as
 * `{ one, many }` and a numeric `vars.count`: the form is chosen with
 * `pluralForm()` on the UI locale and looked up as `<key>.one` / `<key>.many`.
 * A locale without that form gets the English of the same form, never the
 * other form of its own — Swedish `1 presentation` is absent from `sv/`
 * because it equals the English (B617, D73), and its `many` would render
 * "1 presentationer".
 *
 * @param {string} key
 * @param {string|{ one: string, many: string }} [fallback]
 * @param {Record<string, unknown>} [vars]
 * @returns {string}
 */
export function t(key, fallback, vars) {
  const k = String(key || '').trim();
  if (!k) return '';
  if (fallback && typeof fallback === 'object') {
    const form = pluralForm(currentLocale, vars?.count);
    const value = dict[`${k}.${form}`];
    const raw = typeof value === 'string' ? value : fallback[form];
    return interpolate(typeof raw === 'string' ? raw : `${k}.${form}`, vars);
  }
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

/**
 * Switch the interface language and load its dictionary.
 * @param {string} locale
 * @param {{ persist?: boolean, announce?: boolean }} [options] - `persist`
 *   saves it as this browser's preference; `announce` fires
 *   `ui-locale-changed` (the app re-renders the route) when the locale changed.
 */
export async function setUiLocale(
  locale,
  { persist = true, announce = true } = {},
) {
  const next = normalizeUiLocale(locale) || DEFAULT_UI_LOCALE;
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
    if (announce && prev !== next) {
      window.dispatchEvent(
        new CustomEvent('ui-locale-changed', { detail: { locale: next } }),
      );
    }
  } catch {
    // ignore
  }
}
