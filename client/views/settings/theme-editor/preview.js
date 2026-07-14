/**
 * Theme Preview Component
 * Live preview of theme settings showing a realistic title slide.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { deriveColorPalette, getContrastColor, hexToRgba } from '../../../lib/color-utils.js';

// Track which fonts have been loaded
const loadedFonts = new Set();

/**
 * Load a Google Font dynamically.
 * @param {string} family - Font family name
 */
function loadGoogleFont(family) {
  if (!family || loadedFonts.has(family)) return;

  loadedFonts.add(family);

  // Create a link element for Google Fonts
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

/**
 * Create a theme preview component.
 * Shows a realistic title slide preview.
 * @param {Object} options
 * @param {Object} options.theme - Theme state object
 * @returns {Object} { el, update }
 */
export function createThemePreview({ theme }) {
  const container = h('div', { class: 'theme-preview-container' });

  // Preview slide wrapper with aspect ratio
  const slideWrapper = h('div', { class: 'theme-preview-slide-wrapper' });

  // Title slide structure (similar to actual title-slide)
  const slide = h('div', { class: 'theme-preview-slide theme-preview-title-slide' });

  // Header with logo (top-left, like actual title slides)
  const header = h('div', { class: 'theme-preview-header' });
  const logo = h('div', { class: 'theme-preview-logo' });
  header.append(logo);

  // Main content area (centered)
  const content = h('div', { class: 'theme-preview-content' });

  // Title (main heading)
  const title = h('h1', {
    class: 'theme-preview-title',
    text: t('settings.themes.previewTitle', 'Sample Presentation'),
  });

  // Subtitle (secondary text)
  const subtitle = h('p', {
    class: 'theme-preview-subtitle',
    text: t('settings.themes.previewSubtitle', 'A preview of your custom theme'),
  });

  // Accent bar (visual element using primary color)
  const accentBar = h('div', { class: 'theme-preview-accent-bar' });

  content.append(title, subtitle);

  // Footer with color palette preview
  const footer = h('div', { class: 'theme-preview-footer' });
  const colorBlocks = h('div', { class: 'theme-preview-color-blocks' });
  footer.append(accentBar, colorBlocks);

  slide.append(header, content, footer);
  slideWrapper.append(slide);
  container.append(slideWrapper);

  /**
   * Update the preview with current theme state.
   * @param {Object} state - Theme state
   */
  function update(state) {
    const colors = state.colors || {};
    const fonts = state.fonts || {};

    const primary = colors.primary || '#3B82F6';
    const background = colors.background || '#ffffff';
    const textLight = colors.textLight || '#ffffff';
    const textDark = colors.textDark || '#1f2937';
    const headingFont = fonts.heading || 'Inter';
    const bodyFont = fonts.body || 'Inter';

    // Load fonts from Google Fonts for preview
    loadGoogleFont(headingFont);
    loadGoogleFont(bodyFont);

    // Determine text color based on background
    const textColor = getContrastColor(background, { light: textLight, dark: textDark });
    const mutedColor = hexToRgba(textColor, 0.65);

    // Update slide styles
    slide.style.backgroundColor = background;
    slide.style.color = textColor;

    // Update logo (use small logo for title slide preview, fall back to main logo)
    logo.innerHTML = '';
    const titleLogoUrl = state.logoSmallUrl || state.logoUrl;
    if (titleLogoUrl) {
      const img = h('img', {
        src: titleLogoUrl,
        alt: 'Logo',
        onerror: () => {
          logo.innerHTML = '';
        },
      });
      logo.append(img);
    }

    // Update title
    title.style.fontFamily = `'${headingFont}', sans-serif`;
    title.style.color = textColor;

    // Update subtitle
    subtitle.style.fontFamily = `'${bodyFont}', sans-serif`;
    subtitle.style.color = mutedColor;

    // Update accent bar
    accentBar.style.backgroundColor = primary;

    // Update color blocks (palette preview)
    colorBlocks.innerHTML = '';
    const palette = deriveColorPalette(primary);

    for (let i = 0; i < Math.min(5, palette.length); i++) {
      const block = h('div', { class: 'theme-preview-color-block' });
      block.style.backgroundColor = palette[i];
      colorBlocks.append(block);
    }
  }

  // Initial render
  update(theme);

  return { el: container, update };
}
