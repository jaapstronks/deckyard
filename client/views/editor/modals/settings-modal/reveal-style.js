import { t } from '../../../../lib/ui-i18n.js';
import {
  REVEAL_STYLES,
  DEFAULT_REVEAL_STYLE,
  normalizeRevealStyle,
} from '../../../../../shared/reveal-style.js';

/**
 * Reveal style for builds: how each body fragment (bullet/paragraph) appears.
 * @param {object} ctx - { h, pres, markDirty, requestSave }
 * @returns {{ el: HTMLElement }}
 */
export function buildRevealStyleSection({ h, pres, markDirty, requestSave }) {
  pres.settings.revealStyle =
    normalizeRevealStyle(pres.settings.revealStyle) || DEFAULT_REVEAL_STYLE;

  const wrap = h('div', { class: 'stack editor-callout' });
  const label = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.revealStyle.title', 'Reveal style'),
  });
  const help = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.revealStyle.help',
      'How each bullet appears when builds are on. Typewriter types text in character-by-character. Presenter only; falls back to instant with reduced motion.'
    ),
  });
  const REVEAL_STYLE_LABELS = {
    default: t('editor.deckSettings.revealStyle.default', 'Instant'),
    typewriter: t('editor.deckSettings.revealStyle.typewriter', 'Typewriter'),
  };
  const sel = h('select', { class: 'form-input' });
  for (const style of REVEAL_STYLES) {
    sel.append(
      h('option', { value: style, text: REVEAL_STYLE_LABELS[style] || style })
    );
  }
  sel.value = pres.settings.revealStyle;
  sel.addEventListener('change', () => {
    pres.settings.revealStyle =
      normalizeRevealStyle(sel.value) || DEFAULT_REVEAL_STYLE;
    markDirty?.();
    requestSave?.();
  });
  wrap.append(label, sel, help);
  return { el: wrap };
}
