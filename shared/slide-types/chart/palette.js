import { hexToRgb, getRelativeLuminance } from '../../color-utils.js';

function shouldUseLightText(bg) {
  const rgb = hexToRgb(bg);
  if (!rgb) return true; // safe default: white is readable on most saturated colors
  return getRelativeLuminance(rgb) < 0.5;
}

export function themeChartPalette(theme) {
  const vars =
    theme?.cssVars && typeof theme.cssVars === 'object' ? theme.cssVars : {};
  const out = [];
  for (let i = 0; i < 8; i += 1) {
    const raw = vars[`--t-chart-${i}`];
    const v = String(raw || '').trim();
    if (v) out.push(v);
  }
  // Fallback to the historical palette (pre-theme-era chart defaults).
  if (out.length) return out;
  return [
    '#375c5d',
    '#5d989a',
    '#848f52',
    '#aebd63',
    '#a2afa7',
    '#e0e6e2',
    '#2c4a4b',
    '#cfd887',
  ];
}

export function pieLabelInvertClass(i, palette) {
  const pal = Array.isArray(palette) ? palette : [];
  const c = pal.length ? pal[i % pal.length] : null;
  return shouldUseLightText(c) ? ' is-invert' : '';
}
