import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { getFeatures } from '../../lib/state/features.js';

/**
 * Grey out a settings surface that isn't useful in the sandbox.
 *
 * The sandbox shows the full richness of Deckyard's settings, but options that
 * are irrelevant to an anonymous, throwaway guest (a data-export backup, comment
 * notifications to an email they don't have) are shown disabled with a short
 * "why" note rather than hidden — so a visitor still sees the capability exists.
 *
 * No-op outside sandbox mode. Disables every form control under `content`, dims
 * it, and inserts an explanatory note as the first child of `content`.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.content - The surface to disable (card/section).
 * @param {string} [opts.message] - Override for the explanatory note.
 * @returns {boolean} true when the sandbox treatment was applied.
 */
export function disableForSandbox({ content, message } = {}) {
  if (!getFeatures()?.sandboxMode || !content) return false;

  content.classList.add('is-sandbox-disabled');
  content.setAttribute('aria-disabled', 'true');
  for (const ctl of content.querySelectorAll('input, select, textarea, button')) {
    ctl.disabled = true;
  }

  const note = h('div', {
    class: 'help sandbox-settings-note',
    text: message || t('sandbox.settings.unavailable', 'Not available in the sandbox.'),
  });
  content.prepend(note);
  return true;
}
