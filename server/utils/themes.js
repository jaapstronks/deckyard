import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cleanStr, uniqStrings } from '../../shared/string-utils.js';
import { DEFAULT_THEME_ID } from '../../shared/constants/themes.js';
import { getTheme as getCustomTheme } from '../storage/themes.js';
import { listAllFontFamiliesWithVariants } from '../storage/font-families.js';
import { buildThemeConfig, hexToRgb } from './theme-builder.js';
import {
  normalizeSlideBackgrounds,
  slideBackgroundCssVars,
  slideBackgroundsCssText,
} from '../../shared/theme-slide-backgrounds.js';

const THEME_ID_RE = /^[a-z0-9-]{1,32}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cache = new Map(); // id -> theme object
const customThemeCache = new Map(); // uuid -> theme object

// Default theme for OSS version (can be overridden via DEFAULT_THEME env var)
const DEFAULT_THEME = process.env.DEFAULT_THEME || DEFAULT_THEME_ID;

export function resolveThemeId(raw) {
  const s = String(raw || '').trim();
  if (!s) return DEFAULT_THEME;
  // Back-compat: older decks / code used "default" as a theme id;
  // it now maps to the configured DEFAULT_THEME.
  if (s === 'default') return DEFAULT_THEME;
  // Accept UUIDs for custom themes (36 characters with hyphens)
  if (UUID_RE.test(s)) return s.toLowerCase();
  // Accept short theme IDs for system themes (up to 32 characters)
  if (!THEME_ID_RE.test(s)) return DEFAULT_THEME;
  return s.toLowerCase();
}

/**
 * Find theme file path, checking both custom/themes/ and themes/ directories.
 * Custom themes take precedence over core themes.
 */
function findThemeFile(repoRoot, themeId) {
  // Custom (fork-specific) themes take precedence over core themes.
  // Preferred layout: a self-contained folder that co-locates the theme's own
  // assets (logo, fonts, background presets) under custom/themes/<id>/assets/.
  const customFolder = path.join(
    repoRoot,
    'custom',
    'themes',
    themeId,
    'theme.json'
  );
  if (existsSync(customFolder)) return customFolder;

  // Legacy flat layout: custom/themes/<id>.json (still supported).
  const customFlat = path.join(repoRoot, 'custom', 'themes', `${themeId}.json`);
  if (existsSync(customFlat)) return customFlat;

  // Fall back to core themes/ (built-ins are always flat <id>.json).
  const corePath = path.join(repoRoot, 'themes', `${themeId}.json`);
  if (existsSync(corePath)) return corePath;

  return null;
}

export async function loadTheme(repoRoot, rawThemeId, ctx = null) {
  const rawId = String(rawThemeId || '').trim();

  // Check if this is a custom theme UUID
  if (UUID_RE.test(rawId)) {
    return loadCustomTheme(rawId, ctx, repoRoot);
  }

  const id = resolveThemeId(rawId);
  if (cache.has(id)) return cache.get(id);

  const themePath = findThemeFile(repoRoot, id);

  if (themePath) {
    try {
      const txt = await fs.readFile(themePath, 'utf8');
      const parsed = JSON.parse(txt);
      const theme =
        parsed && typeof parsed === 'object' ? parsed : null;
      if (!theme || theme.id !== id) throw new Error('Invalid theme');
      const normalized = normalizeTheme(theme);
      cache.set(id, normalized);
      return normalized;
    } catch (err) {
      console.warn(`[themes] Error loading theme ${id}:`, err.message);
    }
  }

  // Theme not found, try falling back to default theme
  if (id !== DEFAULT_THEME) {
    return loadTheme(repoRoot, DEFAULT_THEME);
  }

  // Final fallback: a minimal in-memory theme.
  const fallback = {
    id: DEFAULT_THEME,
    label: 'Default',
    assets: { logo: '/assets/images/deckyard-mark.svg', logoAlt: 'Deckyard' },
    cssVars: {},
    embedFonts: [],
    hiddenSlideTypes: [],
  };
  const normalized = normalizeTheme(fallback);
  cache.set(DEFAULT_THEME, normalized);
  return normalized;
}

/**
 * Load a custom theme from the database.
 * @param {string} themeId - UUID of the custom theme
 * @param {Object} ctx - Context object (for org ID)
 * @param {string} repoRoot - Repository root for fallback
 * @returns {Promise<Object>} Theme configuration
 */
async function loadCustomTheme(themeId, ctx, repoRoot) {
  // Check cache first
  if (customThemeCache.has(themeId)) {
    return customThemeCache.get(themeId);
  }

  try {
    const dbTheme = await getCustomTheme(themeId, ctx || {});
    if (dbTheme) {
      // Fetch managed fonts if the theme references any familyId
      let managedFonts;
      const fonts = dbTheme.fonts || {};
      if ((fonts.headingFamilyId || fonts.bodyFamilyId) && dbTheme.organizationId) {
        try {
          managedFonts = await listAllFontFamiliesWithVariants({
            organizationId: dbTheme.organizationId,
          });
        } catch {
          // Fall back to no managed fonts
        }
      }

      // Build full theme config from database record
      const themeConfig = buildThemeConfig(dbTheme, { managedFonts });
      const normalized = normalizeTheme(themeConfig);
      customThemeCache.set(themeId, normalized);
      return normalized;
    }
  } catch (err) {
    console.warn(`[themes] Error loading custom theme ${themeId}:`, err.message);
  }

  // Fall back to default theme
  return loadTheme(repoRoot, DEFAULT_THEME);
}

/**
 * Clear the custom theme cache (call after theme updates).
 * @param {string} [themeId] - Specific theme ID to clear, or all if not provided
 */
export function clearCustomThemeCache(themeId) {
  if (themeId) {
    customThemeCache.delete(themeId);
  } else {
    customThemeCache.clear();
  }
}

export async function listThemeIds(repoRoot) {
  const coreDir = path.join(repoRoot, 'themes');
  const customDir = path.join(repoRoot, 'custom', 'themes');

  // Core themes are always flat <id>.json files.
  const readFlatThemeDir = async (dir) => {
    try {
      const files = await fs.readdir(dir);
      return files
        .filter((f) => String(f).toLowerCase().endsWith('.json'))
        .map((f) => f.replace(/\.json$/i, ''))
        .filter(Boolean);
    } catch {
      return [];
    }
  };

  // Custom themes may be folder-based (<id>/theme.json) or legacy flat
  // (<id>.json). Enumerate both so the selector lists either layout.
  const readCustomThemeDir = async (dir) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const ids = [];
      for (const e of entries) {
        if (e.isDirectory()) {
          if (existsSync(path.join(dir, e.name, 'theme.json'))) ids.push(e.name);
        } else if (String(e.name).toLowerCase().endsWith('.json')) {
          ids.push(e.name.replace(/\.json$/i, ''));
        }
      }
      return ids.filter(Boolean);
    } catch {
      return [];
    }
  };

  const [coreThemes, customThemes] = await Promise.all([
    readFlatThemeDir(coreDir),
    readCustomThemeDir(customDir),
  ]);

  // Combine and dedupe (custom themes can override core with same ID)
  const seen = new Set();
  const result = [];

  // Add custom themes first (they take precedence in UI ordering)
  for (const id of customThemes) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  // Add core themes
  for (const id of coreThemes) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return result;
}


export function themeVarsCssText(theme, { selector = '.ps-theme' } = {}) {
  const vars =
    theme?.cssVars && typeof theme.cssVars === 'object'
      ? theme.cssVars
      : {};
  const lines = [];
  for (const [k, v] of Object.entries(vars)) {
    // Only emit theme vars that are meant for slide rendering.
    // Never emit UI vars (e.g. --t-ui-*) because the app UI must be theme-independent.
    if (typeof k !== 'string' || !k.startsWith('--t-')) continue;
    if (k.startsWith('--t-ui-')) continue;
    if (v == null) continue;
    lines.push(`  ${k}: ${String(v)};`);
  }
  const sel = String(selector || '.ps-theme').trim() || '.ps-theme';
  const varsBlock = `${sel} {\n${lines.join('\n')}\n}`;
  // Theme-defined slide background variants need their generated
  // `.slide.slide-bg-<id>` rules in exports too (the client injects the same
  // rules at runtime — see injectThemeSlideBgStyles in client/lib/theme.js).
  const bgRules = slideBackgroundsCssText(theme?.slideBackgrounds);
  return bgRules ? `${varsBlock}\n${bgRules}` : varsBlock;
}

export function safeInlineJson(obj) {
  // Prevent `</script>` breakouts and keep it deterministic.
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function rgba(hex, a) {
  const c = hexToRgb(hex);
  if (!c) return null;
  const alpha = Math.max(0, Math.min(1, Number(a)));
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function normalizeTheme(theme) {
  const out = structuredClone(theme);
  if (!out.cssVars || typeof out.cssVars !== 'object') out.cssVars = {};
  if (!out.hiddenSlideTypes || !Array.isArray(out.hiddenSlideTypes))
    out.hiddenSlideTypes = [];
  out.hiddenSlideTypes = uniqStrings(out.hiddenSlideTypes);

  // Theme-defined slide background variants → `--t-slide-bg-<id>*` vars
  // (exports also read out.slideBackgrounds in themeVarsCssText).
  out.slideBackgrounds = normalizeSlideBackgrounds(out.slideBackgrounds);
  Object.assign(out.cssVars, slideBackgroundCssVars(out.slideBackgrounds));

  // Slide type visibility & theme-specific slide types.
  // Back-compat: `hiddenSlideTypes` is treated as `slideTypes.exclude`.
  out.slideTypes =
    out.slideTypes && typeof out.slideTypes === 'object'
      ? out.slideTypes
      : {};
  out.slideTypes.exclude = uniqStrings([
    ...(Array.isArray(out.slideTypes.exclude) ? out.slideTypes.exclude : []),
    ...out.hiddenSlideTypes,
  ]);
  out.slideTypes.include = uniqStrings(out.slideTypes.include);

  // Default title slide for new presentations using this theme.
  // If not specified, falls back to 'title-slide'.
  const rawDefaultTitleSlide = cleanStr(out.defaultTitleSlide);
  out.defaultTitleSlide = rawDefaultTitleSlide || 'title-slide';

  const enabled = !!out?.gradient?.enabled;
  // Use numeric "0/1" so it can be dropped into CSS opacity.
  out.cssVars['--t-gradient-enabled'] = enabled ? '1' : '0';

  // If gradient is enabled and the theme didn't explicitly provide a gradient background,
  // generate a sensible default based on the theme's own token colors.
  if (enabled && !out.cssVars['--t-slide-gradient-bg']) {
    const c1 = String(out.cssVars['--t-quote-author-color'] || '').trim();
    const c2 = String(out.cssVars['--t-color-accent'] || '').trim();
    const c3 = String(out.cssVars['--t-slide-bg-mist'] || '').trim();
    const base = '#06090b';

    // If we can't parse colors, skip generation (CSS will just fall back to solid bg).
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
      out.cssVars['--t-slide-gradient-bg'] = [
        `radial-gradient(circle at var(--g1x) var(--g1y), ${r1} 0%, ${r1b} 18%, ${r1c} 42%, rgba(0,0,0,0) 72%)`,
        `radial-gradient(circle at var(--g2x) var(--g2y), ${r2} 0%, ${r2b} 22%, ${r2c} 48%, rgba(0,0,0,0) 78%)`,
        `radial-gradient(circle at var(--g3x) var(--g3y), ${r3} 0%, ${r3b} 26%, ${r3c} 52%, rgba(0,0,0,0) 82%)`,
        base,
      ].join(', ');
    }
  }

  // Theme-wide light/dark text tokens for auto-contrast features.
  const lightText = String(out.textColorLight || '#ffffff').trim() || '#ffffff';
  const darkText = String(out.textColorDark || '#212121').trim() || '#212121';

  // Ensure readable text colors when gradient is disabled, unless explicitly set by the theme.
  if (!enabled) {
    if (!out.cssVars['--t-chapter-text-color']) {
      // Chapter-title renders on the theme's dark surface
      // (background: var(--t-slide-bg-dark)), NOT on the page background —
      // defaulting to the regular text colour paints dark-on-dark there.
      // Derive from the actual surface's luminance when we can parse it.
      const chapterBgHex = String(out.cssVars['--t-slide-bg-dark'] || '').trim();
      out.cssVars['--t-chapter-text-color'] = hexToRgb(chapterBgHex)
        ? pickTextColorForBg(chapterBgHex, { light: lightText, dark: darkText })
        : 'var(--t-color-text, #0b0b0b)';
    }
    if (!out.cssVars['--t-quote-text-color']) {
      // Quote slides render on the theme's dark surface
      // (background: var(--t-slide-bg-dark)), same as chapter-title — so the
      // text colour must derive from that surface's luminance, not the regular
      // (page-background) text colour, which paints dark-on-dark there.
      const quoteBgHex = String(out.cssVars['--t-slide-bg-dark'] || '').trim();
      out.cssVars['--t-quote-text-color'] = hexToRgb(quoteBgHex)
        ? pickTextColorForBg(quoteBgHex, { light: lightText, dark: darkText })
        : 'var(--t-color-text, #0b0b0b)';
    }
  } else {
    if (!out.cssVars['--t-chapter-text-color'])
      out.cssVars['--t-chapter-text-color'] = '#ffffff';
  }
  out.cssVars['--t-text-color-light'] = lightText;
  out.cssVars['--t-text-color-dark'] = darkText;

  // Accent contrast token (used for icon blocks, etc).
  const accentHex = String(out.cssVars['--t-color-accent'] || '').trim();
  const accentContrast = pickTextColorForBg(accentHex, {
    light: lightText,
    dark: darkText,
  });
  out.cssVars['--t-color-accent-contrast'] = accentContrast;

  // Table style variants (Table slide): when a theme overrides a variant's
  // header or label-column background, auto-derive readable text for it — the
  // same "set a bg token → get readable text for free" pattern as the accent
  // contrast above. Themes that set no --t-table-* tokens get the palette
  // defaults straight from CSS, so this is a no-op for them.
  for (const variant of ['panel', 'soft']) {
    for (const slot of ['header', 'firstcol']) {
      const bgKey = `--t-table-${variant}-${slot}-bg`;
      const textKey = `--t-table-${variant}-${slot}-text`;
      const bgHex = String(out.cssVars[bgKey] || '').trim();
      if (bgHex && !out.cssVars[textKey] && hexToRgb(bgHex)) {
        out.cssVars[textKey] = pickTextColorForBg(bgHex, {
          light: lightText,
          dark: darkText,
        });
      }
    }
    // Body surface uses the slot-less token pair (--t-table-<variant>-bg /
    // --t-table-<variant>-text). When a theme remaps the body background, derive
    // readable body text for it too, so a dark-remapped body still reads.
    const bodyBgKey = `--t-table-${variant}-bg`;
    const bodyTextKey = `--t-table-${variant}-text`;
    const bodyBgHex = String(out.cssVars[bodyBgKey] || '').trim();
    if (bodyBgHex && !out.cssVars[bodyTextKey] && hexToRgb(bodyBgHex)) {
      out.cssVars[bodyTextKey] = pickTextColorForBg(bodyBgHex, {
        light: lightText,
        dark: darkText,
      });
    }
  }

  // Icon-card-grid (Iconen kaarten) defaults:
  // - When gradient enabled: white header text
  // - When gradient disabled: use regular slide text colors
  out.cssVars['--t-icon-card-grid-text-color'] = enabled
    ? '#ffffff'
    : String(out.cssVars['--t-color-text'] || '#0b0b0b');
  out.cssVars['--t-icon-card-grid-subtitle-color'] = enabled
    ? 'rgba(255, 255, 255, 0.82)'
    : String(
        out.cssVars['--t-color-text-muted'] ||
          'rgba(11, 11, 11, 0.65)'
      );
  // Icon-card-grid icon block: prefer the theme's bright "lime" surface when
  // it defines one, otherwise fall back to the accent colour (so icons aren't
  // on white). Theme can override via `--t-icon-card-grid-icon-bg`.
  if (!out.cssVars['--t-icon-card-grid-icon-bg']) {
    const limeHex = String(out.cssVars['--t-slide-bg-lime'] || '').trim();
    const accentHex2 = String(out.cssVars['--t-color-accent'] || '#385c5c').trim();
    const limeLower = limeHex.toLowerCase();
    const useLime =
      !!hexToRgb(limeHex) &&
      limeLower !== '#fff' &&
      limeLower !== '#ffffff';
    out.cssVars['--t-icon-card-grid-icon-bg'] = useLime ? limeHex : accentHex2;
  }

  const iconBgHex = String(out.cssVars['--t-icon-card-grid-icon-bg'] || '').trim();
  const iconFg = pickTextColorForBg(iconBgHex, {
    light: lightText,
    dark: darkText,
  });
  out.cssVars['--t-icon-card-grid-icon-fg'] = iconFg;
  // Best-effort: recolor monochrome SVG <img> icons on icon-block backgrounds.
  out.cssVars['--t-icon-card-grid-icon-filter'] =
    iconFg === lightText ? 'brightness(0) invert(1)' : 'none';

  return out;
}

function pickTextColorForBg(bgHex, { light = '#ffffff', dark = '#212121' } = {}) {
  const c = hexToRgb(bgHex);
  if (!c) return dark;
  const lum = relLuminance(c);
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
