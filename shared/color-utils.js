/**
 * Shared colour primitives — the single home for WCAG luminance, contrast
 * ratio, and readable-text selection.
 *
 * Client and server both import this so one definition backs every contrast
 * decision: theme building (server), token derivation (shared), slide render
 * (card-stack, charts) and the theme editor (client). The formula
 * `0.2126R + 0.7152G + 0.0722B` used to live in six near-identical copies, and
 * three `pickTextColorForBg` variants that disagreed on the default dark pole —
 * so the same background could resolve to different text colours depending on
 * which copy ran. This module ends that drift.
 *
 * Client-editor-only helpers (HSL conversion, palette derivation, lighten /
 * darken) stay in `client/lib/theme/color-utils.js`, which re-exports these
 * primitives so browser code keeps its single import point.
 */

/**
 * Parse a hex colour (`#rgb` or `#rrggbb`, `#` optional) to an RGB object.
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

/**
 * WCAG relative luminance (0–1) for an RGB object.
 * @param {{r: number, g: number, b: number}} rgb
 * @returns {number}
 */
export function getRelativeLuminance({ r, g, b }) {
  const toLin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

/**
 * WCAG contrast ratio (1–21) from two relative luminances.
 *
 * The luminance-level entry point, for callers that already have luminances and
 * would otherwise re-implement the formula — the background-image sampler walks
 * a thousand pixels and never sees a hex string. {@link getContrastRatio} is the
 * hex-level wrapper over this; between them they are the only place in the repo
 * that spells `(lighter + 0.05) / (darker + 0.05)`.
 * @param {number} l1
 * @param {number} l2
 * @returns {number}
 */
export function contrastRatioFromLuminance(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG contrast ratio (1–21) between two hex colours. Order-independent.
 * @param {string} color1
 * @param {string} color2
 * @returns {number} 1 when either colour is unparseable
 */
export function getContrastRatio(color1, color2) {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  if (!rgb1 || !rgb2) return 1;
  return contrastRatioFromLuminance(
    getRelativeLuminance(rgb1),
    getRelativeLuminance(rgb2)
  );
}

/**
 * Pick the readable text colour (the light or dark pole) for a background, by
 * measuring both poles with {@link getContrastRatio} and returning the winner.
 *
 * This deliberately does *not* split on a luminance midpoint. A midpoint picks
 * the pole that looks logical rather than the pole that actually reads: white
 * on `#a78bfa` scores 2.72:1 where the dark pole scores 5.92:1, and both sides
 * of a midpoint split can land under WCAG AA (4.5:1) without anything flagging
 * it. Because contrast is not symmetric around L=0.5, the crossover sits near
 * L≈0.21 for the default poles — so mid-light backgrounds now get dark text.
 *
 * Ties go to the dark pole, matching the unparseable fallback.
 * @param {string} bgHex
 * @param {{light?: string, dark?: string}} [poles]
 * @returns {string} the light or dark pole (dark when bgHex is unparseable)
 */
export function pickTextColorForBg(bgHex, { light = '#ffffff', dark = '#212121' } = {}) {
  if (!hexToRgb(bgHex)) return dark;
  return getContrastRatio(bgHex, light) > getContrastRatio(bgHex, dark) ? light : dark;
}
