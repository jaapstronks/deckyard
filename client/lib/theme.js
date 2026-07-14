import { DEFAULT_THEME_ID } from '../../shared/constants/themes.js';
import { THEMES as BUILTIN_THEMES } from '../../shared/slide-types/registry.js';
import {
  normalizeSlideBackgrounds,
  slideBackgroundCssVars,
  slideBackgroundsCssText,
} from '../../shared/theme-slide-backgrounds.js';

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

function hexToRgb(hex) {
  const s = String(hex || '').trim();
  const m = s.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex, a) {
  const c = hexToRgb(hex);
  if (!c) return null;
  const alpha = Math.max(0, Math.min(1, Number(a)));
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function normalizeTheme(theme) {
  if (!theme || typeof theme !== 'object') return theme;
  if (!theme.cssVars || typeof theme.cssVars !== 'object') theme.cssVars = {};
  if (!Array.isArray(theme.hiddenSlideTypes)) theme.hiddenSlideTypes = [];

  // Theme-defined slide background variants → `--t-slide-bg-<id>*` vars
  // (picker options + generated CSS read theme.slideBackgrounds directly).
  theme.slideBackgrounds = normalizeSlideBackgrounds(theme.slideBackgrounds);
  Object.assign(theme.cssVars, slideBackgroundCssVars(theme.slideBackgrounds));

  // Slide type visibility & theme-specific slide types.
  // Back-compat: `hiddenSlideTypes` is treated as `slideTypes.exclude`.
  theme.slideTypes =
    theme.slideTypes && typeof theme.slideTypes === 'object'
      ? theme.slideTypes
      : {};
  const clean = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean);
  const uniq = (arr) => {
    const out = [];
    const seen = new Set();
    for (const s of clean(arr)) {
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  theme.hiddenSlideTypes = uniq(theme.hiddenSlideTypes);
  theme.slideTypes.exclude = uniq([
    ...(Array.isArray(theme.slideTypes.exclude) ? theme.slideTypes.exclude : []),
    ...theme.hiddenSlideTypes,
  ]);
  theme.slideTypes.include = uniq(theme.slideTypes.include);

  const enabled = !!theme?.gradient?.enabled;
  theme.cssVars['--t-gradient-enabled'] = enabled ? '1' : '0';

  if (enabled && !theme.cssVars['--t-slide-gradient-bg']) {
    const c1 = String(theme.cssVars['--t-quote-author-color'] || '').trim();
    const c2 = String(theme.cssVars['--t-color-accent'] || '').trim();
    const c3 = String(theme.cssVars['--t-slide-bg-mist'] || '').trim();
    const base = '#06090b';
    const r1 = rgba(c1, 1);
    const r1b = rgba(c1, 0.65);
    const r1c = rgba(c1, 0.22);
    const r2 = rgba(c2, 0.95);
    const r2b = rgba(c2, 0.55);
    const r2c = rgba(c2, 0.18);
    const r3 = rgba(c3, 0.75);
    const r3b = rgba(c3, 0.38);
    const r3c = rgba(c3, 0.14);
    if (r1 && r2 && r3) {
      theme.cssVars['--t-slide-gradient-bg'] = [
        `radial-gradient(circle at var(--g1x) var(--g1y), ${r1} 0%, ${r1b} 18%, ${r1c} 42%, rgba(0,0,0,0) 72%)`,
        `radial-gradient(circle at var(--g2x) var(--g2y), ${r2} 0%, ${r2b} 22%, ${r2c} 48%, rgba(0,0,0,0) 78%)`,
        `radial-gradient(circle at var(--g3x) var(--g3y), ${r3} 0%, ${r3b} 26%, ${r3c} 52%, rgba(0,0,0,0) 82%)`,
        base,
      ].join(', ');
    }
  }

  // Theme-wide light/dark text tokens (for auto-contrast).
  const lightText = String(theme.textColorLight || '#ffffff').trim() || '#ffffff';
  const darkText = String(theme.textColorDark || '#212121').trim() || '#212121';

  if (!enabled) {
    if (!theme.cssVars['--t-chapter-text-color']) {
      // Chapter-title renders on the theme's dark surface
      // (background: var(--t-slide-bg-dark)) — defaulting to the regular text
      // colour paints dark-on-dark there. Derive from the surface's luminance.
      const chapterBgHex = String(theme.cssVars['--t-slide-bg-dark'] || '').trim();
      theme.cssVars['--t-chapter-text-color'] = hexToRgb(chapterBgHex)
        ? pickTextColorForBg(chapterBgHex, { light: lightText, dark: darkText })
        : 'var(--t-color-text, #0b0b0b)';
    }
    if (!theme.cssVars['--t-quote-text-color']) {
      // Quote slides render on the theme's dark surface
      // (background: var(--t-slide-bg-dark)), same as chapter-title — so the
      // text colour must derive from that surface's luminance, not the regular
      // (page-background) text colour, which paints dark-on-dark there.
      const quoteBgHex = String(theme.cssVars['--t-slide-bg-dark'] || '').trim();
      theme.cssVars['--t-quote-text-color'] = hexToRgb(quoteBgHex)
        ? pickTextColorForBg(quoteBgHex, { light: lightText, dark: darkText })
        : 'var(--t-color-text, #0b0b0b)';
    }
  } else {
    if (!theme.cssVars['--t-chapter-text-color'])
      theme.cssVars['--t-chapter-text-color'] = '#ffffff';
  }
  theme.cssVars['--t-text-color-light'] = lightText;
  theme.cssVars['--t-text-color-dark'] = darkText;

  // Accent contrast token.
  const accentHex = String(theme.cssVars['--t-color-accent'] || '').trim();
  const accentContrast = pickTextColorForBg(accentHex, {
    light: lightText,
    dark: darkText,
  });
  theme.cssVars['--t-color-accent-contrast'] = accentContrast;

  // Icon card grid defaults.
  theme.cssVars['--t-icon-card-grid-text-color'] = enabled
    ? '#ffffff'
    : String(theme.cssVars['--t-color-text'] || '#0b0b0b');
  theme.cssVars['--t-icon-card-grid-subtitle-color'] = enabled
    ? 'rgba(255, 255, 255, 0.82)'
    : String(
        theme.cssVars['--t-color-text-muted'] ||
          'rgba(11, 11, 11, 0.65)'
      );

  // Icon-card-grid (Iconen kaarten) icon block:
  // Theme can override via `--t-icon-card-grid-icon-bg`. If not set, prefer the theme's
  // bright slide "lime" when it's a real color (and not white), otherwise fall back to accent.
  if (!theme.cssVars['--t-icon-card-grid-icon-bg']) {
    const limeHex = String(theme.cssVars['--t-slide-bg-lime'] || '').trim();
    const accentHex2 = String(theme.cssVars['--t-color-accent'] || '#385c5c').trim();
    const limeLower = limeHex.toLowerCase();
    const useLime =
      !!hexToRgb(limeHex) && limeLower !== '#fff' && limeLower !== '#ffffff';
    theme.cssVars['--t-icon-card-grid-icon-bg'] = useLime ? limeHex : accentHex2;
  }

  const iconBgHex = String(theme.cssVars['--t-icon-card-grid-icon-bg'] || '').trim();
  const iconFg = pickTextColorForBg(iconBgHex, {
    light: lightText,
    dark: darkText,
  });
  theme.cssVars['--t-icon-card-grid-icon-fg'] = iconFg;
  // Best-effort: recolor monochrome SVG <img> icons on icon-block backgrounds.
  theme.cssVars['--t-icon-card-grid-icon-filter'] =
    iconFg === lightText ? 'brightness(0) invert(1)' : 'none';

  return theme;
}

function pickTextColorForBg(bgHex, { light = '#ffffff', dark = '#212121' } = {}) {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return dark;
  const lum = relLuminance(rgb);
  return lum < 0.5 ? light : dark;
}

function relLuminance({ r, g, b }) {
  const toLin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const R = toLin(r);
  const G = toLin(g);
  const B = toLin(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
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
