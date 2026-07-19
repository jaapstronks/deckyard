import { DEFAULT_THEME_ID } from '../../shared/constants/themes.js';
import { THEMES as BUILTIN_THEMES } from '../../shared/slide-types/registry.js';
import { slideBackgroundsCssText } from '../../shared/theme-slide-backgrounds.js';
import { normalizeTheme } from '../../shared/theme-normalize.js';

function safeThemeId(raw) {
  const s = String(raw || '').trim();
  if (!s) return DEFAULT_THEME_ID;
  if (s === 'default') return DEFAULT_THEME_ID;
  // Allow UUIDs (36 chars) and short slug IDs
  if (!/^[a-z0-9-]{1,40}$/i.test(s)) return DEFAULT_THEME_ID;
  return s.toLowerCase();
}

// Themes are per-presentation; do not treat the app as having a single "active theme".
// We keep a small client-side cache for rendering slide previews, presenter, and follow views.
const themeCache = new Map(); // id -> theme object
const inFlightRequests = new Map(); // id -> Promise (prevents duplicate fetches during race conditions)

export function normalizeThemeId(rawThemeId) {
  return safeThemeId(rawThemeId);
}

const fontStyleId = (key) => `theme-fonts-${key || 'unknown'}`;
const bgStyleId = (key) => `theme-slide-bgs-${key || 'unknown'}`;

// Editing a theme in one tab has to reach the others: an editor open on a deck
// keeps rendering the cached copy otherwise. BroadcastChannel is optional
// (older Safari, some embedded webviews), so guard it — losing cross-tab
// refresh is a smaller failure than throwing during module load.
const THEME_CHANNEL = 'deckyard-theme';
let themeChannel = null;
try {
  if (typeof BroadcastChannel === 'function') {
    themeChannel = new BroadcastChannel(THEME_CHANNEL);
    // In Node (test runs) a BroadcastChannel is an active handle that keeps the
    // event loop alive, so importing this module would hang the process on
    // exit. unref() lets the process end while the channel still delivers
    // messages whenever the loop is running; it's absent in the browser, where
    // there is nothing to unref, so the optional call is a no-op there.
    themeChannel.unref?.();
    themeChannel.onmessage = (event) => {
      const id = event?.data?.themeId;
      if (event?.data?.type !== 'theme-changed') return;
      dropTheme(id ? safeThemeId(id) : null);
    };
  }
} catch {
  themeChannel = null;
}

/** Drop a cached theme (or all of them) plus the style elements it injected. */
function dropTheme(id) {
  const keys = id ? [id] : [...themeCache.keys()];
  for (const key of keys) {
    themeCache.delete(key);
    // A fetch already in flight would repopulate the cache with the copy we are
    // trying to discard.
    inFlightRequests.delete(key);
    // The injected <style> elements are idempotent per id, so leaving them
    // behind would keep serving the old @font-face and .slide-bg-* rules.
    for (const styleId of [fontStyleId(key), bgStyleId(key)]) {
      document.getElementById(styleId)?.remove();
    }
  }
}

/**
 * Forget a cached theme so the next render re-fetches it.
 *
 * Call after saving or deleting a theme. Also tells other tabs, so an editor
 * open on a deck picks the change up without a reload.
 *
 * @param {string} rawThemeId
 */
export function invalidateTheme(rawThemeId) {
  const id = safeThemeId(rawThemeId);
  dropTheme(id);
  try {
    themeChannel?.postMessage({ type: 'theme-changed', themeId: id });
  } catch {
    // A closed channel must not break the local invalidation above.
  }
}

/** Forget every cached theme. Mostly for tests and hard refreshes. */
export function clearThemeCache() {
  dropTheme(null);
}

async function fetchThemeData(id) {
  // Built-in themes live in /themes/, custom themes in /custom/themes/
  // Only try /custom/themes/ for non-built-in themes to avoid 404 errors
  const isBuiltin = BUILTIN_THEMES.includes(id);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

  // Database custom themes (UUIDs) are served from the API, not the filesystem
  if (isUuid) {
    try {
      const resp = await fetch(`/api/themes/custom/${id}/config`, { cache: 'no-store' });
      if (resp.ok) return await resp.json();
    } catch {
      // ignore
    }
    return null;
  }

  // Candidate URLs to try, in order. Custom themes prefer the folder layout
  // (/custom/themes/<id>/theme.json, which co-locates the theme's assets),
  // then legacy flat (/custom/themes/<id>.json); built-ins are always
  // /themes/<id>.json.
  const enc = encodeURIComponent(id);
  const candidates = isBuiltin
    ? [`/themes/${enc}.json`]
    : [
        `/custom/themes/${enc}/theme.json`,
        `/custom/themes/${enc}.json`,
        `/themes/${enc}.json`,
      ];

  for (const urlPath of candidates) {
    try {
      const resp = await fetch(urlPath, { cache: 'no-store' });
      if (resp.ok) {
        return await resp.json();
      }
    } catch {
      // ignore, try next
    }
  }
  return null;
}

/**
 * Did this fetch return the theme we asked for?
 *
 * A file theme's `id` is the id we requested. A **database** theme is requested
 * by UUID but reports its slug as `id` (that is what `buildThemeConfig` emits),
 * so comparing ids alone rejected every custom theme and fell back to a blank
 * one — the whole theme rendered unstyled in the browser while server exports
 * looked correct. `_customThemeId` carries the UUID, so check both.
 *
 * @param {Object} theme
 * @param {string} id - the id `loadThemeById` was asked for
 * @returns {boolean}
 */
function isThemeForId(theme, id) {
  if (!theme) return false;
  return (
    String(theme.id || '') === id || String(theme._customThemeId || '') === id
  );
}

export async function loadThemeById(rawThemeId) {
  const id = safeThemeId(rawThemeId);
  if (themeCache.has(id)) return themeCache.get(id);

  // Prevent duplicate in-flight requests for the same theme
  if (inFlightRequests.has(id)) {
    return inFlightRequests.get(id);
  }

  const promise = fetchThemeData(id).then((theme) => {
    inFlightRequests.delete(id);
    theme = normalizeTheme(theme);
    if (!isThemeForId(theme, id)) {
      theme = normalizeTheme({
        id,
        label: id,
        assets: { logo: '/assets/images/logo.svg', logoAlt: 'Logo' },
        cssVars: {},
      });
    }
    // Style elements are keyed by the id we were asked for, not the theme's own
    // id, so invalidateTheme() can find and remove them again.
    injectThemeFontFaces(theme, id);
    injectThemeSlideBgStyles(theme, id);
    themeCache.set(id, theme);
    return theme;
  });

  inFlightRequests.set(id, promise);
  return promise;
}

/**
 * Inject @font-face rules for a theme's embedded fonts into the document head.
 * Handles both path-based (curated) and URL-based (uploaded) fonts.
 * Idempotent — skips fonts that are already loaded.
 */
export function injectThemeFontFaces(theme, key = null) {
  if (!theme?.embedFonts?.length) return;
  const styleId = fontStyleId(key || theme.id);
  if (document.getElementById(styleId)) return;

  const rules = [];
  for (const f of theme.embedFonts) {
    const family = f.family;
    if (!family) continue;

    let src;
    if (f.url) {
      src = `url('${f.url}') format('${f.format || 'woff2'}')`;
    } else if (f.path) {
      src = `url('/${f.path}') format('woff2')`;
    } else {
      continue;
    }

    rules.push(
      `@font-face { font-family: '${family}'; src: ${src}; font-weight: ${f.weight || 400}; font-style: ${f.style || 'normal'}; font-display: swap; }`
    );
  }

  if (rules.length) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = rules.join('\n');
    document.head.appendChild(style);
  }
}

/**
 * Inject generated `.slide.slide-bg-<id>` rules for a theme's slide background
 * variants (theme.slideBackgrounds) into the document head. Values resolve via
 * `--t-slide-bg-<id>*` vars applied per slide element, so rules from different
 * themes coexist. Idempotent per theme id, like injectThemeFontFaces.
 */
export function injectThemeSlideBgStyles(theme, key = null) {
  if (!Array.isArray(theme?.slideBackgrounds) || !theme.slideBackgrounds.length)
    return;
  const styleId = bgStyleId(key || theme.id);
  if (document.getElementById(styleId)) return;
  const css = slideBackgroundsCssText(theme.slideBackgrounds);
  if (!css) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = css;
  document.head.appendChild(style);
}

export function applyThemeVarsToElement(el, theme) {
  const node = el && el.style ? el : null;
  if (!node) return;
  const vars =
    theme?.cssVars && typeof theme.cssVars === 'object'
      ? theme.cssVars
      : {};
  for (const [k, v] of Object.entries(vars)) {
    if (typeof k !== 'string' || !k.startsWith('--t-')) continue;
    // Defensive: never apply UI variables to slides, even if a theme accidentally contains them.
    if (k.startsWith('--t-ui-')) continue;
    if (v == null) continue;
    node.style.setProperty(k, String(v));
  }
}

// Background presets live in shared/ so the server's slide creation, deck
// import and convert paths read them the same way the editor does. Re-exported
// here because the editor's field modules already import from this module.
export {
  getBackgroundPresets,
  pickBackgroundPreset,
} from '../../shared/theme-background-presets.js';
