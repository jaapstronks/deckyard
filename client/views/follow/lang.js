import { getLangShortLabel } from '../../lib/format/lang-selector.js';
import { spinner } from '../../lib/dom/spinner.js';
import { h } from '../../lib/dom.js';
import { getLangDisplayName } from '../../../shared/i18n-utils.js';

/**
 * Render language selection UI for follow-along view.
 * Offers exactly the deck's versions (D115, D222): buttons for two, a dropdown
 * for more, nothing when the deck carries fewer than two.
 *
 * @param {Object} options
 * @param {HTMLElement} options.langWrap
 * @param {string} options.currentLang
 * @param {string[]} options.availableLangs - the deck's versions, as the follow
 *   meta names them (`existingVersionLangs` on the server)
 * @param {string|null} [options.translatingLang]
 * @param {Function} [options.onSelect]
 */
export function renderFollowLangButtons({
  langWrap,
  currentLang,
  availableLangs,
  translatingLang,
  onSelect,
} = {}) {
  langWrap.innerHTML = '';
  // A deck with one version has nothing to switch to
  if (availableLangs.length < 2) {
    langWrap.style.display = 'none';
    return;
  }
  langWrap.style.display = '';

  const useDropdown = availableLangs.length > 2;

  if (useDropdown) {
    const selectEl = h('select', {
      class: 'form-input follow-lang-select',
    });

    for (const code of availableLangs) {
      const option = h('option', {
        value: code,
        text: getLangDisplayName(code),
      });
      selectEl.append(option);
    }
    selectEl.value = currentLang;

    // Show loading state if translating
    if (translatingLang && translatingLang !== currentLang) {
      selectEl.disabled = true;
      selectEl.classList.add('is-translating');
    }

    selectEl.addEventListener('change', async () => {
      if (selectEl.value === currentLang) return;
      await onSelect?.(selectEl.value);
    });

    langWrap.append(selectEl);
    return;
  }

  // Segmented buttons for ≤2 languages
  const makeBtn = (code) => {
    const label = getLangShortLabel(code);
    const isActive = code === currentLang;
    const isTranslating = code === translatingLang && !isActive;
    const btn = h('button', {
      class: `btn btn-secondary ${isActive ? 'is-active' : ''} ${isTranslating ? 'is-translating' : ''}`,
      onclick: async () => {
        if (code === currentLang) return;
        await onSelect?.(code);
      },
    });
    if (isTranslating) {
      btn.append(spinner('sm'), h('span', { text: label }));
    } else {
      btn.textContent = label;
    }
    return btn;
  };

  for (const code of availableLangs) {
    langWrap.append(makeBtn(code));
  }
}
