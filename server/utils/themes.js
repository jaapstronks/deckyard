import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_THEME_ID } from '../../shared/constants/themes.js';
import { getTheme as getCustomTheme } from '../storage/themes.js';
import { listAllFontFamiliesWithVariants } from '../storage/font-families.js';
import { buildThemeConfig } from './theme-builder.js';
import { slideBackgroundsCssText } from '../../shared/theme-slide-backgrounds.js';
import { normalizeTheme } from '../../shared/theme-normalize.js';

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

/**
 * List only the core, built-in theme ids (the flat `themes/<id>.json` set),
 * excluding filesystem custom themes under `custom/themes/`. These are the
 * neutral, non-branded themes safe to surface on a public sandbox.
 * @param {string} repoRoot
 * @returns {Promise<string[]>}
 */
export async function listCoreThemeIds(repoRoot) {
  const coreDir = path.join(repoRoot, 'themes');
  try {
    const files = await fs.readdir(coreDir);
    return files
      .filter((f) => String(f).toLowerCase().endsWith('.json'))
      .map((f) => f.replace(/\.json$/i, ''))
      .filter(Boolean);
  } catch {
    return [];
  }
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
