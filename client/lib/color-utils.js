/**
 * Color manipulation utilities for the theme editor.
 */

/**
 * Convert hex color to RGB object.
 * @param {string} hex - Hex color string
 * @returns {Object|null} - RGB object or null
 */
export function hexToRgb(hex) {
  const s = String(hex || '').trim();

  // Try 6-digit hex
  const m6 = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (m6) {
    const n = parseInt(m6[1], 16);
    return {
      r: (n >> 16) & 255,
      g: (n >> 8) & 255,
      b: n & 255,
    };
  }

  // Try 3-digit hex
  const m3 = s.match(/^#?([0-9a-fA-F]{3})$/);
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
 * Calculate relative luminance for WCAG contrast.
 * @param {Object} rgb - RGB object { r, g, b }
 * @returns {number} - Luminance (0-1)
 */
export function getRelativeLuminance({ r, g, b }) {
  const toLin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

/**
 * Calculate contrast ratio between two colors.
 * @param {string} color1 - First hex color
 * @param {string} color2 - Second hex color
 * @returns {number} - Contrast ratio (1-21)
 */
export function getContrastRatio(color1, color2) {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  if (!rgb1 || !rgb2) return 1;

  const l1 = getRelativeLuminance(rgb1);
  const l2 = getRelativeLuminance(rgb2);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Pick appropriate text color (light or dark) for a background.
 * Uses WCAG luminance formula.
 * @param {string} backgroundColor - Background hex color
 * @param {Object} options - Light and dark text colors
 * @returns {string} - Appropriate text color
 */
export function getContrastColor(backgroundColor, { light = '#ffffff', dark = '#1f2937' } = {}) {
  const rgb = hexToRgb(backgroundColor);
  if (!rgb) return dark;

  const luminance = getRelativeLuminance(rgb);
  return luminance > 0.5 ? dark : light;
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
