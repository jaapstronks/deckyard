import { getLangShortLabel } from '../../lib/format/lang-selector.js';
import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom.js';
import { getLangDisplayName } from '../../../shared/i18n-utils.js';
import { urlWithQuery } from '../../lib/state/router.js';

/**
 * The languages the presenter offers: exactly the versions the deck carries,
 * the one being presented first (D115). A language the deck has no version of
 * is not offered, and a language the deck carries is never hidden.
 *
 * @param {string[]} deckLangs - the deck's versions, as `existingVersionLangs`
 *   names them
 * @param {string} modeLang - the language being presented
 * @returns {string[]}
 */
export function presenterLangChoices(deckLangs, modeLang) {
  return deckLangs.includes(modeLang)
    ? [modeLang, ...deckLangs.filter((l) => l !== modeLang)]
    : [...deckLangs];
}

/**
 * Create presenter language selector.
 * Uses toggle buttons for ≤2 languages, dropdown for >2; hidden when the deck
 * carries fewer than two versions.
 *
 * @param {Object} options
 * @param {string} options.modeLang - Current language mode
 * @param {Function} options.getCurrentSlideId - Function to get current slide ID
 * @param {string[]} options.deckLangs - The deck's language versions
 *   (`existingVersionLangs(pres)`)
 */
export function createPresenterLangSeg({
  modeLang,
  getCurrentSlideId,
  deckLangs,
} = {}) {
  const langs = presenterLangChoices(deckLangs, modeLang);

  // Hide if only one language
  if (langs.length < 2) {
    const empty = h('div', { style: 'display:none;' });
    return { el: empty, syncUi: () => {} };
  }

  const navigateToLang = (code) => {
    if (modeLang === code) return;
    const currentId = getCurrentSlideId?.() || '';
    // A hard navigation on purpose: switching the presenting language reloads
    // the deck rather than patching it in place.
    location.href = urlWithQuery({ lang: code, slideId: currentId || null });
  };

  const useDropdown = langs.length > 2;

  if (useDropdown) {
    const selectEl = h('select', {
      class: 'form-input presenter-lang-select',
      title: t('presenter.langMode', 'Language mode (presenting)'),
    });

    for (const code of langs) {
      const option = h('option', {
        value: code,
        text: getLangDisplayName(code),
      });
      selectEl.append(option);
    }
    selectEl.value = modeLang;

    selectEl.addEventListener('change', () => {
      navigateToLang(selectEl.value);
    });

    return {
      el: selectEl,
      syncUi: () => {
        selectEl.value = modeLang;
      },
    };
  }

  // Segmented buttons for ≤2 languages
  const langSeg = h('div', {
    class: 'sb-segmented presenter-lang-seg',
    title: t('presenter.langMode', 'Language mode (presenting)'),
  });

  const buttons = {};
  for (const code of langs) {
    const btn = h('button', {
      class: 'sb-segmented-btn',
      type: 'button',
      text: getLangShortLabel(code),
      onclick: () => navigateToLang(code),
    });
    buttons[code] = btn;
    langSeg.append(btn);
  }

  const syncUi = () => {
    for (const [code, btn] of Object.entries(buttons)) {
      btn.classList.toggle('is-active', modeLang === code);
    }
  };
  syncUi();

  return { el: langSeg, syncUi };
}
