/**
 * Link-field feedback for the editor form: the `url` and `email` field types.
 *
 * A link type is a string to the input and an `href` to every reader, so a
 * value the field-type validator refuses (a bare domain, a `javascript:` URL,
 * an address without a domain) would render as no link at all. The editor's
 * save does not run that validator, so the hint has to be where the value is
 * typed. Same shape as the required-field flag (`required.js`): polite, shown
 * once the field has been left, cleared as soon as the value is fixed, never
 * moving focus.
 */

import { t } from '../../../lib/ui-i18n.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { validateFieldValue } from '../../../../shared/slide-types/field-types.js';

/**
 * The sentence for a refused link value, per field type.
 * @param {'url'|'email'} fieldType
 * @returns {string}
 */
function problemCopy(fieldType) {
  return fieldType === 'email'
    ? t(
        'editor.fields.emailInvalid',
        'Enter an e-mail address, like name@example.com.',
      )
    : t(
        'editor.fields.linkInvalid',
        'Enter a full link (https://…), a mailto: address, a /path or a slide jump (#3).',
      );
}

/**
 * Give a link field its input kind and wire its inline hint.
 *
 * An `email` field is an e-mail input; a `url` field keeps a text input with
 * the URL keyboard, because a native `type="url"` would call a root-relative
 * path or a slide jump invalid. Any other field type is left untouched.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.wrap - The field wrapper; the hint is appended.
 * @param {HTMLInputElement} opts.control - The input to watch.
 * @param {string} [opts.fieldType] - The declared field type.
 * @returns {HTMLElement} `wrap`, for chaining off a builder's return.
 */
export function markLinkField({ wrap, control, fieldType } = {}) {
  if (!wrap || !control) return wrap;
  if (fieldType !== 'url' && fieldType !== 'email') return wrap;

  if (fieldType === 'email') control.type = 'email';
  else control.inputMode = 'url';

  const error = createInlineError({ live: 'polite' });
  wrap.append(error.el);

  let visited = false;
  const refresh = () => {
    const invalid =
      visited &&
      validateFieldValue(control.value, { key: 'value', type: fieldType })
        .length > 0;
    if (invalid) {
      if (!error.shown) {
        error.show(problemCopy(fieldType), { control, focus: false });
      }
    } else if (error.shown) {
      error.clear();
    }
  };

  control.addEventListener('blur', () => {
    visited = true;
    refresh();
  });
  control.addEventListener('input', () => {
    if (visited) refresh();
  });
  return wrap;
}
