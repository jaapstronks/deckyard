/**
 * Theme builder utilities.
 * Converts custom theme database records to the theme JSON format
 * used by the existing presentation rendering system.
 */

import {
  getFontByFamily,
  getFontFamilyCSS,
  fontFamilyToSlug,
} from '../../shared/theme-fonts.js';

// ============================================================
// COLOR UTILITIES
// ============================================================

/**
 * Convert hex color to RGB object.
 * @param {string} hex - Hex color string
 * @returns {Object|null} - RGB object or null
 */
export function hexToRgb(hex) {
  const s = String(hex || '').trim();
  const m = s.match(/^#?([0-9a-f]{6})$/i);
  if (!m) {
    // Try 3-digit hex
    const m3 = s.match(/^#?([0-9a-f]{3})$/i);
    if (m3) {
      const r = parseInt(m3[1][0] + m3[1][0], 16);
      const g = parseInt(m3[1][1] + m3[1][1], 16);
      const b = parseInt(m3[1][2] + m3[1][2], 16);
      return { r, g, b };
    }
    return null;
  }
  const n = parseInt(m[1], 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

/**
 * Convert RGB to hex color.
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} - Hex color
 */
function rgbToHex(r, g, b) {
  const toHex = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Convert hex to HSL.
 * @param {string} hex - Hex color
 * @returns {Object|null} - HSL object { h, s, l }
 */
function hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
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

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Convert HSL to hex.
 * @param {number} h - Hue (0-360)
 * @param {number} s - Saturation (0-100)
 * @param {number} l - Lightness (0-100)
 * @returns {string} - Hex color
 */
function hslToHex(h, s, l) {
  h = h / 360;
  s = s / 100;
  l = l / 100;

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return rgbToHex(r * 255, g * 255, b * 255);
}

/**
 * Derive a color palette from a primary color.
 * Generates variations for charts, cards, etc.
 * @param {string} primary - Primary hex color
 * @returns {string[]} - Array of hex colors
 */
export function deriveColorPalette(primary) {
  const hsl = hexToHsl(primary);
  if (!hsl) return [primary, primary, primary, primary];

  const { h, s, l } = hsl;

  // Generate a 4-color palette:
  // 1. Primary (as-is)
  // 2. Lighter variation
  // 3. Even lighter
  // 4. Very light (for backgrounds)
  return [
    primary,
    hslToHex(h, Math.min(100, s * 0.9), Math.min(85, l * 1.15)),
    hslToHex(h, Math.min(100, s * 0.7), Math.min(90, l * 1.3)),
    hslToHex(h, Math.min(100, s * 0.5), Math.min(95, l * 1.4)),
  ];
}

/**
 * Calculate relative luminance for WCAG contrast.
 * @param {Object} rgb - RGB object
 * @returns {number} - Luminance (0-1)
 */
function relLuminance({ r, g, b }) {
  const toLin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

/**
 * Pick appropriate text color (light or dark) for a background.
 * @param {string} bgHex - Background hex color
 * @param {Object} options - Light and dark text colors
 * @returns {string} - Appropriate text color
 */
export function pickTextColorForBg(bgHex, { light = '#ffffff', dark = '#1f2937' } = {}) {
  const c = hexToRgb(bgHex);
  if (!c) return dark;
  const lum = relLuminance(c);
  return lum < 0.5 ? light : dark;
}

/**
 * Create an RGBA color string.
 * @param {string} hex - Hex color
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string|null} - RGBA string or null
 */
function rgba(hex, alpha) {
  const c = hexToRgb(hex);
  if (!c) return null;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

// ============================================================
// THEME BUILDING
// ============================================================

/**
 * Build a full theme configuration from a custom theme database record.
 * This converts the simplified custom theme format to the full theme JSON
 * format used by the existing presentation rendering system.
 *
 * @param {Object} dbTheme - Custom theme from database
 * @param {Object} [options] - Additional options
 * @param {Array} [options.managedFonts] - Pre-fetched managed font families for the org
 * @returns {Object} - Full theme configuration
 */
export function deriveThemeTokens({
  colors = {},
  fonts = {},
  managedFonts,
  logoUrl = null,
} = {}) {
  const primary = colors.primary || '#3B82F6';
  const background = colors.background || '#ffffff';
  const textLight = colors.textLight || '#ffffff';
  const textDark = colors.textDark || '#1f2937';

  const headingFont = fonts.heading || 'Inter';
  const bodyFont = fonts.body || 'Inter';
  const headingFamilyId = fonts.headingFamilyId || null;
  const bodyFamilyId = fonts.bodyFamilyId || null;

  // Resolve managed fonts if familyId is present
  const managedFontMap = {};
  if (Array.isArray(managedFonts)) {
    for (const mf of managedFonts) {
      managedFontMap[mf.id] = mf;
    }
  }
  const headingManaged = headingFamilyId ? managedFontMap[headingFamilyId] : null;
  const bodyManaged = bodyFamilyId ? managedFontMap[bodyFamilyId] : null;

  // Derive color palette from primary
  const brandColors = deriveColorPalette(primary);

  // Determine text color based on background
  const textColor = pickTextColorForBg(background, { light: textLight, dark: textDark });
  const textMuted = rgba(textColor, 0.7) || 'rgba(31, 41, 55, 0.7)';

  // Generate mist/accent background (lighter version of primary)
  const primaryHsl = hexToHsl(primary);
  const mistBg = primaryHsl
    ? hslToHex(primaryHsl.h, Math.min(40, primaryHsl.s * 0.5), 97)
    : '#f8fafc';
  // Dark surface: a deep, brand-tinted tone (not the page background). Quote and
  // chapter-title slides render white text on this, so it MUST be dark — a light
  // value here means white-on-white.
  const darkBg = primaryHsl
    ? hslToHex(primaryHsl.h, Math.min(45, primaryHsl.s), 14)
    : '#111827';

  const cssVars = {
    // Core colors
    '--t-color-background': background,
    '--t-color-text': textColor,
    '--t-color-text-muted': textMuted,
    '--t-color-accent': primary,
    '--t-color-accent-contrast': pickTextColorForBg(primary, {
      light: textLight,
      dark: textDark,
    }),

    // Slide backgrounds (lime = page surface, mist = soft tint, dark = deep)
    '--t-slide-bg-lime': background,
    '--t-slide-bg-mist': mistBg,
    '--t-slide-bg-dark': darkBg,

    // Quote styling
    '--t-quote-author-color': primary,

    // Border radii (using sensible defaults)
    '--t-radius': '16px',
    '--t-radius-sm': '12px',
    '--t-radius-lg': '20px',

    // Fonts
    '--t-font-heading': getManagedFontCSS(headingManaged, headingFont),
    '--t-font-body': getManagedFontCSS(bodyManaged, bodyFont),
    '--t-font-caption': 'var(--t-font-body)',
    '--t-font-mono':
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',

    // Heading styling
    '--t-heading-transform': 'none',
    '--t-heading-weight': '700',

    // Icon card grid
    '--t-icon-card-grid-icon-bg': mistBg,

    // Chart colors
    '--t-chart-0': brandColors[0],
    '--t-chart-1': brandColors[1],
    '--t-chart-2': brandColors[2],
    '--t-chart-3': brandColors[3],
    '--t-chart-4': textColor,
    '--t-chart-5': textMuted,
    '--t-chart-6': primary,
    '--t-chart-7': mistBg,

    // Logo URL (if provided)
    ...(logoUrl ? { '--t-logo-url': `url('${logoUrl}')` } : {}),
  };

  return {
    cssVars,
    brandColors,
    textLight,
    textDark,
    headingManaged,
    bodyManaged,
  };
}

export function buildThemeConfig(dbTheme, { managedFonts } = {}) {
  const colors = dbTheme.colors || {};
  const fonts = dbTheme.fonts || {};

  const { cssVars, brandColors, textLight, textDark, headingManaged, bodyManaged } =
    deriveThemeTokens({
      colors,
      fonts,
      managedFonts,
      logoUrl: dbTheme.logoUrl,
    });

  // Build embed fonts array and external font links
  const embedFonts = buildEmbedFontsArray(fonts, { headingManaged, bodyManaged });
  const externalFontLinks = buildExternalFontLinks({ headingManaged, bodyManaged });

  // Determine logos - title slide can have a separate smaller logo
  const mainLogo = dbTheme.logoUrl || '/assets/images/deckyard-mark.svg';
  const titleLogo = dbTheme.logoSmallUrl || mainLogo;

  return {
    id: dbTheme.slug || dbTheme.id,
    label: dbTheme.label,
    defaultTitleSlide: 'title-slide',
    assets: {
      // Main logo (used as fallback)
      logo: mainLogo,
      logoAlt: dbTheme.label,
      // Title slide logo (smaller version if provided)
      titleLogo: titleLogo,
      titleLogoAlt: dbTheme.label,
      // Payoff slide logo (uses main logo)
      payoffLogo: mainLogo,
      payoffAlt: dbTheme.label,
    },
    textColorLight: textLight,
    textColorDark: textDark,
    brandColors,
    gradient: { enabled: false },
    slides: {
      'card-stack-slide': {
        colors: brandColors,
      },
    },
    cssVars,
    embedFonts,
    externalFontLinks,
    hiddenSlideTypes: [],
    backgroundPresets: [],
    // Mark as custom theme for the system
    _isCustomTheme: true,
    _customThemeId: dbTheme.id,
  };
}

/**
 * Build the embedFonts array for a theme's fonts.
 * Handles both curated fonts (path-based) and managed uploaded fonts (URL-based).
 * @param {Object} fonts - Font configuration { heading, body }
 * @param {Object} [managed] - Resolved managed font objects
 * @returns {Array} - Array of font embed objects
 */
function buildEmbedFontsArray(fonts, { headingManaged, bodyManaged } = {}) {
  const embedFonts = [];
  const addedFonts = new Set();

  const addCuratedFont = (family) => {
    if (addedFonts.has(family)) return;
    addedFonts.add(family);

    const fontInfo = getFontByFamily(family);
    if (!fontInfo) return;

    const slug = fontFamilyToSlug(family);

    // Add each weight
    for (const weight of fontInfo.weights) {
      embedFonts.push({
        family,
        path: `assets/fonts/google/${slug}/${slug}-${weight}.woff2`,
        weight,
        style: 'normal',
      });
    }
  };

  const addManagedFont = (managed) => {
    if (!managed || addedFonts.has(managed.id)) return;
    addedFonts.add(managed.id);

    // Only uploaded fonts have embeddable files
    if (managed.source !== 'upload' || !Array.isArray(managed.variants)) return;

    for (const variant of managed.variants) {
      if (!variant.url) continue;
      embedFonts.push({
        family: managed.name,
        url: variant.url,
        weight: variant.weight || 400,
        style: variant.style || 'normal',
        format: variant.format || 'woff2',
      });
    }
  };

  // Add managed fonts first (uploaded), then curated fallbacks
  if (headingManaged && headingManaged.source === 'upload') {
    addManagedFont(headingManaged);
  } else if (fonts.heading) {
    addCuratedFont(fonts.heading);
  }

  if (bodyManaged && bodyManaged.source === 'upload') {
    addManagedFont(bodyManaged);
  } else if (fonts.body) {
    addCuratedFont(fonts.body);
  }

  return embedFonts;
}

/**
 * Build external font link/script references for non-upload managed fonts.
 * @param {Object} managed - Resolved managed font objects
 * @returns {Array} - Array of { type: 'css'|'js', url: string }
 */
function buildExternalFontLinks({ headingManaged, bodyManaged } = {}) {
  const links = [];
  const added = new Set();

  const addLinks = (managed) => {
    if (!managed || added.has(managed.id)) return;
    added.add(managed.id);

    const config = managed.sourceConfig || {};

    switch (managed.source) {
      case 'adobe':
        if (config.projectId) {
          links.push({ type: 'css', url: `https://use.typekit.net/${config.projectId}.css` });
        }
        break;
      case 'monotype':
        if (config.projectId) {
          links.push({ type: 'js', url: `https://fast.fonts.net/jsapi/${config.projectId}.js` });
        }
        break;
      case 'google': {
        const spec = config.spec || managed.name;
        // Parse spec: "Open Sans:400,700" → family "Open Sans", weights [400,700]
        const colonIdx = spec.indexOf(':');
        const familyName = colonIdx > 0 ? spec.slice(0, colonIdx).trim() : spec.trim();
        const weightsStr = colonIdx > 0 ? spec.slice(colonIdx + 1).trim() : '';
        const weights = weightsStr
          ? weightsStr.split(',').map((w) => w.trim()).filter(Boolean).join(';')
          : '400;600;700';
        const encodedFamily = encodeURIComponent(familyName);
        links.push({
          type: 'css',
          url: `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@${weights}&display=swap`,
        });
        break;
      }
      // 'upload' fonts are embedded, not linked
    }
  };

  addLinks(headingManaged);
  addLinks(bodyManaged);
  return links;
}

/**
 * Get CSS font-family value for a managed font or curated font.
 * @param {Object|null} managed - Managed font object (or null)
 * @param {string} family - Font family name (curated fallback)
 * @returns {string} - CSS font-family value
 */
function getManagedFontCSS(managed, family) {
  if (managed) {
    const fallback = managed.cssFallback || getCategoryFallback(managed.category);
    return `'${managed.name}', ${fallback}`;
  }
  return getFontFamilyCSS(family);
}

/**
 * Get CSS fallback for a font category.
 */
function getCategoryFallback(category) {
  switch (category) {
    case 'serif':
      return 'serif';
    case 'monospace':
      return 'monospace';
    default:
      return 'sans-serif';
  }
}

/**
 * Tokens the live preview needs. A subset of the full derived set — the preview
 * paints a single sample slide, not the whole slide-type catalogue.
 */
const PREVIEW_TOKENS = [
  '--t-color-background',
  '--t-color-text',
  '--t-color-text-muted',
  '--t-color-accent',
  '--t-color-accent-contrast',
  '--t-slide-bg-lime',
  '--t-slide-bg-mist',
  '--t-slide-bg-dark',
  '--t-quote-author-color',
  '--t-font-heading',
  '--t-font-body',
  '--t-heading-weight',
  '--t-chart-0',
  '--t-chart-1',
  '--t-chart-2',
  '--t-chart-3',
];

/**
 * Strip characters that would let a value escape its declaration and open a new
 * rule. Values reaching here are not all trusted: the preview route takes them
 * from the query string, and a managed font's `name` is free text from the DB.
 * @param {*} value
 * @returns {string}
 */
function cssValueSafe(value) {
  return String(value ?? '').replace(/[;{}<>]/g, '');
}

/**
 * Generate CSS for theme preview (live preview in editor).
 *
 * Serializes `deriveThemeTokens` rather than re-deriving. The two used to hold
 * separate copies of the same colour maths, so the preview could drift from
 * what actually rendered.
 *
 * @param {Object} options - Theme options
 * @param {Object} options.colors - Color configuration
 * @param {Object} options.fonts - Font configuration
 * @param {Array} [options.managedFonts] - Managed font families with variants
 * @returns {string} - CSS string
 */
export function generatePreviewCSS({ colors, fonts, managedFonts }) {
  const { cssVars } = deriveThemeTokens({ colors, fonts, managedFonts });

  const lines = PREVIEW_TOKENS.filter((token) => cssVars[token] != null).map(
    (token) => `  ${token}: ${cssValueSafe(cssVars[token])};`
  );

  return `/* Custom Theme Preview CSS */\n.theme-preview {\n${lines.join('\n')}\n}`;
}

/**
 * Generate @font-face CSS for custom fonts.
 * Handles both curated fonts (path-based local files) and managed uploaded fonts (URL-based).
 * @param {Object} fonts - Font configuration { heading, body, headingFamilyId, bodyFamilyId }
 * @param {Object} [options] - Additional options
 * @param {Array} [options.managedFonts] - Managed font families with variants
 * @returns {string} - CSS with @font-face rules
 */
export function generateFontFaceCSS(fonts, { managedFonts } = {}) {
  const lines = [];
  const addedFonts = new Set();

  // Resolve managed fonts map
  const managedFontMap = {};
  if (Array.isArray(managedFonts)) {
    for (const mf of managedFonts) {
      managedFontMap[mf.id] = mf;
    }
  }

  const addCuratedFont = (family) => {
    if (addedFonts.has(family)) return;
    addedFonts.add(family);

    const fontInfo = getFontByFamily(family);
    if (!fontInfo) return;

    const slug = fontFamilyToSlug(family);

    for (const weight of fontInfo.weights) {
      lines.push(`@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('/assets/fonts/google/${slug}/${slug}-${weight}.woff2') format('woff2');
}`);
    }
  };

  const addManagedFont = (managed) => {
    if (!managed || addedFonts.has(managed.id)) return;
    addedFonts.add(managed.id);

    // Only uploaded fonts have embeddable @font-face rules
    if (managed.source !== 'upload' || !Array.isArray(managed.variants)) return;

    for (const variant of managed.variants) {
      if (!variant.url) continue;
      lines.push(`@font-face {
  font-family: '${managed.name}';
  font-style: ${variant.style || 'normal'};
  font-weight: ${variant.weight || 400};
  font-display: swap;
  src: url('${variant.url}') format('${variant.format || 'woff2'}');
}`);
    }
  };

  // Heading font
  const headingManaged = fonts.headingFamilyId ? managedFontMap[fonts.headingFamilyId] : null;
  if (headingManaged && headingManaged.source === 'upload') {
    addManagedFont(headingManaged);
  } else if (fonts.heading) {
    addCuratedFont(fonts.heading);
  }

  // Body font
  const bodyManaged = fonts.bodyFamilyId ? managedFontMap[fonts.bodyFamilyId] : null;
  if (bodyManaged && bodyManaged.source === 'upload') {
    addManagedFont(bodyManaged);
  } else if (fonts.body) {
    addCuratedFont(fonts.body);
  }

  return lines.join('\n\n');
}
