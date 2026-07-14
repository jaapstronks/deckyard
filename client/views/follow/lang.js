import { getLangShortLabel, getLangDisplayName } from '../../lib/lang-selector.js';

/**
 * Render language selection UI for follow-along view.
 * Uses buttons for ≤2 languages, dropdown for >2.
 */
export function renderFollowLangButtons({
  h,
  langWrap,
  currentLang,
  availableLangs,
  translatingLang,
  onSelect,
} = {}) {
  langWrap.innerHTML = '';
  const avail = Array.isArray(availableLangs) ? availableLangs : [];
  const langsToShow = avail.length >= 2 ? avail : ['nl', 'en-GB'];

  // Hide if only one language
  if (langsToShow.length < 2) {
    langWrap.style.display = 'none';
    return;
  }
  langWrap.style.display = '';

  const useDropdown = langsToShow.length > 2;

  if (useDropdown) {
    const selectEl = h('select', {
      class: 'form-input follow-lang-select',
    });

    for (const code of langsToShow) {
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
      btn.append(
        h('span', { class: 'lang-btn-spinner' }),
        h('span', { text: label })
      );
    } else {
      btn.textContent = label;
    }
    return btn;
  };

  for (const code of langsToShow) {
    langWrap.append(makeBtn(code));
  }
}
