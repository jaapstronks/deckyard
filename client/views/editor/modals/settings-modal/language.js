import { t } from '../../../../lib/ui-i18n.js';
import { h } from '../../../../lib/dom.js';
import {
  getSupportedLangs,
  normalizeLang,
} from '../../../../lib/format/i18n.js';
import { getLangDisplayName } from '../../../../lib/format/lang-selector.js';
import { DEFAULT_DECK_LANG } from '../../../../../shared/i18n-utils.js';

/**
 * Deck-level document language hint (HTML lang for public sharing/exports).
 *
 * The options are the workspace's enabled deck languages, in axis order — this
 * used to be two hardcoded `<option>`s under a private
 * `ALLOWED_LANGS` Set of the two legacy codes, the seventh spelling of a list
 * that has one definition site now (D61). A deck already saved in a language
 * the workspace has since switched off keeps its value as an extra option, so
 * opening deck settings cannot silently rewrite it.
 *
 * @param {object} ctx - { pres, markDirty, requestSave }
 * @returns {{ el: HTMLElement }}
 */
export function buildLanguageSection({ pres, markDirty, requestSave }) {
  const enabled = getSupportedLangs();
  const stored = normalizeLang(String(pres?.lang || '').trim());
  const options = enabled.includes(stored) ? enabled : [...enabled, stored];
  const presLang = stored || enabled[0] || DEFAULT_DECK_LANG;
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
      'Used for public sharing and exports (HTML lang attribute).',
    ),
  });
  const sel = h('select', { class: 'form-input' });
  for (const code of options.filter(Boolean)) {
    sel.append(
      h('option', {
        value: code,
        text: `${getLangDisplayName(code)} (${code})`,
      }),
    );
  }
  sel.value = presLang;
  sel.addEventListener('change', () => {
    const v = String(sel.value || '').trim();
    pres.lang = normalizeLang(v) || presLang;
    markDirty?.();
    requestSave?.();
  });
  wrap.append(label, sel, help);
  return { el: wrap };
}
