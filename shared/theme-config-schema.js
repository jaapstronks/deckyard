/**
 * Rich theme configuration — the shape stored in the `themes.config` column.
 *
 * DB themes could only hold four colours, two fonts and two logo URLs, so
 * everything a file theme can express (named background variants, background
 * presets, surface tokens, slide-type curation) was out of reach for a theme
 * built in the app. This schema closes that gap. `buildThemeConfig` merges a
 * validated config over the tokens derived from the colours and fonts.
 *
 * `validateThemeConfig` is total: it never throws and never returns null. Junk
 * in yields `{}` out, unknown keys are dropped, and out-of-range enums fall
 * back to their default. A stored config is therefore always safe to spread
 * into a theme without further checking.
 */

import { normalizeSlideBackgrounds } from './theme-slide-backgrounds.js';
import { LOCKABLE_PROPERTIES } from './theme-locks.js';

export const THEME_CONFIG_VERSION = 1;

/**
 * Theme-driven title-slide layout tokens. The renderer maps the theme's
 * `titleLayout` to a `.tsu-layout-<value>` class on the title-slide root;
 * `bottom` is the default when a theme sets none. Single source of truth,
 * reused by the normalizer and the title-slide renderer.
 */
export const TITLE_LAYOUTS = ['bottom', 'center', 'top'];
export const DEFAULT_TITLE_LAYOUT = 'bottom';

/** Corner rounding presets → the `--t-radius*` triple. */
export const RADIUS_SCALES = {
  none: { '--t-radius': '0px', '--t-radius-sm': '0px', '--t-radius-lg': '0px' },
  soft: { '--t-radius': '16px', '--t-radius-sm': '12px', '--t-radius-lg': '20px' },
  round: { '--t-radius': '28px', '--t-radius-sm': '20px', '--t-radius-lg': '36px' },
};

/**
 * Elevation presets → `--t-shadow-scale`, a multiplier on the shadow alphas.
 * `none` flattens elevation away; `soft` is the design-system default.
 */
export const SHADOW_SCALES = { none: '0', soft: '1', strong: '1.8' };

// Brand properties a theme can lock against per-slide overrides. Defined in
// shared/theme-locks.js next to the enforcement, so the schema can never accept
// a lock that nothing honours. Re-exported because callers treat this module as
// the config vocabulary.
export { LOCKABLE_PROPERTIES };

const LOCK_MODES = ['open', 'locked'];
const HEADING_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'];

const str = (v, max = 500) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const enumOr = (v, allowed, fallback) =>
  allowed.includes(v) ? v : fallback;

const strList = (v, { max = 64, maxLen = 500 } = {}) =>
  (Array.isArray(v) ? v : [])
    .map((x) => str(x, maxLen))
    .filter(Boolean)
    .slice(0, max);

/**
 * CSS custom properties a theme may override directly.
 *
 * Only `--t-*` — those are the theme layer. `--t-ui-*` is rejected because the
 * app chrome is deliberately theme-independent (see client/styles/theme.css),
 * and a theme must not be able to restyle the application around the slides.
 * Values are stripped of the punctuation that would let one escape its
 * declaration, mirroring shared/theme-slide-backgrounds.js.
 */
function sanitizeCssVarOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string') continue;
    if (!key.startsWith('--t-')) continue;
    if (key.startsWith('--t-ui-')) continue;
    if (!/^--t-[a-z0-9-]{1,60}$/i.test(key)) continue;
    const clean = str(value, 300).replace(/[;{}<>]/g, '');
    if (!clean) continue;
    out[key] = clean;
  }
  return out;
}

function sanitizeLogos(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const key of ['dark', 'darkSmall', 'light', 'lightSmall']) {
    const url = str(raw[key], 1000);
    if (url) out[key] = url;
  }
  return Object.keys(out).length ? out : null;
}

function sanitizeSurfaces(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (raw.radius !== undefined)
    out.radius = enumOr(raw.radius, Object.keys(RADIUS_SCALES), 'soft');
  if (raw.shadow !== undefined)
    out.shadow = enumOr(raw.shadow, Object.keys(SHADOW_SCALES), 'soft');
  return Object.keys(out).length ? out : null;
}

function sanitizeTypography(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (raw.headingTransform !== undefined) {
    out.headingTransform = enumOr(
      raw.headingTransform,
      HEADING_TRANSFORMS,
      'none'
    );
  }
  if (raw.headingWeight !== undefined) {
    const n = Number(raw.headingWeight);
    // Clamp to the CSS font-weight range, rounded to the nearest hundred.
    if (Number.isFinite(n)) {
      out.headingWeight = String(
        Math.min(900, Math.max(100, Math.round(n / 100) * 100))
      );
    }
  }
  const letterSpacing = str(raw.letterSpacing, 20).replace(/[;{}<>]/g, '');
  if (letterSpacing) out.letterSpacing = letterSpacing;
  const mono = str(raw.mono, 300).replace(/[;{}<>]/g, '');
  if (mono) out.mono = mono;
  return Object.keys(out).length ? out : null;
}

function sanitizeLocks(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const prop of LOCKABLE_PROPERTIES) {
    if (raw[prop] === undefined) continue;
    out[prop] = enumOr(raw[prop], LOCK_MODES, 'open');
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Names for the two built-in background slots.
 *
 * `lime` and `mist` are storage keys, not colours: `deckyard` paints lime white
 * and `midnight` paints it near-black. The picker therefore falls back to
 * "Color 1" / "Color 2", which is accurate and useless — only the theme knows
 * what its own slots are. A file theme may also use `{en, nl}` objects here; a
 * database theme has one label per field, like the rest of its shape.
 */
function sanitizeBackgroundLabels(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of ['lime', 'mist']) {
    const label = str(raw[key], 40);
    if (label) out[key] = label;
  }
  return Object.keys(out).length ? out : null;
}

function sanitizeSlideTypes(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const include = strList(raw.include, { maxLen: 80 });
  const exclude = strList(raw.exclude, { maxLen: 80 });
  if (!include.length && !exclude.length) return null;
  return { include, exclude };
}

/**
 * Validate and normalize a stored theme config.
 *
 * @param {*} raw - anything; typically the `config` jsonb column
 * @returns {Object} a sanitized config. Keys the input did not set are absent,
 *   so `buildThemeConfig` can tell "not configured" from "configured to a
 *   default" and leave its own defaults in place.
 */
export function validateThemeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out = { version: THEME_CONFIG_VERSION };

  const logos = sanitizeLogos(raw.logos);
  if (logos) out.logos = logos;

  const surfaces = sanitizeSurfaces(raw.surfaces);
  if (surfaces) out.surfaces = surfaces;

  const typography = sanitizeTypography(raw.typography);
  if (typography) out.typography = typography;

  // Reuses the file-theme normalizer, so a DB theme's variants are subject to
  // the same id pattern, reserved-id list and value guard as a file theme's.
  const slideBackgrounds = normalizeSlideBackgrounds(raw.slideBackgrounds);
  if (slideBackgrounds.length) out.slideBackgrounds = slideBackgrounds;

  const backgroundPresets = strList(raw.backgroundPresets, { maxLen: 1000 });
  if (backgroundPresets.length) out.backgroundPresets = backgroundPresets;

  if (raw.gradient && typeof raw.gradient === 'object') {
    out.gradient = { enabled: !!raw.gradient.enabled };
  }

  const backgroundLabels = sanitizeBackgroundLabels(raw.backgroundLabels);
  if (backgroundLabels) out.backgroundLabels = backgroundLabels;

  const slideTypes = sanitizeSlideTypes(raw.slideTypes);
  if (slideTypes) out.slideTypes = slideTypes;

  const defaultTitleSlide = str(raw.defaultTitleSlide, 80);
  if (defaultTitleSlide) out.defaultTitleSlide = defaultTitleSlide;

  // Theme-driven title-slide layout token (bottom | center | top). The renderer
  // maps it to a `.tsu-layout-*` class; unknown/absent falls back to the
  // normalize default. Whitelisted here so custom/DB themes keep it.
  const titleLayout = str(raw.titleLayout, 20);
  if (TITLE_LAYOUTS.includes(titleLayout)) out.titleLayout = titleLayout;

  const locks = sanitizeLocks(raw.locks);
  if (locks) out.locks = locks;

  const cssVarOverrides = sanitizeCssVarOverrides(raw.cssVarOverrides);
  if (Object.keys(cssVarOverrides).length) out.cssVarOverrides = cssVarOverrides;

  // Nothing beyond the version marker: treat as unconfigured.
  return Object.keys(out).length === 1 ? {} : out;
}
