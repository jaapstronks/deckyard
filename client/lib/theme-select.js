/**
 * Theme Selection Utilities
 *
 * Shared utilities for creating and populating theme selector dropdowns.
 */

import { t } from './ui-i18n.js';
import { DEFAULT_THEME_ID, DEFAULT_THEME_NAME } from '../../shared/constants/themes.js';
import { loadThemeById } from './theme.js';

/**
 * Create a theme selector field with label and select element.
 *
 * @param {Object} options
 * @param {Function} options.h - DOM element helper function
 * @param {string} [options.initialTheme='deckyard'] - Initial theme ID
 * @param {Function} [options.onChange] - Called when theme changes
 * @param {string} [options.className] - Additional CSS class for wrapper
 * @returns {Object} { wrap, select, getTheme, setTheme }
 */
export function createThemeSelect({
  h,
  initialTheme = DEFAULT_THEME_ID,
  onChange,
  className = 'modal-field-narrow',
} = {}) {
  let themeId = initialTheme;

  const wrap = h('div', { class: `stack is-field ${className}`.trim() });
  const label = h('div', { class: 'field-label', text: t('common.theme', 'Theme') });
  const select = h('select', { class: 'form-input is-compact' });

  // Default options
  select.append(
    h('option', { value: DEFAULT_THEME_ID, text: DEFAULT_THEME_NAME }),
    h('option', { value: 'clicknl', text: 'ClickNL' })
  );
  select.value = themeId;

  select.addEventListener('change', () => {
    themeId = String(select.value || DEFAULT_THEME_ID) || DEFAULT_THEME_ID;
    onChange?.(themeId);
  });

  wrap.append(label, select);

  return {
    wrap,
    select,
    getTheme: () => themeId,
    setTheme: (id) => {
      themeId = id;
      select.value = id;
    },
  };
}

/**
 * Populate a theme select element with themes from the server.
 *
 * @param {Object} options
 * @param {Function} options.api - API fetch function
 * @param {Function} options.h - DOM element helper function
 * @param {HTMLSelectElement} options.select - Select element to populate
 * @param {string} [options.currentTheme] - Currently selected theme ID
 * @param {Function} [options.onPopulated] - Called with final theme ID after population
 * @returns {Promise<string>} The resolved theme ID
 */
export async function populateThemes({
  api,
  h,
  select,
  currentTheme = DEFAULT_THEME_ID,
  onPopulated,
} = {}) {
  try {
    const resp = await api('/api/themes');
    const themes = Array.isArray(resp?.themes) ? resp.themes : [];

    if (!themes.length) {
      onPopulated?.(currentTheme);
      return currentTheme;
    }

    select.innerHTML = '';
    for (const theme of themes) {
      const id = String(theme?.id || '').trim();
      if (!id) continue;
      const label = String(theme?.label || id).trim() || id;
      select.append(h('option', { value: id, text: label }));
    }

    const wanted = String(currentTheme || '').trim();
    const hasWanted = Array.from(select.options).some((o) => o.value === wanted);
    const resolvedTheme = hasWanted
      ? wanted
      : String(select.options?.[0]?.value || DEFAULT_THEME_ID) || DEFAULT_THEME_ID;

    select.value = resolvedTheme;
    onPopulated?.(resolvedTheme);
    return resolvedTheme;
  } catch {
    onPopulated?.(currentTheme);
    return currentTheme;
  }
}

/**
 * Create a theme selector and populate it from the server.
 *
 * Convenience function that combines createThemeSelect and populateThemes.
 *
 * @param {Object} options
 * @param {Function} options.h - DOM element helper function
 * @param {Function} options.api - API fetch function
 * @param {string} [options.initialTheme='deckyard'] - Initial theme ID
 * @param {Function} [options.onChange] - Called when theme changes
 * @param {string} [options.className] - Additional CSS class for wrapper
 * @returns {Object} { wrap, select, getTheme, setTheme, populated: Promise }
 */
export function createAndPopulateThemeSelect({
  h,
  api,
  initialTheme = DEFAULT_THEME_ID,
  onChange,
  className,
} = {}) {
  const result = createThemeSelect({ h, initialTheme, onChange, className });

  const populated = populateThemes({
    api,
    h,
    select: result.select,
    currentTheme: initialTheme,
    onPopulated: (resolvedTheme) => {
      result.setTheme(resolvedTheme);
    },
  });

  return {
    ...result,
    populated,
  };
}

/**
 * Create a visual theme picker with preview cards.
 *
 * Renders a grid of theme cards showing each theme's colors and fonts,
 * replacing the plain <select> dropdown for a richer selection experience.
 *
 * @param {Object} options
 * @param {Function} options.h - DOM element helper function
 * @param {Function} options.api - API fetch function
 * @param {string} [options.initialTheme='deckyard'] - Initial theme ID
 * @param {Function} [options.onChange] - Called when theme changes
 * @returns {Object} { wrap, getTheme, setTheme, populated: Promise }
 */
export function createVisualThemePicker({
  h,
  api,
  initialTheme = DEFAULT_THEME_ID,
  onChange,
} = {}) {
  let themeId = initialTheme;

  const wrap = h('div', { class: 'stack is-field theme-picker-wrap' });
  const label = h('div', { class: 'field-label', text: t('common.theme', 'Theme') });
  const grid = h('div', { class: 'theme-picker-grid' });
  wrap.append(label, grid);

  const cards = new Map(); // id -> card element
  const BORDER_DEFAULT = '2px solid #ddd';
  const BORDER_SELECTED = '2px solid hsl(160, 40%, 35%)';
  const SHADOW_SELECTED = '0 0 0 2px hsla(160, 40%, 35%, 0.3)';

  function applySelectedStyle(card, selected) {
    card.classList.toggle('is-selected', selected);
    card.style.border = selected ? BORDER_SELECTED : BORDER_DEFAULT;
    card.style.boxShadow = selected ? SHADOW_SELECTED : 'none';
  }

  function selectCard(id) {
    themeId = id;
    for (const [cardId, card] of cards) {
      applySelectedStyle(card, cardId === id);
    }
    onChange?.(id);
  }

  /**
   * Resolve preview CSS vars for a theme entry from the /api/themes list.
   * System themes are loaded in full via loadThemeById; custom themes use
   * the inline colors/fonts already present in the list response.
   */
  async function resolvePreviewData(theme) {
    if (theme.type === 'system') {
      try {
        const full = await loadThemeById(theme.id);
        return {
          ...theme,
          cssVars: full?.cssVars || {},
          embedFonts: full?.embedFonts || [],
        };
      } catch {
        return { ...theme, cssVars: {}, embedFonts: [] };
      }
    }
    // Custom themes: construct preview vars from inline colors/fonts
    return {
      ...theme,
      cssVars: {
        '--t-color-background': theme.colors?.background || '#ffffff',
        '--t-color-accent': theme.colors?.primary || '#3B82F6',
        '--t-color-text': theme.colors?.textDark || '#1f2937',
        '--t-font-heading': theme.fonts?.heading
          ? `'${theme.fonts.heading}', sans-serif`
          : 'Inter, sans-serif',
        '--t-font-body': theme.fonts?.body
          ? `'${theme.fonts.body}', sans-serif`
          : 'Inter, sans-serif',
        '--t-heading-weight': '700',
        '--t-heading-transform': 'none',
      },
      embedFonts: [],
    };
  }

  /** Inject @font-face rules so heading/body fonts render in cards. */
  function preloadFonts(enrichedThemes) {
    const rules = [];
    const seen = new Set();
    for (const theme of enrichedThemes) {
      if (!theme.embedFonts?.length) continue;
      const vars = theme.cssVars || {};
      for (const varName of ['--t-font-heading', '--t-font-body']) {
        const family = (vars[varName] || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
        if (!family || seen.has(family)) continue;
        const match = theme.embedFonts.find((f) => f.family === family);
        if (!match) continue;
        // Support both path-based (curated) and URL-based (uploaded) fonts
        let src;
        if (match.url) {
          src = `url('${match.url}') format('${match.format || 'woff2'}')`;
        } else if (match.path) {
          src = `url('/${match.path}') format('woff2')`;
        } else {
          continue;
        }
        seen.add(family);
        rules.push(
          `@font-face { font-family: '${match.family}'; src: ${src}; font-weight: ${match.weight || 400}; font-style: ${match.style || 'normal'}; font-display: swap; }`
        );
      }
    }
    if (rules.length) {
      const style = document.createElement('style');
      style.textContent = rules.join('\n');
      wrap.prepend(style);
    }
  }

  function renderCard(theme) {
    const vars = theme.cssVars || {};
    const bgColor = vars['--t-color-background'] || '#ffffff';
    const accentColor = vars['--t-color-accent'] || '#3B82F6';
    const textColor = vars['--t-color-text'] || '#1f2937';
    const headingFont = vars['--t-font-heading'] || 'Inter, sans-serif';
    const bodyFont = vars['--t-font-body'] || 'Inter, sans-serif';
    const headingWeight = vars['--t-heading-weight'] || '700';
    const headingTransform = vars['--t-heading-transform'] || 'none';

    const card = h('button', {
      type: 'button',
      class: `theme-card${theme.id === themeId ? ' is-selected' : ''}`,
      onclick: () => selectCard(theme.id),
    });
    const isSelected = theme.id === themeId;
    // Inline layout styles so the card works even before CSS is cached.
    Object.assign(card.style, {
      display: 'block',
      width: '140px',
      overflow: 'hidden',
      padding: '0',
      textAlign: 'center',
      border: isSelected ? BORDER_SELECTED : BORDER_DEFAULT,
      borderRadius: '8px',
      background: '#fff',
      cursor: 'pointer',
      boxShadow: isSelected ? SHADOW_SELECTED : 'none',
      outline: 'none',
    });

    const preview = h('div', { class: 'theme-card-preview' });
    Object.assign(preview.style, {
      background: bgColor,
      aspectRatio: '16 / 9',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      padding: '8px',
      position: 'relative',
      overflow: 'hidden',
    });

    const heading = h('div', { class: 'theme-card-heading', text: 'Aa' });
    Object.assign(heading.style, {
      fontFamily: headingFont,
      fontWeight: headingWeight,
      textTransform: headingTransform,
      color: textColor,
      fontSize: '22px',
      lineHeight: '1.2',
    });

    const body = h('div', { class: 'theme-card-body', text: 'Body text' });
    Object.assign(body.style, {
      fontFamily: bodyFont,
      color: textColor,
      fontSize: '9px',
      opacity: '0.7',
      lineHeight: '1',
    });

    const dot = h('div', { class: 'theme-card-accent' });
    Object.assign(dot.style, {
      background: accentColor,
      width: '12px',
      height: '12px',
      borderRadius: '50%',
      position: 'absolute',
      bottom: '6px',
      right: '6px',
    });

    preview.append(heading, body, dot);

    const labelEl = h('div', {
      class: 'theme-card-label',
      text: theme.label || theme.id,
    });
    Object.assign(labelEl.style, {
      padding: '6px 4px',
      fontSize: '11px',
      fontWeight: '600',
      fontFamily: 'inherit',
      color: '#666',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });

    card.append(preview, labelEl);
    return card;
  }

  const populated = (async () => {
    try {
      const resp = await api('/api/themes');
      const themes = Array.isArray(resp?.themes) ? resp.themes : [];
      if (!themes.length) return themeId;

      const hasInitial = themes.some((th) => th.id === themeId);
      if (!hasInitial) {
        themeId = String(themes[0]?.id || DEFAULT_THEME_ID);
      }

      const enriched = await Promise.all(themes.map(resolvePreviewData));
      preloadFonts(enriched);

      for (const theme of enriched) {
        const card = renderCard(theme);
        grid.append(card);
        cards.set(theme.id, card);
      }

      return themeId;
    } catch {
      return themeId;
    }
  })();

  return {
    wrap,
    getTheme: () => themeId,
    setTheme: (id) => {
      themeId = id;
      for (const [cardId, card] of cards) {
        applySelectedStyle(card, cardId === id);
      }
    },
    populated,
  };
}