/**
 * Unsaved changes of one explicit-Save settings form (B805).
 *
 * A form with its own Save button holds edits the server has not seen. The
 * tracker compares what the controls show now against the snapshot of the
 * last load or save, shows a status line beside Save while they differ, and
 * lets the settings page ask before a section switch would drop them (see
 * `hasUnsavedChanges` / `discardChanges` in ./index.js). It is not a state
 * framework: the form keeps owning its controls; the tracker only reads and
 * restores them through the two functions it is given.
 */

import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.root - Element whose `input`/`change` events mark
 *   an edit; the form card.
 * @param {() => unknown} opts.read - The current value of the form, JSON-able.
 * @param {(value: any) => void} opts.write - Put a snapshot back into the
 *   controls.
 * @returns {{
 *   statusEl: HTMLElement,
 *   isDirty: () => boolean,
 *   sync: () => void,
 *   markSaved: () => void,
 *   discard: () => void,
 * }}
 */
export function createUnsavedTracker({ root, read, write }) {
  let snapshot = JSON.stringify(read());
  const statusEl = h('p', {
    class: 'help settings-unsaved-status',
    role: 'status',
  });

  const isDirty = () => JSON.stringify(read()) !== snapshot;

  /** Refresh the status line from the controls. */
  const sync = () => {
    statusEl.textContent = isDirty()
      ? t('common.unsavedChanges', 'Unsaved changes')
      : '';
  };

  root.addEventListener('input', sync);
  root.addEventListener('change', sync);

  return {
    statusEl,
    isDirty,
    sync,
    /** Take what the controls show now as the saved state. */
    markSaved() {
      snapshot = JSON.stringify(read());
      sync();
    },
    /** Put the last saved state back into the controls. */
    discard() {
      write(JSON.parse(snapshot));
      sync();
    },
  };
}
