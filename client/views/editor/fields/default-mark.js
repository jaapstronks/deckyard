/**
 * The visible default of a choice control (D346): the option that is the
 * default carries a dot with the tooltip "Default", and while the value
 * deviates a "Back to default" button sits under the control. Without a
 * deviation there is no button, so a reset never reads as a pending change.
 *
 * The reset is the same act as choosing the default option: it goes through
 * the control's own `onChange(defaultValue)`, so the caller's write path
 * decides what "default" stores (a pruned `content.textStyles` entry, the
 * type's default value for a content enum). One home per setting: the mark
 * lives in the control, never on a tab or in the Fields form.
 */
import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom/index.js';

/** The tooltip and accessible suffix of the default option. */
function defaultMarkLabel() {
  return t('editor.fields.default', 'Default');
}

/**
 * Whether `defaultValue` names one of the offered options. A control without
 * a declared default, or with a default it does not offer, shows no mark.
 * @param {Array<{value: string}>} options
 * @param {unknown} defaultValue
 * @returns {boolean}
 */
export function hasDefaultOption(options, defaultValue) {
  if (defaultValue == null) return false;
  const d = String(defaultValue);
  return options.some((o) => String(o?.value ?? '') === d);
}

/**
 * The dot that marks the default option. It is decoration: the option itself
 * carries "(Default)" in its title and accessible name.
 * @returns {HTMLElement}
 */
export function defaultDot() {
  return h('span', { class: 'field-default-dot', 'aria-hidden': 'true' });
}

/**
 * An option's name with the default mark: "Fill (Default)".
 * @param {string} name
 * @returns {string}
 */
export function withDefaultMark(name) {
  return `${name} (${defaultMarkLabel()})`;
}

/**
 * The "Back to default" button for one control. `sync(value)` shows it only
 * while `value` differs from the default; a click hands the default to
 * `apply`, which updates the control and runs its onChange.
 * @param {Object} opts
 * @param {unknown} opts.defaultValue
 * @param {unknown} opts.value - the control's current value
 * @param {(value: string) => void} opts.apply
 * @returns {{ el: HTMLElement, sync: (value: unknown) => void }}
 */
export function createResetToDefault({ defaultValue, value, apply }) {
  const d = String(defaultValue);
  const el = h('button', {
    type: 'button',
    class: 'field-reset-default',
    text: t('editor.fields.resetToDefault', 'Back to default'),
    onclick: () => apply(d),
  });
  const sync = (v) => {
    el.hidden = String(v ?? '') === d;
  };
  sync(value);
  return { el, sync };
}
