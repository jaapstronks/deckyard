function hexToRgb(hex) {
  const s = String(hex || '').trim();
  const m = s.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
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

function shouldUseLightText(bg) {
  const rgb = hexToRgb(bg);
  if (!rgb) return true; // safe default: white is readable on most saturated colors
  const lum = relLuminance(rgb);
  return lum < 0.5;
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
