/**
 * Slide Library Permissions
 *
 * The one client reader of "may I change this library item" (D170). The
 * server decides and sends the verdict as `canEdit` on every item of both
 * shelves; the client derives nothing. Every surface that offers a change —
 * the preview's Edit, the card menu's Move to trash, the trash view's
 * Restore, the selection bar's bulk trash — reads it here and, when the
 * answer is no, greys the control out with the same sentence beside it.
 */

import { t } from '../ui-i18n.js';
import { cleanStr } from '../../../shared/string-utils.js';
import { h } from '../dom.js';

/**
 * Whether the caller may change `item`: its content, name, description, or
 * whether it sits in the trash. Absent means no, like the server's fail-closed
 * guard.
 * @param {{canEdit?: boolean}|null|undefined} item
 * @returns {boolean}
 */
export function canEditLibraryItem(item) {
  return item?.canEdit === true;
}

/**
 * The sentence for a change the caller may not make.
 * @returns {string}
 */
export function editRefusalText() {
  return t(
    'slideLibrary.edit.notAllowed',
    'Only its maker or an admin can edit this shared slide.',
  );
}

/**
 * Grey out `control` because the caller may not change `item`, and return the
 * reason element to place beside it. The control names the reason both ways:
 * as its tooltip and through `aria-describedby`.
 * @param {HTMLButtonElement} control
 * @param {{id?: string}} item
 * @param {string} idPrefix - Keeps the reason ids of different controls for one item apart
 * @returns {HTMLElement}
 */
export function refuseEdit(control, item, idPrefix) {
  const text = editRefusalText();
  const reason = h('span', {
    class: 'help ps-lib-edit-reason',
    id: `${idPrefix}-${cleanStr(item?.id)}`,
    text,
  });
  control.disabled = true;
  control.title = text;
  control.setAttribute('aria-describedby', reason.id);
  return reason;
}

/**
 * What a failed change of a library item says. A 403 on a write to an item is
 * the D170 refusal and gets its sentence in the UI language: the server's
 * message is English, and before B411 it was absent, so the toast showed the
 * bare code `forbidden`. Anything else carries the caught error.
 * @param {any} err
 * @returns {string|Error}
 */
export function libraryWriteFailure(err) {
  if (err?.statusCode === 403) return editRefusalText();
  return err;
}
