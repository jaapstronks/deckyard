import { t } from '../../../../lib/ui-i18n.js';

const MAX_DESCRIPTION_CHARS = 600;

/**
 * Public meta-description textarea with a live character counter.
 * @param {object} ctx - { h, pres, markDirty, requestSave }
 * @returns {{ el: HTMLElement }}
 */
export function buildDescriptionSection({ h, pres, markDirty, requestSave }) {
  if (typeof pres.description !== 'string') pres.description = '';

  const wrap = h('div', { class: 'stack editor-callout' });
  const label = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.description.title', 'Description'),
  });
  const help = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.description.help',
      'Used as the public meta description when published. Keep it short (two sentences).'
    ),
  });
  const ta = h('textarea', {
    class: 'form-input',
    style: 'min-height:96px;',
    placeholder: t(
      'editor.deckSettings.description.placeholder',
      'A short, two-sentence description of this presentation…'
    ),
    value: String(pres.description || ''),
  });
  const status = h('div', { class: 'help', text: '' });
  const syncStatus = () => {
    const n = String(ta.value || '').length;
    const max = MAX_DESCRIPTION_CHARS;
    status.textContent =
      n > max
        ? t(
            'editor.deckSettings.description.tooLong',
            'Too long ({n}/{max}). Please shorten.',
            { n: String(n), max: String(max) }
          )
        : t(
            'editor.deckSettings.description.count',
            '{n}/{max} characters',
            { n: String(n), max: String(max) }
          );
  };
  syncStatus();
  ta.addEventListener('input', () => {
    pres.description = String(ta.value || '');
    markDirty?.();
    syncStatus();
  });
  ta.addEventListener('blur', () => {
    requestSave?.();
  });
  wrap.append(label, ta, help, status);
  return { el: wrap };
}
