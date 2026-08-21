import { t } from '../../../../lib/ui-i18n.js';
import { h } from '../../../../lib/dom.js';

/**
 * Build the shared "checkbox + title + help" callout row used by several
 * boolean deck settings (Q&A, Builds, author-on-preview, RSS exclusion).
 *
 * @param {object} opts
 * @param {boolean} opts.checked - initial checkbox state
 * @param {string} opts.titleKey
 * @param {string} opts.title
 * @param {string} opts.helpKey
 * @param {string} opts.help
 * @param {(checked: boolean) => void} opts.onChange
 * @returns {{ row: HTMLElement, cb: HTMLInputElement }}
 */
export function buildCheckboxCallout({
  checked,
  titleKey,
  title,
  helpKey,
  help,
  onChange,
}) {
  const row = h('label', { class: 'row is-start editor-callout' });
  const cb = h('input', { type: 'checkbox' });
  cb.checked = checked;
  const text = h('div', { class: 'stack is-gap-xs' }, [
    h('div', { class: 'field-label', text: t(titleKey, title) }),
    h('div', { class: 'help', text: t(helpKey, help) }),
  ]);
  row.append(cb, text);
  cb.addEventListener('change', () => onChange(!!cb.checked));
  return { row, cb };
}
