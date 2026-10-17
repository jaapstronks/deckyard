/**
 * Theme selection: the deck-settings dropdown, the creation view's card grid,
 * and the theme card itself (`theme-card.js`), which Home's theme row renders
 * too.
 */

import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom/index.js';
import { createInViewLoader } from '../../lib/dom/in-view.js';
import { createThemeCard, themeCardValue } from './theme-card.js';

export {
  createThemeCard,
  themeCardValue,
  themePreviewSlide,
} from './theme-card.js';

/**
 * Build the `GET /api/themes` URL for a picker.
 *
 * The server hands back only the themes the workspace allows (D70), so a deck
 * already sitting on a withdrawn theme would lose its own selection from the
 * list. `?current=` is the one exception the server honours: name the theme in
 * use and it stays offered, for this picker only.
 *
 * @param {string} [currentTheme] - Theme the deck is on right now
 * @returns {string} Request path
 */
function themeListUrl(currentTheme) {
  const id = String(currentTheme || '').trim();
  return id ? `/api/themes?current=${encodeURIComponent(id)}` : '/api/themes';
}

/**
 * Label for the `default` choice: names the theme it resolves to, so the
 * picker says *which* theme a deck on "Workspace default" gets (B584).
 *
 * The workspace default is the theme `GET /api/themes` marks `isDefault`;
 * without one (the list has not loaded, or is empty) the bare label stands.
 *
 * @param {Array<{isDefault?: boolean, label?: string, id?: string}>} [themes]
 * @returns {string}
 */
function defaultThemeLabel(themes = []) {
  const record = themes.find((theme) => theme?.isDefault);
  const name = String(record?.label || record?.id || '').trim();
  return name
    ? t('common.themeDefaultNamed', 'Workspace default ({name})', { name })
    : t('common.themeDefault', 'Workspace default');
}

/**
 * Create a theme selector field with label and select element.
 *
 * @param {Object} options
 * @param {string} [options.initialTheme] - Initial theme ID
 * @param {Function} [options.onChange] - Called when theme changes
 * @param {string} [options.className] - Additional CSS class for wrapper
 * @returns {Object} { wrap, select, getTheme, setTheme }
 */
function createThemeSelect({
  initialTheme = 'default',
  onChange,
  className = 'modal-field-narrow',
} = {}) {
  let themeId = initialTheme;

  const wrap = h('div', { class: `stack is-field ${className}`.trim() });
  const label = h('div', {
    class: 'field-label',
    text: t('common.theme', 'Theme'),
  });
  const select = h('select', { class: 'form-input is-compact' });

  // Default options
  select.append(h('option', { value: 'default', text: defaultThemeLabel() }));
  select.value = themeId;

  select.addEventListener('change', () => {
    themeId = String(select.value || 'default');
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
 * @param {HTMLSelectElement} options.select - Select element to populate
 * @param {string} [options.currentTheme] - Currently selected theme ID
 * @param {Function} [options.onPopulated] - Called with final theme ID after population
 * @returns {Promise<string>} The resolved theme ID
 */
async function populateThemes({
  api,
  select,
  currentTheme = 'default',
  onPopulated,
} = {}) {
  try {
    const resp = await api(themeListUrl(currentTheme));
    const themes = Array.isArray(resp?.themes) ? resp.themes : [];

    if (!themes.length) {
      onPopulated?.(currentTheme);
      return currentTheme;
    }

    select.replaceChildren();
    select.append(
      h('option', { value: 'default', text: defaultThemeLabel(themes) }),
    );
    for (const theme of themes) {
      const id = String(theme?.id || '').trim();
      if (!id) continue;
      const label = String(theme?.label || id).trim() || id;
      select.append(h('option', { value: id, text: label }));
    }

    const wanted = String(currentTheme || '').trim();
    const hasWanted = Array.from(select.options).some(
      (o) => o.value === wanted,
    );
    const resolvedTheme = hasWanted
      ? wanted
      : String(select.options?.[0]?.value || 'default');

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
 * @param {Function} options.api - API fetch function
 * @param {string} [options.initialTheme] - Initial theme ID
 * @param {Function} [options.onChange] - Called when theme changes
 * @param {string} [options.className] - Additional CSS class for wrapper
 * @returns {Object} { wrap, select, getTheme, setTheme, populated: Promise }
 */
export function createAndPopulateThemeSelect({
  api,
  initialTheme = 'default',
  onChange,
  className,
} = {}) {
  const result = createThemeSelect({ initialTheme, onChange, className });

  const populated = populateThemes({
    api,
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
 * Create a visual theme picker: a grid of theme cards (D353).
 *
 * One card per theme `GET /api/themes` offers, each showing the real title
 * slide a new deck in that theme starts with (`theme-card.js`, the card Home's
 * "Start something new" row renders too). The workspace default's card carries
 * a "Workspace default" badge and writes `default` (D232); there is no second
 * card for it. The grid shows exactly what the response offers: the
 * `enabledThemes` allowlist is enforced server-side, so there is nothing
 * withheld for a toggle to reveal.
 *
 * When `initialTheme` is null/omitted, the picker adopts the workspace default.
 * An explicit initial theme that IS the workspace default selects its card,
 * so it is written as `default` as well.
 *
 * @param {Object} options
 * @param {Function} options.api - API fetch function
 * @param {string|null} [options.initialTheme=null] - Explicit initial theme ID;
 *   when falsy the workspace default is used
 * @param {Function} [options.onChange] - Called when theme changes
 * @returns {Object} { wrap, getTheme, setTheme, populated: Promise, detach }
 */
export function createVisualThemePicker({
  api,
  initialTheme = null,
  onChange,
} = {}) {
  // An explicit initial theme overrides the workspace default; null means
  // "adopt whatever the server reports as the default".
  const explicitInitial = initialTheme ? String(initialTheme) : null;
  let themeId = explicitInitial || 'default';

  const wrap = h('div', { class: 'stack is-field theme-picker-wrap' });
  const label = h('div', {
    class: 'field-label',
    text: t('common.theme', 'Theme'),
  });
  const grid = h('div', { class: 'theme-picker-grid' });
  wrap.append(label, grid);

  const cards = new Map(); // value -> card
  const inView = createInViewLoader();

  function syncSelected() {
    for (const [value, card] of cards) card.setSelected(value === themeId);
  }

  function selectCard(value) {
    themeId = value;
    syncSelected();
    onChange?.(value);
  }

  const populated = (async () => {
    try {
      const [resp, slideTypes] = await Promise.all([
        api(themeListUrl(explicitInitial)),
        api('/api/slide-types').catch(() => ({})),
      ]);
      const themes = (Array.isArray(resp?.themes) ? resp.themes : []).filter(
        (theme) => String(theme?.id || '').trim(),
      );
      if (!themes.length) return themeId;

      // The workspace default is chosen through its card, which writes
      // `default`; resolve the selection onto the card values: explicit initial
      // wins, else the workspace default, else the first theme.
      const defaultRecord = themes.find((theme) => theme.isDefault);
      if (defaultRecord && themeId === defaultRecord.id) themeId = 'default';
      const values = themes.map(themeCardValue);
      if (!values.includes(themeId)) themeId = values[0];

      for (const record of themes) {
        const card = createThemeCard({
          record,
          slideTypes,
          inView,
          onSelect: (value) => selectCard(value),
        });
        cards.set(card.value, card);
        grid.append(card.el);
      }
      syncSelected();
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
      syncSelected();
    },
    populated,
    detach() {
      inView.disconnect();
      for (const card of cards.values()) card.detach();
    },
  };
}
