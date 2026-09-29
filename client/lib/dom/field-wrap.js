import { h } from './index.js';

/**
 * A labelled form field: the `<label class="stack is-field">` wrapper with a
 * `.field-label` above the control and an optional `.help` line below it.
 * Wrapping in a `<label>` ties the text to the control without an id.
 *
 * @param {string} label - Field label
 * @param {HTMLElement} control - Input control
 * @param {{ helpText?: string }} [opts]
 * @returns {HTMLElement} Field wrapper
 */
export function createFieldWrap(label, control, opts = {}) {
  const helpText = typeof opts?.helpText === 'string' ? opts.helpText : '';
  return h('label', { class: 'stack is-field' }, [
    h('div', { class: 'field-label', text: label }),
    control,
    helpText ? h('div', { class: 'help', text: helpText }) : null,
  ]);
}
