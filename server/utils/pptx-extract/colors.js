/**
 * DrawingML colour → `#rrggbb` (B828).
 *
 * A PowerPoint colour is rarely a plain hex value: text and fills name a
 * scheme slot (`accent1`, `tx1`), the slide master's `clrMap` says which
 * theme slot `tx1` and `bg1` stand for, and modifiers (`lumMod`, `lumOff`,
 * `hueOff`, `tint`, `shade`, ...) shift the result. This module resolves all
 * of that to the hex string the page model carries, the same form
 * `pdf-extract` measures. A gradient counts as its first stop (brief track
 * 1b, beslissing 1); a pattern as its foreground; alpha is ignored.
 */

import { child, path } from './xml.js';

/**
 * @typedef {object} ColorContext
 * @property {Record<string, string>} scheme - theme slot → `#rrggbb`
 *   (`dk1`, `lt1`, `accent1`, ...)
 * @property {Record<string, string>} clrMap - `tx1`/`bg1`/... → theme slot
 * @property {string | null} [phClr] - the colour `phClr` stands for, inside
 *   a theme style reference
 */

const COLOR_ELEMENTS = new Set([
  'a:srgbClr',
  'a:schemeClr',
  'a:sysClr',
  'a:prstClr',
  'a:scrgbClr',
  'a:hslClr',
]);

/** The preset colours a deck plausibly names; others resolve to null. */
const PRESET = {
  black: '000000',
  white: 'ffffff',
  red: 'ff0000',
  green: '008000',
  blue: '0000ff',
  yellow: 'ffff00',
  gray: '808080',
  grey: '808080',
  darkGray: 'a9a9a9',
  lightGray: 'd3d3d3',
  orange: 'ffa500',
};

const DEFAULT_CLR_MAP = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
};

/**
 * The colour scheme of a theme part.
 *
 * @param {import('./xml.js').XmlElement | null} theme - root of
 *   `ppt/theme/themeN.xml`
 * @returns {Record<string, string>}
 */
export function readColorScheme(theme) {
  const scheme = {};
  const clrScheme = path(theme, 'a:themeElements', 'a:clrScheme');
  for (const slot of clrScheme?.children || []) {
    const name = slot.name.replace(/^a:/, '');
    const color = colorOf(slot, { scheme: {}, clrMap: {} });
    if (color) scheme[name] = color;
  }
  return scheme;
}

/**
 * A `clrMap` (master) or `overrideClrMapping` (slide, layout) as a map.
 *
 * @param {import('./xml.js').XmlElement | null} el
 * @param {Record<string, string>} [base] - the map this one overrides
 * @returns {Record<string, string>}
 */
export function readClrMap(el, base = DEFAULT_CLR_MAP) {
  return el ? { ...base, ...el.attrs } : { ...base };
}

/**
 * The colour a fill-like parent holds: the first colour element among its
 * children, or the one inside them (`a:solidFill`, the first `a:gs` of a
 * `a:gradFill`, the foreground of a `a:pattFill`).
 *
 * @param {import('./xml.js').XmlElement | null} parent - e.g. an `a:rPr`,
 *   `p:spPr` or `p:bgPr`
 * @param {ColorContext} ctx
 * @returns {string | null | 'none'} `'none'` for an explicit `a:noFill`
 */
export function fillColor(parent, ctx) {
  if (!parent) return null;
  if (child(parent, 'a:noFill')) return 'none';
  const solid = child(parent, 'a:solidFill');
  if (solid) return colorOf(solid, ctx);
  const grad = child(parent, 'a:gradFill');
  if (grad) return colorOf(path(grad, 'a:gsLst', 'a:gs'), ctx);
  const patt = child(parent, 'a:pattFill');
  if (patt) return colorOf(child(patt, 'a:fgClr'), ctx);
  return null;
}

/**
 * Resolve the colour element inside `el` (or `el` itself) to `#rrggbb`.
 *
 * @param {import('./xml.js').XmlElement | null} el
 * @param {ColorContext} ctx
 * @returns {string | null}
 */
export function colorOf(el, ctx) {
  if (!el) return null;
  const node = COLOR_ELEMENTS.has(el.name)
    ? el
    : el.children.find((c) => COLOR_ELEMENTS.has(c.name));
  if (!node) return null;
  const base = baseColor(node, ctx);
  return base ? applyModifiers(base, node.children) : null;
}

/**
 * A scheme slot (`tx1`, `bg1`, `accent1`, ...) as `#rrggbb`, through the
 * clrMap in force.
 *
 * @param {string} val
 * @param {ColorContext} ctx
 * @returns {string | null}
 */
export function schemeColor(val, ctx) {
  return baseColor({ name: 'a:schemeClr', attrs: { val }, children: [] }, ctx);
}

function baseColor(node, ctx) {
  const { val } = node.attrs;
  switch (node.name) {
    case 'a:srgbClr':
      return hex(val);
    case 'a:sysClr':
      return hex(node.attrs.lastClr) || (val === 'window' ? '#ffffff' : null);
    case 'a:prstClr':
      return PRESET[val] ? `#${PRESET[val]}` : null;
    case 'a:scrgbClr':
      return rgbToHex(
        ['r', 'g', 'b'].map((k) => (255 * Number(node.attrs[k] || 0)) / 100000),
      );
    case 'a:hslClr':
      return rgbToHex(
        hslToRgb(
          Number(node.attrs.hue || 0) / 60000,
          Number(node.attrs.sat || 0) / 100000,
          Number(node.attrs.lum || 0) / 100000,
        ),
      );
    case 'a:schemeClr': {
      if (val === 'phClr') return ctx.phClr || null;
      const slot = ctx.clrMap?.[val] || val;
      return ctx.scheme?.[slot] || null;
    }
    default:
      return null;
  }
}

function hex(value) {
  return /^[0-9a-f]{6}$/i.test(value || '') ? `#${value.toLowerCase()}` : null;
}

/**
 * Apply the DrawingML colour modifiers in document order. Luminance, hue
 * and saturation work in HSL, as PowerPoint does (measured: Keynote's
 * `accent1` `#00a2ff` with `hueOff 114395` and `lumOff -24975` renders as
 * `#004d80` in the exported PDF); `tint` and `shade` mix towards white and
 * black.
 */
function applyModifiers(color, modifiers) {
  let [r, g, b] = hexToRgb(color);
  for (const mod of modifiers) {
    const v = Number(mod.attrs.val) / 100000;
    if (!Number.isFinite(v)) continue;
    const op = mod.name.replace(/^a:/, '');
    if (op === 'tint') [r, g, b] = [r, g, b].map((c) => c * v + 255 * (1 - v));
    else if (op === 'shade') [r, g, b] = [r, g, b].map((c) => c * v);
    else if (HSL_OPS[op]) {
      const [h, s, l] = rgbToHsl(r, g, b);
      [r, g, b] = hslToRgb(...HSL_OPS[op](h, s, l, v));
    }
  }
  return rgbToHex([r, g, b]);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const HSL_OPS = {
  lumMod: (h, s, l, v) => [h, s, clamp01(l * v)],
  lumOff: (h, s, l, v) => [h, s, clamp01(l + v)],
  satMod: (h, s, l, v) => [h, clamp01(s * v), l],
  satOff: (h, s, l, v) => [h, clamp01(s + v), l],
  hueMod: (h, s, l, v) => [(((h * v) % 360) + 360) % 360, s, l],
  // `val` is in 60000ths of a degree; read as /100000 above, so rescale.
  hueOff: (h, s, l, v) => [
    (((h + (v * 100000) / 60000) % 360) + 360) % 360,
    s,
    l,
  ],
};

function hexToRgb(color) {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function rgbToHsl(r, g, b) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
  else if (max === G) h = ((B - R) / d + 2) * 60;
  else h = ((R - G) / d + 4) * 60;
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return [r, g, b].map((v) => (v + m) * 255);
}
