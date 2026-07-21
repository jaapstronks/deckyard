/**
 * Shared theme normalization.
 *
 * Both loaders — `client/lib/theme.js` (browser) and `server/utils/themes.js`
 * (render/export/SSR) — must derive exactly the same tokens from a theme, or a
 * slide looks different in the editor than in a PDF. They used to hold
 * near-identical private copies of this function, which drifted: the client
 * copy never gained the table-variant contrast derivation. This module is the
 * single source of truth.
 *
 * Contract: `normalizeTheme` clones its input and returns the clone. It never
 * mutates the theme you hand it, so callers must use the return value.
 */

import { cleanStr, uniqStrings } from './string-utils.js';
import {
  normalizeSlideBackgrounds,
  slideBackgroundCssVars,
} from './theme-slide-backgrounds.js';
import { TEXT_COLOR_SWATCH_SLOTS } from './slide-types/text-styles.js';

/**
 * Normalize a theme's `textSwatches`: the extra on-brand text colours the
 * "This text" tab offers beyond default/muted/accent. Each entry names a fixed
 * slot (`brand-1`/`brand-2`/`brand-3`) the theme has also given a colour via
 * the matching `--t-color-<slot>` token. Entries with an unknown slot, a
 * duplicate, or no declared token are dropped — so the UI never shows a swatch
 * that would resolve to `currentColor` (a no-op). Label may be a string or a
 * `{ nl, en }` map (resolved by the UI, like `backgroundLabels`).
 * @param {unknown} raw
 * @param {Object} vars - the theme's cssVars
 * @returns {Array<{id: string, label?: unknown}>}
 */
function normalizeTextSwatches(raw, vars) {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(TEXT_COLOR_SWATCH_SLOTS);
  const seen = new Set();
  const out = [];
  for (const e of raw) {
    const id = typeof e === 'string' ? cleanStr(e) : cleanStr(e?.id);
    if (!allowed.has(id) || seen.has(id)) continue;
    if (!cleanStr(vars?.[`--t-color-${id}`])) continue;
    seen.add(id);
    const label = e && typeof e === 'object' ? e.label : undefined;
    out.push(label != null ? { id, label } : { id });
  }
  return out;
}

/**
 * Parse a 3- or 6-digit hex colour.
 * @param {*} hex
 * @returns {{r: number, g: number, b: number}|null} null when unparseable
 */
export function hexToRgb(hex) {
  const s = String(hex || '').trim();
  const m6 = s.match(/^#?([0-9a-f]{6})$/i);
  if (m6) {
    const n = parseInt(m6[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const m3 = s.match(/^#?([0-9a-f]{3})$/i);
  if (m3) {
    return {
      r: parseInt(m3[1][0] + m3[1][0], 16),
      g: parseInt(m3[1][1] + m3[1][1], 16),
      b: parseInt(m3[1][2] + m3[1][2], 16),
    };
  }
  return null;
}

/** WCAG relative luminance. */
function relLuminance({ r, g, b }) {
  const toLin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

/**
 * Pick the readable text colour for a background.
 * @param {string} bgHex
 * @param {{light?: string, dark?: string}} [poles]
 * @returns {string} the light or dark pole (dark when bgHex is unparseable)
 */
export function pickTextColorForBg(
  bgHex,
  { light = '#ffffff', dark = '#212121' } = {}
) {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return dark;
  return relLuminance(rgb) < 0.5 ? light : dark;
}

function rgba(hex, a) {
  const c = hexToRgb(hex);
  if (!c) return null;
  const alpha = Math.max(0, Math.min(1, Number(a)));
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

const cssVar = (vars, key) => String(vars[key] || '').trim();

/**
 * Emit the legacy `--t-<name>` alias family.
 *
 * Countdown, freeform and end-slide CSS read `--t-primary`, `--t-accent`,
 * `--t-bg-dark`, `--t-brand-1` and `--t-brand-2`, but no theme file and no DB
 * theme has ever emitted them — those slides always painted the hardcoded
 * fallbacks in the stylesheet (a purple/teal that belongs to no current theme).
 * Deriving them here makes those slides follow the theme like everything else.
 *
 * Only fills gaps, so a theme that sets an alias explicitly still wins.
 */
function applyLegacyAliases(vars, theme) {
  const accent = cssVar(vars, '--t-color-accent');
  const brand = Array.isArray(theme.brandColors) ? theme.brandColors : [];
  const brandAt = (i) => cleanStr(brand[i]);

  const aliases = {
    '--t-primary': accent,
    '--t-accent': accent,
    '--t-bg-dark': cssVar(vars, '--t-slide-bg-dark'),
    '--t-brand-1': brandAt(1) || brandAt(0) || accent,
    '--t-brand-2': brandAt(2) || brandAt(1) || accent,
  };

  for (const [key, value] of Object.entries(aliases)) {
    if (!vars[key] && value) vars[key] = value;
  }
}

/**
 * Derive every computed token a theme needs at render time.
 *
 * @param {Object} theme - raw theme (file JSON, or a DB theme already expanded
 *   by `buildThemeConfig`)
 * @returns {Object} a normalized clone; non-object input is returned unchanged
 */
export function normalizeTheme(theme) {
  if (!theme || typeof theme !== 'object') return theme;

  const out = structuredClone(theme);
  const vars =
    out.cssVars && typeof out.cssVars === 'object' ? out.cssVars : {};
  out.cssVars = vars;

  // Theme-defined slide background variants → `--t-slide-bg-<id>*` vars.
  // Picker options and generated CSS read out.slideBackgrounds directly.
  out.slideBackgrounds = normalizeSlideBackgrounds(out.slideBackgrounds);
  Object.assign(vars, slideBackgroundCssVars(out.slideBackgrounds));

  // Extra on-brand text-colour swatches for the "This text" tab (beyond
  // default/muted/accent). Kept only for slots the theme actually coloured.
  out.textSwatches = normalizeTextSwatches(out.textSwatches, vars);

  // Slide type visibility. Back-compat: `hiddenSlideTypes` is an alias for
  // `slideTypes.exclude`.
  out.hiddenSlideTypes = uniqStrings(out.hiddenSlideTypes);
  out.slideTypes =
    out.slideTypes && typeof out.slideTypes === 'object' ? out.slideTypes : {};
  out.slideTypes.exclude = uniqStrings([
    ...(Array.isArray(out.slideTypes.exclude) ? out.slideTypes.exclude : []),
    ...out.hiddenSlideTypes,
  ]);
  out.slideTypes.include = uniqStrings(out.slideTypes.include);

  // Title slide type used for new presentations on this theme.
  out.defaultTitleSlide = cleanStr(out.defaultTitleSlide) || 'title-slide';

  const enabled = !!out?.gradient?.enabled;
  // Numeric "0/1" so it can be dropped straight into a CSS opacity.
  vars['--t-gradient-enabled'] = enabled ? '1' : '0';

  // Gradient enabled but no explicit gradient background: generate one from the
  // theme's own tokens. Unparseable colours skip generation (CSS falls back to
  // the solid background).
  if (enabled && !vars['--t-slide-gradient-bg']) {
    const c1 = cssVar(vars, '--t-quote-author-color');
    const c2 = cssVar(vars, '--t-color-accent');
    const c3 = cssVar(vars, '--t-slide-bg-mist');
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
      vars['--t-slide-gradient-bg'] = [
        `radial-gradient(circle at var(--g1x) var(--g1y), ${r1} 0%, ${r1b} 18%, ${r1c} 42%, rgba(0,0,0,0) 72%)`,
        `radial-gradient(circle at var(--g2x) var(--g2y), ${r2} 0%, ${r2b} 22%, ${r2c} 48%, rgba(0,0,0,0) 78%)`,
        `radial-gradient(circle at var(--g3x) var(--g3y), ${r3} 0%, ${r3b} 26%, ${r3c} 52%, rgba(0,0,0,0) 82%)`,
        base,
      ].join(', ');
    }
  }

  // Theme-wide light/dark poles for every auto-contrast decision below.
  const lightText = cleanStr(out.textColorLight) || '#ffffff';
  const darkText = cleanStr(out.textColorDark) || '#212121';
  const poles = { light: lightText, dark: darkText };

  if (!enabled) {
    // Chapter-title and quote slides render on the theme's dark surface
    // (background: var(--t-slide-bg-dark)), NOT on the page background —
    // defaulting to the regular text colour paints dark-on-dark there. Derive
    // from that surface's luminance whenever we can parse it.
    for (const key of ['--t-chapter-text-color', '--t-quote-text-color']) {
      if (vars[key]) continue;
      const surface = cssVar(vars, '--t-slide-bg-dark');
      vars[key] = hexToRgb(surface)
        ? pickTextColorForBg(surface, poles)
        : 'var(--t-color-text, #0b0b0b)';
    }
  } else if (!vars['--t-chapter-text-color']) {
    vars['--t-chapter-text-color'] = '#ffffff';
  }
  vars['--t-text-color-light'] = lightText;
  vars['--t-text-color-dark'] = darkText;

  // Accent contrast token (icon blocks etc).
  vars['--t-color-accent-contrast'] = pickTextColorForBg(
    cssVar(vars, '--t-color-accent'),
    poles
  );

  // Table style variants: when a theme overrides a variant's header, label-column
  // or body background, auto-derive readable text for it — the same "set a bg
  // token → get readable text for free" pattern as the accent contrast above.
  // Themes that set no --t-table-* tokens get the CSS palette defaults, so this
  // is a no-op for them.
  for (const variant of ['panel', 'soft']) {
    // '' is the body surface, which uses the slot-less token pair.
    for (const slot of ['header', 'firstcol', '']) {
      const suffix = slot ? `${slot}-` : '';
      const bgKey = `--t-table-${variant}-${suffix}bg`;
      const textKey = `--t-table-${variant}-${suffix}text`;
      const bgHex = cssVar(vars, bgKey);
      if (bgHex && !vars[textKey] && hexToRgb(bgHex)) {
        vars[textKey] = pickTextColorForBg(bgHex, poles);
      }
    }
  }

  // Icon-card-grid header text follows the gradient/solid split.
  vars['--t-icon-card-grid-text-color'] = enabled
    ? '#ffffff'
    : String(vars['--t-color-text'] || '#0b0b0b');
  vars['--t-icon-card-grid-subtitle-color'] = enabled
    ? 'rgba(255, 255, 255, 0.82)'
    : String(vars['--t-color-text-muted'] || 'rgba(11, 11, 11, 0.65)');

  // Icon block: prefer the theme's bright "lime" surface when it defines a real
  // colour (white doesn't count — icons would sit on white), else the accent.
  if (!vars['--t-icon-card-grid-icon-bg']) {
    const limeHex = cssVar(vars, '--t-slide-bg-lime');
    const limeLower = limeHex.toLowerCase();
    const useLime =
      !!hexToRgb(limeHex) && limeLower !== '#fff' && limeLower !== '#ffffff';
    vars['--t-icon-card-grid-icon-bg'] = useLime
      ? limeHex
      : cssVar(vars, '--t-color-accent') || '#385c5c';
  }

  const iconFg = pickTextColorForBg(
    cssVar(vars, '--t-icon-card-grid-icon-bg'),
    poles
  );
  vars['--t-icon-card-grid-icon-fg'] = iconFg;
  // Best-effort: recolor monochrome SVG <img> icons on icon-block backgrounds.
  vars['--t-icon-card-grid-icon-filter'] =
    iconFg === lightText ? 'brightness(0) invert(1)' : 'none';

  applyLegacyAliases(vars, out);

  return out;
}
