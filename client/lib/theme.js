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
    if (!theme || String(theme.id || '') !== id) {
      theme = normalizeTheme({
        id,
        label: id,
        assets: { logo: '/assets/images/logo.svg', logoAlt: 'Logo' },
        cssVars: {},
      });
    }
    // Inject @font-face rules so custom/uploaded fonts render in the editor
    injectThemeFontFaces(theme);
    // Inject generated .slide-bg-<id> rules for theme-defined bg variants
    injectThemeSlideBgStyles(theme);
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
export function injectThemeFontFaces(theme) {
  if (!theme?.embedFonts?.length) return;
  const styleId = `theme-fonts-${theme.id || 'unknown'}`;
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
export function injectThemeSlideBgStyles(theme) {
  if (!Array.isArray(theme?.slideBackgrounds) || !theme.slideBackgrounds.length)
    return;
  const styleId = `theme-slide-bgs-${theme.id || 'unknown'}`;
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

/**
 * Get background presets from a theme.
 * @param {Object} theme - Theme object
 * @returns {string[]} Array of background image URLs
 */
export function getBackgroundPresets(theme) {
  if (!theme || typeof theme !== 'object') return [];
  if (!Array.isArray(theme.backgroundPresets)) return [];
  return theme.backgroundPresets.filter((url) => typeof url === 'string' && url.trim());
}
