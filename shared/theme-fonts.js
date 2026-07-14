/**
 * Curated list of Google Fonts for custom themes.
 * These fonts are pre-bundled on the server for privacy (no client requests to Google).
 */

export const CURATED_FONTS = [
  // Sans-serif - Clean, modern fonts suitable for body text and headings
  { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Figtree', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Open Sans', category: 'sans-serif', weights: [400, 600, 700] },
  { family: 'Lato', category: 'sans-serif', weights: [400, 700] },
  { family: 'Roboto', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Montserrat', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Poppins', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Nunito', category: 'sans-serif', weights: [400, 600, 700] },
  { family: 'Work Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'DM Sans', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Plus Jakarta Sans', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Raleway', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Cabin', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Rubik', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Quicksand', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Manrope', category: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Source Sans 3', category: 'sans-serif', weights: [400, 600, 700] },
  { family: 'Nunito Sans', category: 'sans-serif', weights: [400, 600, 700] },
  { family: 'Mulish', category: 'sans-serif', weights: [400, 500, 600, 700] },

  // Serif - Traditional and editorial fonts
  { family: 'Playfair Display', category: 'serif', weights: [400, 600, 700] },
  { family: 'Bodoni Moda', category: 'serif', weights: [400, 500, 700] },
  { family: 'Fraunces', category: 'serif', weights: [400, 600, 700] },
  { family: 'Cormorant Garamond', category: 'serif', weights: [400, 600, 700] },
  { family: 'Merriweather', category: 'serif', weights: [400, 700] },
  { family: 'Lora', category: 'serif', weights: [400, 600, 700] },
  { family: 'Source Serif 4', category: 'serif', weights: [400, 600, 700] },
  { family: 'Libre Baskerville', category: 'serif', weights: [400, 700] },
  { family: 'Crimson Text', category: 'serif', weights: [400, 600, 700] },
  { family: 'EB Garamond', category: 'serif', weights: [400, 500, 600, 700] },
  { family: 'Instrument Serif', category: 'serif', weights: [400] },

  // Display - Distinctive fonts best suited for headings
  { family: 'Bricolage Grotesque', category: 'display', weights: [400, 600, 700] },
  { family: 'Red Hat Display', category: 'display', weights: [400, 500, 700, 900] },
  { family: 'DM Serif Display', category: 'display', weights: [400] },
  { family: 'Space Grotesk', category: 'display', weights: [400, 500, 700] },
  { family: 'Archivo', category: 'display', weights: [400, 500, 600, 700] },
  { family: 'Outfit', category: 'display', weights: [400, 500, 600, 700] },
  { family: 'Sora', category: 'display', weights: [400, 500, 600, 700] },

  // Monospace - Code-style fonts for technical content
  { family: 'JetBrains Mono', category: 'monospace', weights: [400, 500, 700] },
  { family: 'Source Code Pro', category: 'monospace', weights: [400, 500, 600, 700] },
  { family: 'IBM Plex Mono', category: 'monospace', weights: [400, 500, 600, 700] },
];

/**
 * Default fonts for new themes
 */
export const DEFAULT_HEADING_FONT = 'Inter';
export const DEFAULT_BODY_FONT = 'Inter';

/**
 * Get a font by family name.
 * @param {string} family - Font family name
 * @returns {Object|null} - Font object or null
 */
export function getFontByFamily(family) {
  return CURATED_FONTS.find((f) => f.family === family) || null;
}

/**
 * Get fonts grouped by category.
 * @returns {Object} - Fonts grouped by category
 */
export function getFontsByCategory() {
  const groups = {
    'sans-serif': [],
    serif: [],
    display: [],
    monospace: [],
  };

  for (const font of CURATED_FONTS) {
    if (groups[font.category]) {
      groups[font.category].push(font);
    }
  }

  return groups;
}

/**
 * Check if a font family is in the curated list.
 * @param {string} family - Font family name
 * @returns {boolean}
 */
export function isValidFont(family) {
  return CURATED_FONTS.some((f) => f.family === family);
}

/**
 * Get CSS font-family value with fallbacks.
 * @param {string} family - Font family name
 * @returns {string} - CSS font-family value
 */
export function getFontFamilyCSS(family) {
  const font = getFontByFamily(family);
  if (!font) return 'sans-serif';

  const fallback =
    font.category === 'serif'
      ? 'serif'
      : font.category === 'monospace'
        ? 'monospace'
        : 'sans-serif';

  return `'${font.family}', ${fallback}`;
}

/**
 * Convert font family name to URL-safe format.
 * @param {string} family - Font family name
 * @returns {string} - URL-safe name
 */
export function fontFamilyToSlug(family) {
  return family.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Convert URL-safe name back to font family.
 * @param {string} slug - URL-safe name
 * @returns {string|null} - Font family name or null
 */
export function slugToFontFamily(slug) {
  const font = CURATED_FONTS.find((f) => fontFamilyToSlug(f.family) === slug);
  return font ? font.family : null;
}
