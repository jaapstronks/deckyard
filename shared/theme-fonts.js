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
 * The Google Fonts subsets we self-host, with their unicode ranges.
 *
 * Google splits every family into disjoint per-script subsets and expects the
 * browser to pick between them via `unicode-range`. They are *not* cumulative:
 * the `latin-ext` file contains only the extended block, so a page that ships
 * one subset and omits `unicode-range` renders every glyph outside that block
 * in a fallback font. Both subsets are required — `latin` carries ASCII and
 * Latin-1, `latin-ext` carries the Polish/Czech/Turkish/Hungarian letters our
 * `pl` locale and European deck content need.
 *
 * The ranges are Google's own, identical across every curated family (verified
 * against Inter, Lato, Playfair Display and JetBrains Mono). The downloader
 * records the ranges Google actually served in `scripts/google-fonts.lock.json`
 * and fails the refresh if they ever drift from these constants.
 */
export const FONT_SUBSETS = [
  {
    name: 'latin',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, ' +
      'U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, ' +
      'U+2212, U+2215, U+FEFF, U+FFFD',
  },
  {
    name: 'latin-ext',
    unicodeRange:
      'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, ' +
      'U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, ' +
      'U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
];

/** Subset names in load order, for the downloader and its lockfile. */
export const FONT_SUBSET_NAMES = FONT_SUBSETS.map((s) => s.name);

/**
 * Repo-relative path of one self-hosted curated font file.
 *
 * The single place that knows the layout of `assets/fonts/google/`. Every
 * consumer (downloader, theme builder, embed/export CSS) derives its paths from
 * here so the naming scheme can never drift between writer and readers.
 *
 * @param {string} slug - Font slug from {@link fontFamilyToSlug}
 * @param {number} weight - Font weight
 * @param {string} subset - Subset name from {@link FONT_SUBSET_NAMES}
 * @returns {string} - Path relative to the repository root
 */
export function curatedFontPath(slug, weight, subset) {
  return `assets/fonts/google/${slug}/${slug}-${weight}-${subset}.woff2`;
}

/**
 * Every @font-face descriptor a curated family needs: one per weight × subset.
 *
 * @param {string} family - Font family name
 * @returns {Array<{family: string, weight: number, subset: string, path: string, unicodeRange: string}>}
 */
export function curatedFontFaces(family) {
  const font = getFontByFamily(family);
  if (!font) return [];
  const slug = fontFamilyToSlug(family);

  const faces = [];
  for (const weight of font.weights) {
    for (const { name, unicodeRange } of FONT_SUBSETS) {
      faces.push({
        family: font.family,
        weight,
        subset: name,
        path: curatedFontPath(slug, weight, name),
        unicodeRange,
      });
    }
  }
  return faces;
}

