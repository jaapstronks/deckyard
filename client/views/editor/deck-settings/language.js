import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom/index.js';
import { normalizeLang } from '../../../lib/format/i18n.js';
import { getLangDisplayName } from '../../../../shared/i18n-utils.js';
import { existingVersionLangs } from '../../../../shared/i18n-progress.js';

/**
 * The deck's languages: the source language and the versions beside it.
 *
 * `lang` is the language the deck was written in, not a free HTML hint: the
 * save service refuses a changed value and points at the translate route
 * instead. This section used to offer a select that wrote `pres.lang` (and
 * normalized it on open), a change no save could ever accept (B804). It reads
 * now, and sends adding and editing languages to the translation view; where
 * there is nothing to translate against yet, the language menu in the top
 * bar is where a language is added.
 *
 * @param {object} ctx
 * @param {object} ctx.pres
 * @param {Function} [ctx.onOpenTranslateView] - opens the translation view;
 *   absent where it cannot open (one language, or no editor around it)
 * @returns {{ el: HTMLElement }}
 */
export function buildLanguageSection({ pres, onOpenTranslateView }) {
  const source = normalizeLang(String(pres?.lang || '').trim());
  const others = existingVersionLangs(pres).filter((lang) => lang !== source);
  const name = (code) => `${getLangDisplayName(code)} (${code})`;

  const wrap = h('div', { class: 'stack editor-callout deck-settings-lang' });
  wrap.append(
    h('div', {
      class: 'field-label',
      text: t('editor.deckSettings.lang.source', 'Source language'),
    }),
    h('div', {
      class: 'deck-settings-lang-source',
      text: source
        ? name(source)
        : t('editor.deckSettings.lang.unknown', 'Not set'),
    }),
    h('div', {
      class: 'help',
      text: t(
        'editor.deckSettings.lang.sourceHelp',
        'The language this deck was written in. It is fixed; other languages are versions of it.',
      ),
    }),
  );

  if (others.length) {
    wrap.append(
      h('div', {
        class: 'field-label',
        text: t('editor.deckSettings.lang.versions', 'Language versions'),
      }),
      h(
        'ul',
        { class: 'deck-settings-lang-versions' },
        others.map((code) => h('li', { text: name(code) })),
      ),
    );
  }

  if (onOpenTranslateView) {
    wrap.append(
      h('button', {
        type: 'button',
        class: 'btn btn-secondary deck-settings-lang-translate',
        text: t('editor.deckSettings.lang.translate', 'Open translations'),
        onclick: () => onOpenTranslateView(),
      }),
    );
  } else {
    wrap.append(
      h('div', {
        class: 'help',
        text: t(
          'editor.deckSettings.lang.addHint',
          'Add a language from the language menu in the top bar.',
        ),
      }),
    );
  }
  return { el: wrap };
}
