/**
 * Rich theme configuration — the shape stored in the `themes.config` column.
 *
 * DB themes could only hold four colours, two fonts and two logo URLs, so
 * everything a file theme can express (named background variants, background
 * presets, surface tokens, slide-type curation) was out of reach for a theme
 * built in the app. This schema closes that gap. `buildThemeConfig` merges a
 * validated config over the tokens derived from the colours and fonts.
 *
 * Two gates, one vocabulary (D209). `checkThemeConfig` is the write gate: an
 * unknown field is a refusal that names the field, never a silent drop. A
 * theme is a record that has to carry every theme losslessly, so a key the
 * schema does not know is either a typo or a field that would vanish on save —
 * both defects to report, not to repair. `validateThemeConfig` is the read
 * side: it normalizes a config that already passed the gate and is total (it
 * never throws and never returns null), so a stored config is always safe to
 * spread into a theme without further checking.
 *
 * The same module owns the `colors` column's vocabulary (`validateThemeColors`),
 * because the builder, the storage gate and the `.deck` import all read it.
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
  soft: {
    '--t-radius': '16px',
    '--t-radius-sm': '12px',
    '--t-radius-lg': '20px',
  },
  round: {
    '--t-radius': '28px',
    '--t-radius-sm': '20px',
    '--t-radius-lg': '36px',
  },
};

/**
 * Elevation presets → `--t-shadow-scale`, a multiplier on the shadow alphas.
 * `none` flattens elevation away; `soft` is the design-system default.
 */
export const SHADOW_SCALES = { none: '0', soft: '1', strong: '1.8' };

/**
 * Type-size presets → `--t-slide-text-scale`, a multiplier on the whole slide
 * type scale (client/styles/slides/00-tokens.css § TYPOGRAPHY SCALE).
 *
 * Deliberately a narrow band, not an open number: the scale moves type without
 * moving the spacing and component scales, so a large step still has to fit the
 * boxes the design system drew. `normal` is the design-system default; a theme
 * that needs a value outside the band can still set the token raw through
 * `cssVarOverrides`.
 */
export const TEXT_SCALES = { compact: '0.9', normal: '1', large: '1.1' };

// Brand properties a theme can lock against per-slide overrides. Defined in
// shared/theme-locks.js next to the enforcement, so the schema can never accept
// a lock that nothing honours. Re-exported because callers treat this module as
// the config vocabulary.
export { LOCKABLE_PROPERTIES };

const LOCK_MODES = ['open', 'locked'];
const HEADING_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'];

const str = (v, max = 500) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const enumOr = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

const strList = (v, { max = 64, maxLen = 500 } = {}) =>
  (Array.isArray(v) ? v : [])
    .map((x) => str(x, maxLen))
    .filter(Boolean)
    .slice(0, max);

/**
 * Longest value a `cssVarOverrides` entry may hold. A layered gradient (the
 * CIIIC fork's `--t-slide-gradient-bg` is 540 characters) is a legitimate
 * override; the length cap is only a sanity bound. The real guard is the
 * character rule below, which keeps a value inside its own declaration.
 */
export const CSS_VAR_OVERRIDE_MAX = 2000;

/** Name shape of an overridable token: the theme layer, never the app chrome. */
const CSS_VAR_OVERRIDE_KEY_RE = /^--t-[a-z0-9-]{1,60}$/i;

const isOverridableCssVar = (key) =>
  CSS_VAR_OVERRIDE_KEY_RE.test(key) && !key.startsWith('--t-ui-');

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
    if (!isOverridableCssVar(key)) continue;
    const clean = str(value, CSS_VAR_OVERRIDE_MAX).replace(/[;{}<>]/g, '');
    if (!clean) continue;
    out[key] = clean;
  }
  return out;
}

/**
 * Logo fields. Surface-keyed variants: `dark` is the mark for a DARK ground,
 * `light` the one for a light ground, and the `*Small` pair the title-slide
 * sizes of each. `buildThemeConfig` maps them onto `assets.logoOn*` /
 * `titleLogoOn*`; the renderer picks one per slide (shared/theme-logo.js).
 * `payoff` is the mark of the closing payoff slide (default: the main logo),
 * and `alt` the one alternative text every variant shares (default: the
 * theme's label) — a logo is the same brand on every ground (D208).
 */
const LOGO_URL_KEYS = ['dark', 'darkSmall', 'light', 'lightSmall', 'payoff'];
const LOGO_KEYS = [...LOGO_URL_KEYS, 'alt'];

/**
 * @param {*} raw - The stored `logos` object
 * @returns {Object|null} The sanitized fields, or null when empty
 */
function sanitizeLogos(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const key of LOGO_URL_KEYS) {
    const url = str(raw[key], 1000);
    if (url) out[key] = url;
  }
  const alt = str(raw.alt, 200);
  if (alt) out.alt = alt;
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
  if (raw.textScale !== undefined) {
    out.textScale = enumOr(raw.textScale, Object.keys(TEXT_SCALES), 'normal');
  }
  if (raw.headingTransform !== undefined) {
    out.headingTransform = enumOr(
      raw.headingTransform,
      HEADING_TRANSFORMS,
      'none',
    );
  }
  if (raw.headingWeight !== undefined) {
    const n = Number(raw.headingWeight);
    // Clamp to the CSS font-weight range, rounded to the nearest hundred.
    if (Number.isFinite(n)) {
      out.headingWeight = String(
        Math.min(900, Math.max(100, Math.round(n / 100) * 100)),
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
 * what its own slots are. One string per slot, like `label`: the `{en, nl}`
 * objects a file theme once carried are refused at the gate (D208).
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

  // The ground a new slide starts on under this theme: one background id,
  // and one of the grounds this very config offers — `lime`, `mist`, or the
  // id of one of its own `slideBackgrounds` variants (the same set the theme
  // editor's select is built from). A stored id that resolves to nothing
  // would be a second state meaning "no ground", so it is dropped here, at
  // the write gate, rather than tolerated. Which slide types then take the
  // ground is decided per type by `resolveTypeDefaults`.
  const defaultBackground = str(raw.defaultBackground, 32).toLowerCase();
  const offeredGrounds = new Set([
    'lime',
    'mist',
    ...slideBackgrounds.map((v) => v.id),
  ]);
  if (offeredGrounds.has(defaultBackground))
    out.defaultBackground = defaultBackground;

  // Theme-driven title-slide layout token (bottom | center | top). The renderer
  // maps it to a `.tsu-layout-*` class; unknown/absent falls back to the
  // normalize default. Whitelisted here so custom/DB themes keep it.
  const titleLayout = str(raw.titleLayout, 20);
  if (TITLE_LAYOUTS.includes(titleLayout)) out.titleLayout = titleLayout;

  const locks = sanitizeLocks(raw.locks);
  if (locks) out.locks = locks;

  const cssVarOverrides = sanitizeCssVarOverrides(raw.cssVarOverrides);
  if (Object.keys(cssVarOverrides).length)
    out.cssVarOverrides = cssVarOverrides;

  // Nothing beyond the version marker: treat as unconfigured.
  return Object.keys(out).length === 1 ? {} : out;
}

// ============================================================
// WRITE GATE — unknown fields are refused, by name (D209)
// ============================================================

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Keys a `slideBackgrounds` entry may carry (shared/theme-slide-backgrounds.js). */
const SLIDE_BACKGROUND_KEYS = [
  'id',
  'label',
  'value',
  'textColor',
  'textColorMuted',
  'linkColor',
];

/**
 * The config vocabulary. A group lists the keys it may hold; `true` is a leaf
 * the sanitizer above reads as a scalar or a list.
 */
const CONFIG_FIELDS = {
  version: true,
  logos: LOGO_KEYS,
  surfaces: ['radius', 'shadow'],
  typography: [
    'textScale',
    'headingTransform',
    'headingWeight',
    'letterSpacing',
    'mono',
  ],
  slideBackgrounds: true,
  backgroundPresets: true,
  gradient: ['enabled'],
  backgroundLabels: ['lime', 'mist'],
  slideTypes: ['include', 'exclude'],
  defaultTitleSlide: true,
  defaultBackground: true,
  titleLayout: true,
  locks: LOCKABLE_PROPERTIES,
  cssVarOverrides: true,
};

/**
 * The first field in `raw` the config vocabulary does not know, as a dotted
 * path (`config.logos.logoAlt`), or null when every field is known.
 * @param {Object} raw
 * @returns {string|null}
 */
function unknownConfigField(raw) {
  for (const [key, value] of Object.entries(raw)) {
    const known = CONFIG_FIELDS[key];
    if (!known) return `config.${key}`;
    if (Array.isArray(known) && isPlainObject(value)) {
      const extra = Object.keys(value).find((k) => !known.includes(k));
      if (extra) return `config.${key}.${extra}`;
    }
  }
  // One label per slot, a string (D208): the `{en, nl}` object a file theme
  // once carried would otherwise be dropped without a word.
  for (const slot of ['lime', 'mist']) {
    const label = raw.backgroundLabels?.[slot];
    if (label !== undefined && typeof label !== 'string')
      return `config.backgroundLabels.${slot}`;
  }
  if (Array.isArray(raw.slideBackgrounds)) {
    for (const [i, entry] of raw.slideBackgrounds.entries()) {
      if (!isPlainObject(entry)) continue;
      const extra = Object.keys(entry).find(
        (k) => !SLIDE_BACKGROUND_KEYS.includes(k),
      );
      if (extra) return `config.slideBackgrounds.${i}.${extra}`;
    }
  }
  if (isPlainObject(raw.cssVarOverrides)) {
    // A name outside the theme layer (`--t-ui-*`, or no `--t-` at all) is not
    // a token this field can set.
    const bad = Object.keys(raw.cssVarOverrides).find(
      (k) => !isOverridableCssVar(k),
    );
    if (bad) return `config.cssVarOverrides.${bad}`;
  }
  return null;
}

/**
 * Why a theme field was refused: the snake_case sub-code a storage refusal
 * carries as `fieldProblem.code` (on the wire: `details.reason`).
 */
export const THEME_FIELD_PROBLEMS = Object.freeze({
  /** The record has no field by this name. */
  unknown: 'unknown_field',
  /** A known field holding a value it cannot hold. */
  invalid: 'invalid_value',
});

const refuse = (path, code) => ({ ok: false, path, code });

/**
 * The write gate for a theme config: refuse an unknown field by name, else
 * normalize. Storage calls this on create and update; `.deck` installs go
 * through the same `createTheme`.
 *
 * @param {*} raw - the config as submitted (absent = unconfigured)
 * @returns {{ok: true, config: Object} | {ok: false, path: string, code: string}}
 *   `path` is the dotted field (`config.logos.logoAlt`), `code` one of
 *   {@link THEME_FIELD_PROBLEMS}
 */
export function checkThemeConfig(raw) {
  if (raw === undefined || raw === null) return { ok: true, config: {} };
  if (!isPlainObject(raw))
    return refuse('config', THEME_FIELD_PROBLEMS.invalid);
  const path = unknownConfigField(raw);
  if (path) {
    // A `{en, nl}` label is a known slot holding the wrong shape.
    const code = /^config\.backgroundLabels\.(lime|mist)$/.test(path)
      ? THEME_FIELD_PROBLEMS.invalid
      : THEME_FIELD_PROBLEMS.unknown;
    return refuse(path, code);
  }
  return { ok: true, config: validateThemeConfig(raw) };
}

// ============================================================
// COLORS — the `themes.colors` column
// ============================================================

/** The four roles every theme record carries, with their defaults. */
export const DEFAULT_THEME_COLORS = Object.freeze({
  primary: '#3B82F6',
  background: '#ffffff',
  textLight: '#ffffff',
  textDark: '#1f2937',
});

/** Most brand colours a record holds (`colors.brand`). */
export const BRAND_COLORS_MAX = 8;

/** Chart slots: `colors.chart` sets all of `--t-chart-0` … `--t-chart-7`. */
export const CHART_SLOT_COUNT = 8;

/** The built-in slide grounds `colors.backgrounds` may pin. */
export const THEME_BACKGROUND_SLOTS = ['lime', 'mist', 'dark'];

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_COLOR_RE =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/;

/**
 * @param {*} v
 * @returns {boolean} whether `v` is a `#rgb` / `#rrggbb` hex colour
 */
export function isThemeHexColor(v) {
  return typeof v === 'string' && HEX_COLOR_RE.test(v.trim());
}

const isMutedColor = (v) =>
  isThemeHexColor(v) || (typeof v === 'string' && RGB_COLOR_RE.test(v.trim()));

const hexList = (v, min, max) =>
  Array.isArray(v) &&
  v.length >= min &&
  v.length <= max &&
  v.every(isThemeHexColor);

/**
 * The optional colour fields, each with its value rule. Absent = derived from
 * the four roles, exactly as before these fields existed (D208).
 *
 * - `brand`: the brand palette, 1–8 hex. Feeds `--t-color-brand-1..3` and the
 *   first four chart slots when `chart` is not set.
 * - `chart`: all eight chart slots, positional, exactly eight hex. A partial
 *   list would split one palette over two sources.
 * - `accentOnDark`: the accent as it reads on the dark ground.
 * - `textMuted`: secondary text; hex or `rgb()`/`rgba()`, because a muted
 *   colour is typically the text colour at reduced alpha.
 * - `backgrounds`: `{lime, mist, dark}`, the built-in slide grounds (hex).
 *   `lime` defaults to `background`.
 */
const OPTIONAL_COLOR_FIELDS = {
  brand: (v) => hexList(v, 1, BRAND_COLORS_MAX),
  chart: (v) => hexList(v, CHART_SLOT_COUNT, CHART_SLOT_COUNT),
  accentOnDark: isThemeHexColor,
  textMuted: isMutedColor,
  backgrounds: (v) =>
    isPlainObject(v) &&
    Object.keys(v).length > 0 &&
    Object.values(v).every(isThemeHexColor),
};

/**
 * Validate a record's `colors`: the four roles (defaulted when absent) plus
 * the optional fields above. Strict — an unknown key or an invalid value is a
 * refusal naming the field (`colors.brand`, `colors.backgrounds.shadow`).
 *
 * @param {*} raw
 * @returns {{ok: true, colors: Object} | {ok: false, path: string, code: string}}
 */
export function validateThemeColors(raw) {
  if (raw === undefined || raw === null) {
    return { ok: true, colors: { ...DEFAULT_THEME_COLORS } };
  }
  if (!isPlainObject(raw))
    return refuse('colors', THEME_FIELD_PROBLEMS.invalid);

  const colors = {};
  for (const [key, fallback] of Object.entries(DEFAULT_THEME_COLORS)) {
    if (!raw[key]) {
      colors[key] = fallback;
      continue;
    }
    if (!isThemeHexColor(raw[key]))
      return refuse(`colors.${key}`, THEME_FIELD_PROBLEMS.invalid);
    colors[key] = String(raw[key]).trim();
  }

  for (const [key, value] of Object.entries(raw)) {
    if (key in DEFAULT_THEME_COLORS) continue;
    const valid = OPTIONAL_COLOR_FIELDS[key];
    if (!valid) return refuse(`colors.${key}`, THEME_FIELD_PROBLEMS.unknown);
    if (key === 'backgrounds' && isPlainObject(value)) {
      const extra = Object.keys(value).find(
        (k) => !THEME_BACKGROUND_SLOTS.includes(k),
      );
      if (extra)
        return refuse(
          `colors.backgrounds.${extra}`,
          THEME_FIELD_PROBLEMS.unknown,
        );
    }
    if (!valid(value))
      return refuse(`colors.${key}`, THEME_FIELD_PROBLEMS.invalid);
    colors[key] = Array.isArray(value)
      ? value.map((c) => c.trim())
      : isPlainObject(value)
        ? Object.fromEntries(
            Object.entries(value).map(([k, c]) => [k, c.trim()]),
          )
        : value.trim();
  }
  return { ok: true, colors };
}
