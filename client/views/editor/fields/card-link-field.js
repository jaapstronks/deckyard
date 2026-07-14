import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * A link field for clickable cards/logos, with an in-deck slide picker.
 *
 * The text input is the source of truth. Its value is one of:
 *   ''                empty (no link)
 *   'https://…'       external URL (opens in a new tab)
 *   'mailto:…'        email link
 *   '#slide:<id>'     in-deck jump to a slide (chosen via the picker; stable
 *                     across reordering — the presenter resolves the id live)
 *   '#N'              legacy positional in-deck jump (still honored)
 *
 * The `<select>` lists the deck's other slides; choosing one writes
 * `#slide:<id>` into the input. Typing a URL/`#N` resets the select to "custom".
 *
 * @param {Object} o
 * @param {string} [o.value] current link value
 * @param {Array<{ id: string, label: string }>} [o.slides] pickable deck slides
 *   (the current slide is excluded by the caller)
 * @param {(value: string) => void} o.onChange
 * @param {string} [o.label]
 * @param {string} [o.help]
 * @returns {HTMLElement}
 */
export function fieldCardLink({ value = '', slides = [], onChange, label, help } = {}) {
  const input = h('input', {
    class: 'form-input',
    value: value || '',
    maxLength: 500,
    placeholder: 'https://…',
  });

  const select = h('select', { class: 'form-input card-link-picker' });
  select.append(
    h('option', { value: '', text: t('editor.cards.linkPickCustom', 'URL / custom…') })
  );
  for (const s of slides) {
    select.append(h('option', { value: `#slide:${s.id}`, text: s.label }));
  }

  const syncSelectFromInput = () => {
    const v = String(input.value || '').trim();
    select.value = slides.some((s) => `#slide:${s.id}` === v) ? v : '';
  };
  syncSelectFromInput();

  input.addEventListener('input', () => {
    onChange(input.value);
    syncSelectFromInput();
  });

  select.addEventListener('change', () => {
    // The blank option is "custom" — leave whatever the author typed intact.
    if (!select.value) return;
    input.value = select.value;
    onChange(select.value);
  });

  const children = [
    h('div', { class: 'field-label', text: label || t('editor.cards.link', 'Link (optional)') }),
    h('div', { class: 'row card-link-row' }, [input, select]),
  ];
  if (help) children.push(h('div', { class: 'help', text: help }));

  return h('div', { class: 'stack is-field' }, children);
}

/**
 * Build the pickable-slide option list for `fieldCardLink` from a presentation,
 * excluding the slide being edited. Labels are "N. Title" (falling back to the
 * slide type when a slide has no title).
 *
 * @param {Object} pres presentation ({ slides: [...] })
 * @param {string} currentSlideId slide id to exclude
 * @returns {Array<{ id: string, label: string }>}
 */
export function buildDeckSlideOptions(pres, currentSlideId) {
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  const opts = [];
  slides.forEach((s, i) => {
    if (!s || s.id === currentSlideId) return;
    const title = String(s.content?.title || '').trim();
    const label = `${i + 1}. ${title || `(${s.type || 'slide'})`}`;
    opts.push({ id: s.id, label });
  });
  return opts;
}
