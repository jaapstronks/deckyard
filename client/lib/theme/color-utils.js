/**
 * Color manipulation utilities for the theme editor.
 *
 * The WCAG primitives (hex parsing, luminance, contrast ratio, readable-text
 * selection) live in `shared/color-utils.js` so client and server share one
 * definition. They are re-exported here so browser modules keep a single
 * colour-helper import point; the editor-only helpers below (HSL conversion,
 * palette derivation, lighten / darken) stay client-side.
 */

import {
  hexToRgb,
  getRelativeLuminance,
  getContrastRatio,
  pickTextColorForBg,
} from '../../../shared/color-utils.js';

export { hexToRgb, getRelativeLuminance, getContrastRatio };

/**
 * Convert RGB to hex color.
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} - Hex color
 */
export function rgbToHex(r, g, b) {
  const toHex = (n) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Convert hex to HSL.
 * @param {string} hex - Hex color
 * @returns {Object|null} - HSL object { h, s, l } or null
 */
export function hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Convert HSL to hex.
 * @param {number} h - Hue (0-360)
 * @param {number} s - Saturation (0-100)
 * @param {number} l - Lightness (0-100)
 * @returns {string} - Hex color
 */
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0,
    g = 0,
    b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/**
 * Pick appropriate text color (light or dark) for a background.
 * Thin alias over the shared `pickTextColorForBg` primitive.
 * @param {string} backgroundColor - Background hex color
 * @param {Object} options - Light and dark text colors
 * @returns {string} - Appropriate text color
 */
export function getContrastColor(backgroundColor, poles) {
  return pickTextColorForBg(backgroundColor, poles || {});
}

/**
 * Derive a color palette from a primary color.
 * Generates variations suitable for charts, cards, etc.
 * @param {string} primary - Primary hex color
 * @returns {string[]} - Array of 4-6 hex colors
 */
export function deriveColorPalette(primary) {
  const hsl = hexToHsl(primary);
  if (!hsl) return [primary, primary, primary, primary];

  const { h, s, l } = hsl;

  // Generate a palette with variations in lightness and saturation
  return [
    primary, // Primary (as-is)
    hslToHex(h, Math.min(100, s * 0.85), Math.min(85, l + 15)), // Lighter
    hslToHex(h, Math.min(100, s * 0.7), Math.min(90, l + 25)), // Even lighter
    hslToHex(h, Math.min(100, s * 0.5), Math.min(95, l + 35)), // Very light
    hslToHex(h, Math.min(100, s * 1.1), Math.max(15, l - 15)), // Darker
    hslToHex((h + 30) % 360, s, l), // Complementary shade
  ];
}

/**
 * Lighten a color by a percentage.
 * @param {string} hex - Hex color
 * @param {number} percent - Percentage to lighten (0-100)
 * @returns {string} - Lightened hex color
 */
export function lighten(hex, percent) {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  return hslToHex(hsl.h, hsl.s, Math.min(100, hsl.l + percent));
}

/**
 * Darken a color by a percentage.
 * @param {string} hex - Hex color
 * @param {number} percent - Percentage to darken (0-100)
 * @returns {string} - Darkened hex color
 */
export function darken(hex, percent) {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  return hslToHex(hsl.h, hsl.s, Math.max(0, hsl.l - percent));
}

/**
 * Check if a color is valid hex format.
 * @param {string} color - Color string
 * @returns {boolean}
 */
export function isValidHexColor(color) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(color || '').trim());
}

/**
 * Normalize a hex color to 6-digit format with # prefix.
 * @param {string} hex - Hex color
 * @returns {string|null} - Normalized hex or null
 */
export function normalizeHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

/**
 * Create an RGBA color string from hex.
 * @param {string} hex - Hex color
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} - RGBA string
 */
export function hexToRgba(hex, alpha = 1) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}
