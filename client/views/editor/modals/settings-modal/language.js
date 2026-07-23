import { t } from '../../../../lib/ui-i18n.js';

const ALLOWED_LANGS = new Set(['nl', 'en-GB']);

/**
 * Deck-level document language hint (HTML lang for public sharing/exports).
 * @param {object} ctx - { h, pres, markDirty, requestSave }
 * @returns {{ el: HTMLElement }}
 */
export function buildLanguageSection({ h, pres, markDirty, requestSave }) {
  const presLang = ALLOWED_LANGS.has(String(pres?.lang || '').trim())
    ? String(pres.lang).trim()
    : 'nl';
  pres.lang = presLang;

  const wrap = h('div', { class: 'stack editor-callout' });
  const label = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.lang.title', 'Document language'),
  });
  const help = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.lang.help',
      'Used for public sharing and exports (HTML lang attribute).'
    ),
  });
  const sel = h('select', { class: 'form-input' });
  sel.append(
    h('option', { value: 'nl', text: 'Nederlands (nl)' }),
    h('option', { value: 'en-GB', text: 'English (en-GB)' })
  );
  sel.value = presLang;
  sel.addEventListener('change', () => {
    const v = String(sel.value || '').trim();
    pres.lang = ALLOWED_LANGS.has(v) ? v : 'nl';
    markDirty?.();
    requestSave?.();
  });
  wrap.append(label, sel, help);
  return { el: wrap };
}
