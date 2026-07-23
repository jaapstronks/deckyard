import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { copyToClipboardWithPromptFallback } from '../../lib/util/clipboard.js';

/**
 * The presenter's follow-along codes pill: shows "/go + code" for the active
 * language and copies it to the clipboard. The tools menu re-parents this pill
 * into its popover and relabels the copy button, so both the pill element and
 * the copy button are returned for the caller to hand onward.
 *
 * @param {object} ctx
 * @param {string} ctx.modeLang - active presenter language ('nl' | 'en-GB' | …)
 * @returns {{
 *   el: HTMLElement,
 *   copyBtn: HTMLButtonElement,
 *   setCodes: (codes: { nl?: string, en?: string } | null) => void,
 * }}
 */
export function createPresenterFollowCodesPill({ modeLang }) {
  let codes = null;
  const pickCode = () =>
    (modeLang === 'nl' ? codes?.nl : codes?.en) || codes?.nl || codes?.en || '';

  const text = h('div', {
    class: 'presenter-followcodes-text',
    text: '',
  });
  const copyBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('presenter.followCodes.copy', 'Copy /go + code'),
    disabled: true,
    onclick: async () => {
      const code = codes ? pickCode() : '';
      if (!code) return;
      await copyToClipboardWithPromptFallback(`/go ${code}`, 'Copy:');
    },
  });
  const el = h('div', {
    class: 'presenter-followcodes',
    hidden: true,
    title: t('presenter.followCodes.title', 'Follow-along: /go + code'),
  });
  el.append(text, copyBtn);

  /** Fill the pill from the session's follow codes; a falsy code keeps it hidden. */
  const setCodes = (followCodes) => {
    codes = followCodes || null;
    const code = codes ? pickCode() : '';
    text.textContent = code ? `/go ${code}` : '/go';
    el.hidden = !code;
    copyBtn.disabled = !code;
  };

  return { el, copyBtn, setCodes };
}
