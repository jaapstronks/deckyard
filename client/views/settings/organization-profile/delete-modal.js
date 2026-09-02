/**
 * Deleting the organization (organization UI, slice 6).
 *
 * This is the one action on the settings page with no undo and no bounded blast
 * radius. `organizations` is the parent of nearly every table in the schema with
 * `ON DELETE CASCADE` on it — presentations, themes, custom slide types, fonts,
 * the image library, share links, analytics, comments, every membership — so
 * removing the row removes the workspace's entire contents for everyone in it,
 * not just for the person clicking.
 *
 * Which is why this is not a `confirmModal`. The house rule is that
 * confirmations go through those helpers, and everywhere else it holds; here a
 * single "Are you sure?" is the wrong instrument, because the reader is not
 * being asked to confirm an intention but to prove they know which organization
 * they are on. Typing the name is that proof, and it is the one guard that a
 * misplaced click cannot pass. The dialog is still built from the same modal
 * helpers, so the focus trap and aria wiring are unchanged.
 */

import { h } from '../../../lib/dom.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { t } from '../../../lib/ui-i18n.js';
import { createModal } from '../../../lib/dom/modal.js';
import { deleteOrganization } from './actions.js';

/**
 * Open the delete-organization dialog.
 *
 * @param {Object} options
 * @param {Object} options.organization - Organization from `GET /api/organizations/:id`.
 * @param {Function} [options.onDeleted] - Called once the organization is gone.
 * @param {HTMLElement} [options.root=document.body] - Where to mount.
 * @param {Function} [options.remove=deleteOrganization] - Override for the call (tests).
 * @returns {Object} The modal API, already shown.
 */
export function showDeleteOrganizationModal({
  organization,
  onDeleted,
  root = document.body,
  remove = deleteOrganization,
} = {}) {
  const name = String(organization?.name || '').trim();

  const modal = createModal({
    title: t('organization.profile.delete.title', 'Delete this organization'),
    hint: t(
      'organization.profile.delete.hint',
      'Everything in this organization goes with it: its decks, themes, fonts, custom slide types, uploaded images, share links and analytics. Every member loses access. This cannot be undone.',
    ),
    modalClass: 'organization-delete-modal',
  });

  const form = h('div', { class: 'stack modal-form' });

  const field = h('label', { class: 'stack', style: 'gap: 4px;' });
  const input = h('input', {
    class: 'form-input',
    type: 'text',
    autocomplete: 'off',
  });
  field.append(
    h('span', {
      class: 'field-label',
      text: t(
        'organization.profile.delete.confirmLabel',
        'Type {name} to confirm',
        { name },
      ),
    }),
    input,
  );

  // `status` carries progress only ("Deleting…", "Saving…"). A refusal is a
  // state of this form, so it goes in the one element for that, beside the
  // action and staying until the next attempt
  // (docs/reference/feedback-surfaces.md).
  const status = h('div', { class: 'help modal-status', role: 'status' });
  const refusal = createInlineError({ callout: true });

  const buttons = h('div', { class: 'row is-end is-mt-8 modal-actions' });
  const cancel = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('common.cancel', 'Cancel'),
    onclick: () => modal.requestClose(),
  });
  const confirm = h('button', {
    class: 'btn btn-danger',
    type: 'button',
    text: t('organization.profile.delete.submit', 'Delete organization'),
    disabled: true,
    onclick: () => submit(),
  });
  buttons.append(cancel, confirm);

  // The button unlocks only on an exact match. Case and surrounding whitespace
  // are forgiven — they are typing accidents, not signs of the wrong workspace.
  input.oninput = () => {
    confirm.disabled = input.value.trim().toLowerCase() !== name.toLowerCase();
  };

  form.append(field, status, refusal.el, buttons);
  modal.append(form);
  modal.show(root);

  requestAnimationFrame(() => {
    try {
      input.focus();
    } catch {
      // ignore
    }
  });

  return modal;

  /**
   * Delete, and hand the outcome back to the panel.
   * @returns {Promise<void>}
   */
  async function submit() {
    if (modal.isBusy()) return;

    refusal.clear();
    setDisabled(true);
    status.textContent = t('organization.profile.delete.working', 'Deleting…');

    try {
      await remove({ organizationId: organization.id });
      modal.close();
      onDeleted?.();
    } catch (err) {
      // The server's own sentence is the specific one here — "Only the owner
      // can delete the organization", "The default organization cannot be
      // deleted" — and both are rules this dialog cannot restate better.
      status.textContent = '';
      refusal.show(
        err?.message ||
          t(
            'organization.profile.delete.failed',
            'Could not delete the organization.',
          ),
      );
      setDisabled(false);
    }
  }

  /**
   * Lock or unlock the dialog, its own close paths included.
   * @param {boolean} value - Whether a request is in flight.
   */
  function setDisabled(value) {
    modal.setBusy(value);
    input.disabled = value;
    cancel.disabled = value;
    confirm.disabled = value;
  }
}
