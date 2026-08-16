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
import { TITLE_LAYOUTS, DEFAULT_TITLE_LAYOUT } from './theme-config-schema.js';
import { hexToRgb, pickTextColorForBg } from './color-utils.js';

// Re-exported so long-standing importers keep their entry point: the theme
// editor's variants section imports pickTextColorForBg here, and the tests
// import hexToRgb here.
export { hexToRgb, pickTextColorForBg };

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

function rgba(hex, a) {
  const c = hexToRgb(hex);
  if (!c) return null;
  const alpha = Math.max(0, Math.min(1, Number(a)));
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

const cssVar = (vars, key) => String(vars[key] || '').trim();

/**
 * Fill the brand colour slots from the theme's `brandColors` array.
 *
 * `--t-color-brand-{1..3}` are the role-shaped brand slots (`--slide-brand-*`
 * reads them: countdown's brand background variants, the tf-color-brand-*
 * text styles). A theme may set a slot explicitly (playful does, and that
 * always wins); for the rest, slot N is brandColors[N-1] — the same list the
 * theme already declares, so the slots follow the theme without a second
 * spelling. The legacy `--t-primary`/`--t-accent`/`--t-bg-dark`/`--t-brand-*`
 * alias family this replaces is gone: nothing reads it.
 */
function applyBrandSlots(vars, theme) {
  const brand = Array.isArray(theme.brandColors) ? theme.brandColors : [];
  for (let n = 1; n <= 3; n++) {
    const key = `--t-color-brand-${n}`;
    const value = cleanStr(brand[n - 1]);
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

  // Slide type visibility. `slideTypes.exclude` is the only spelling; the
  // legacy `hiddenSlideTypes` alias is folded in here and then dropped, so no
  // consumer downstream ever sees a second field meaning the same thing. This
  // is the normalize-and-remove seam: a theme file may still carry the alias,
  // a normalized theme never does.
  out.slideTypes =
    out.slideTypes && typeof out.slideTypes === 'object' ? out.slideTypes : {};
  out.slideTypes.exclude = uniqStrings([
    ...(Array.isArray(out.slideTypes.exclude) ? out.slideTypes.exclude : []),
    ...uniqStrings(out.hiddenSlideTypes),
  ]);
  out.slideTypes.include = uniqStrings(out.slideTypes.include);
  delete out.hiddenSlideTypes;

  // Title slide type used for new presentations on this theme.
  out.defaultTitleSlide = cleanStr(out.defaultTitleSlide) || 'title-slide';

  // Theme-driven title-slide layout (bottom | center | top). Validated here so
  // every consumer of a normalized theme can trust `ctx.theme.titleLayout`.
  out.titleLayout = TITLE_LAYOUTS.includes(cleanStr(out.titleLayout))
    ? cleanStr(out.titleLayout)
    : DEFAULT_TITLE_LAYOUT;

  const enabled = !!out?.gradient?.enabled;
  // Numeric "0/1" so it can be dropped straight into a CSS opacity.
  vars['--t-gradient-enabled'] = enabled ? '1' : '0';

  // Gradient enabled but no explicit gradient background: generate one from the
  // theme's own tokens. Unparseable colours skip generation (CSS falls back to
  // the solid background).
  if (enabled && !vars['--t-slide-gradient-bg']) {
    const c1 = cssVar(vars, '--t-color-accent-on-dark');
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

  // The dark surface's own text answer (--slide-on-bg-dark reads it): quote
  // and chapter-title render on `--t-slide-bg-dark`, NOT on the page
  // background — defaulting to the regular text colour paints dark-on-dark
  // there. With gradient branding on, those types paint the (deep) gradient
  // instead, so the answer is plain white; otherwise derive from the
  // surface's luminance whenever we can parse it.
  if (!vars['--t-slide-bg-dark-text']) {
    const surface = cssVar(vars, '--t-slide-bg-dark');
    vars['--t-slide-bg-dark-text'] = enabled
      ? '#ffffff'
      : hexToRgb(surface)
        ? pickTextColorForBg(surface, poles)
        : 'var(--t-color-text, #0b0b0b)';
  }
  // The gradient layer's text pair (--slide-on-gradient(-muted)): only emitted
  // when the gradient is on, so the roles fall through to the plain
  // on-surface pair on solid themes.
  if (enabled) {
    if (!vars['--t-slide-gradient-text'])
      vars['--t-slide-gradient-text'] = '#ffffff';
    if (!vars['--t-slide-gradient-text-muted'])
      vars['--t-slide-gradient-text-muted'] = 'rgba(255, 255, 255, 0.82)';
  }
  vars['--t-text-color-light'] = lightText;
  vars['--t-text-color-dark'] = darkText;

  // Accent contrast token (icon blocks etc).
  vars['--t-color-accent-contrast'] = pickTextColorForBg(
    cssVar(vars, '--t-color-accent'),
    poles
  );

  // Nested-surface text colours: same "set a bg token → get readable text for
  // free" pattern as the accent above, for the two built-in slide surfaces.
  //
  // These are NOT the same question as `--t-color-text`. That one answers "what
  // reads on the slide background", and a slide-background VARIANT may flip it
  // to white. An element that paints lime or mist on top of that variant did
  // not flip with it, so its text needs the surface's own answer — otherwise
  // you get white on lime, which is the funnel-bar defect.
  //
  // Derived, never assumed: `midnight` ships lime as #18181b, so hardcoding a
  // dark pole here would be wrong for a shipped theme. A theme-declared variant
  // already gets `--t-slide-bg-<id>-text` from its own `textColor`
  // (shared/theme-slide-backgrounds.js); this covers the two that predate that
  // mechanism. See docs/reference/nested-surfaces.md.
  for (const surface of ['lime', 'mist']) {
    const key = `--t-slide-bg-${surface}-text`;
    if (vars[key]) continue;
    const bgHex = cssVar(vars, `--t-slide-bg-${surface}`);
    if (hexToRgb(bgHex)) vars[key] = pickTextColorForBg(bgHex, poles);
  }

  // The soft accent plane (--slide-accent-soft reads it): the tinted block a
  // type paints to carry icons or soft emphasis. Every shipped theme used its
  // mist tint here when mist is bright, and the accent when it is not
  // (midnight's mist is dark) — that is the generic rule, so themes no longer
  // set it by hand. A theme can still override via --t-color-accent-soft.
  if (!vars['--t-color-accent-soft']) {
    const mistHex = cssVar(vars, '--t-slide-bg-mist');
    const mistIsBright =
      !!hexToRgb(mistHex) && pickTextColorForBg(mistHex, poles) === darkText;
    vars['--t-color-accent-soft'] = mistIsBright
      ? mistHex
      : cssVar(vars, '--t-color-accent') || '#385c5c';
  }
  // …and what reads on it — same derive-from-the-surface pattern as above.
  if (!vars['--t-color-accent-soft-contrast']) {
    vars['--t-color-accent-soft-contrast'] = pickTextColorForBg(
      cssVar(vars, '--t-color-accent-soft'),
      poles
    );
  }

  applyBrandSlots(vars, out);

  return out;
}
