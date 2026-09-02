/**
 * Language Selector Utilities
 *
 * Shared utilities for creating language selector UI components.
 */

import { t } from '../ui-i18n.js';
import { h } from '../dom.js';
import {
  DEFAULT_SUPPORTED_DECK_LANGS,
  getLangDisplayName,
} from '../../../shared/i18n-utils.js';

/**
 * Get the short label for a language (for toggle buttons).
 *
 * Derived, not tabulated: the primary subtag upper-cased is `NL`, `EN`, `FI`,
 * `SV` — the same answer a hand-written map gave for the eight codes it
 * happened to list, and a right answer for the four it did not.
 * @param {string} code
 * @returns {string}
 */
export function getLangShortLabel(code) {
  return String(code || '')
    .split('-')[0]
    .toUpperCase();
}

/**
 * Create a language selector with toggle buttons (for ≤2 languages)
 * or a dropdown (for >2 languages).
 *
 * @param {Object} options
 * @param {Function} options.readLangMode - Function to read current language mode
 * @param {Function} options.writeLangMode - Function to write language mode
 * @param {Function} [options.getSupportedLangs] - Function returning array of supported languages
 * @param {string} [options.initialLang] - Starting value, overriding readLangMode()
 * @param {Function} [options.onChange] - Called when language changes
 * @param {string} [options.className] - Additional CSS class for wrapper
 * @returns {Object} { wrap, syncUi, getLang, setLang, setDisabled }
 */
export function createLangSelector({
  readLangMode,
  writeLangMode,
  getSupportedLangs,
  initialLang,
  onChange,
  className = 'modal-lang-fixed',
} = {}) {
  const supportedList = Array.isArray(getSupportedLangs?.())
    ? getSupportedLangs()
    : [...DEFAULT_SUPPORTED_DECK_LANGS];
  const supported = new Set(supportedList);

  // `initialLang` is a *derived* default (see resolveInitialDeckLang), so it is
  // never written back: persisting it would turn a guess into a stored
  // preference and freeze the derivation for good. Only an explicit click or
  // dropdown change below persists.
  let langMode = supported.has(initialLang) ? initialLang : readLangMode();
  if (!supported.has(langMode)) {
    langMode = supportedList[0] || DEFAULT_SUPPORTED_DECK_LANGS[0];
    writeLangMode(langMode);
  }

  const wrap = h('div', { class: `stack is-field ${className}`.trim() });
  const label = h('div', {
    class: 'field-label',
    text: t('common.language', 'Language'),
  });

  // Hide entire selector if only one language supported
  if (supportedList.length < 2) {
    wrap.style.display = 'none';
  }

  // Use dropdown for >2 languages, segmented buttons for ≤2
  const useDropdown = supportedList.length > 2;

  let selectEl = null;
  let seg = null;
  let buttons = {};

  if (useDropdown) {
    // Create dropdown
    selectEl = h('select', { class: 'form-input' });
    for (const code of supportedList) {
      const option = h('option', {
        value: code,
        text: getLangDisplayName(code),
      });
      selectEl.append(option);
    }
    selectEl.value = langMode;

    selectEl.addEventListener('change', () => {
      langMode = selectEl.value;
      writeLangMode(langMode);
      onChange?.(langMode);
    });

    wrap.append(label, selectEl);
  } else {
    // Create segmented buttons
    seg = h('div', { class: 'sb-segmented is-toggle' });

    for (const code of supportedList) {
      const btn = h('button', {
        class: 'sb-segmented-btn',
        type: 'button',
        text: getLangShortLabel(code),
      });
      btn.addEventListener('click', () => {
        langMode = code;
        writeLangMode(langMode);
        syncUi();
        onChange?.(langMode);
      });
      buttons[code] = btn;
      seg.append(btn);
    }

    wrap.append(label, seg);
  }

  const syncUi = () => {
    if (useDropdown && selectEl) {
      selectEl.value = langMode;
    } else {
      for (const [code, btn] of Object.entries(buttons)) {
        btn.classList.toggle('is-active', langMode === code);
      }
    }
  };

  syncUi();

  return {
    wrap,
    syncUi,
    getLang: () => langMode,
    setLang: (lang) => {
      if (supported.has(lang)) {
        langMode = lang;
        writeLangMode(langMode);
        syncUi();
      }
    },
    setDisabled: (disabled) => {
      if (useDropdown && selectEl) {
        selectEl.disabled = disabled;
      } else {
        for (const [, btn] of Object.entries(buttons)) {
          btn.disabled = disabled;
        }
      }
    },
  };
}
