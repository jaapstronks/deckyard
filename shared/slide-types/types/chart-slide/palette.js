import { hexToRgb, getRelativeLuminance } from '../../../color-utils.js';

function shouldUseLightText(bg) {
  const rgb = hexToRgb(bg);
  if (!rgb) return true; // safe default: white is readable on most saturated colors
  return getRelativeLuminance(rgb) < 0.5;
}

/**
 * The series palette a theme without `--t-chart-*` gets. Slot 0 is the accent,
 * as in CSS; the accent fallback is the `--slide-accent` default. This list is
 * the one source: the `--slide-chart-{1..7}` fallbacks in
 * `client/styles/slides/00-tokens.css` mirror it, pinned by
 * tests/chart-slide-styles.test.js.
 */
export const CHART_FALLBACK_ACCENT = '#385c5c';
export const CHART_FALLBACK_PALETTE = Object.freeze([
  CHART_FALLBACK_ACCENT,
  '#5d989a',
  '#848f52',
  '#aebd63',
  '#a2afa7',
  '#e0e6e2',
  '#2c4a4b',
  '#cfd887',
]);

export function themeChartPalette(theme) {
  const vars =
    theme?.cssVars && typeof theme.cssVars === 'object' ? theme.cssVars : {};
  const out = [];
  for (let i = 0; i < 8; i += 1) {
    const raw = vars[`--t-chart-${i}`];
    const v = String(raw || '').trim();
    if (v) out.push(v);
  }
  if (out.length) return out;
  const accent = String(vars['--t-color-accent'] || '').trim();
  return [accent || CHART_FALLBACK_ACCENT, ...CHART_FALLBACK_PALETTE.slice(1)];
}

export function pieLabelInvertClass(i, palette) {
  const pal = Array.isArray(palette) ? palette : [];
  const c = pal.length ? pal[i % pal.length] : null;
  return shouldUseLightText(c) ? ' is-invert' : '';
}
