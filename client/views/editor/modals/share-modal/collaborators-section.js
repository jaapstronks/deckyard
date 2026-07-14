/**
 * Collaborators section for inviting workspace users.
 * Allows selecting multiple users from the workspace and assigning permissions.
 */

import { t } from '../../../../lib/ui-i18n.js';
import { createUserAutocomplete } from '../../../../lib/user-autocomplete.js';
import { openRevokeMessageModal, REVOKE_CONTEXT } from '../revoke-message-modal.js';
import { confirmModal, promptModal } from '../../../../lib/modal.js';

/**
 * Permission descriptions for tooltips
 */
const PERMISSION_DESCRIPTIONS = {
  view: 'share.permission.viewDescription',
  comment: 'share.permission.commentDescription',
  edit: 'share.permission.editDescription',
  admin: 'share.permission.adminDescription',
};

/**
 * Create the collaborators section component.
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function
 * @param {Function} options.api - API call function
 * @param {string} options.presentationId - Presentation ID
 * @param {Object} options.pres - Presentation object
 * @param {string} options.currentUserEmail - Current user's email
 * @param {Object} options.toast - Toast notification service
 * @param {boolean} [options.isOwner] - Whether current user is the owner
 * @param {HTMLElement} options.modalRoot - Root element for nested modals
 * @param {Array} [options.openOverlayClosers] - Overlay closers array
 * @returns {Object} { element, loadCollaborators, detach }
 */
export function createCollaboratorsSection({ h, api, presentationId, pres, currentUserEmail, toast, isOwner, modalRoot, openOverlayClosers }) {
  let collaborators = [];
  let isAddingCollaborator = false;
  let autocomplete = null;
  const ownerEmail = pres?.ownerEmail || pres?.createdBy;

  const section = h('div', { class: 'share-collaborators-section' });
  const title = h('div', {
    class: 'share-section-title',
    text: t('share.collaborators.title', 'Invite Workspace Users'),
  });

  const helpText = h('div', {
    class: 'help share-collaborators-help',
    text: t(
      'share.collaborators.help',
      'Invite team members to collaborate on this presentation.'
    ),
  });

  // Add collaborator form
  const form = h('div', { class: 'share-collaborator-form' });

  // Create user autocomplete
  autocomplete = createUserAutocomplete({
    api,
    excludeEmails: [currentUserEmail, pres?.ownerEmail].filter(Boolean),
    placeholder: t('share.collaborators.searchUsers', 'Search users to invite...'),
  });

  const permissionSelect = h('select', { class: 'form-input share-collaborator-permission' });
  permissionSelect.append(
    h('option', { value: 'view', text: t('share.permission.view', 'Can view') }),
    h('option', { value: 'comment', text: t('share.permission.comment', 'Can comment') }),
    h('option', { value: 'edit', text: t('share.permission.edit', 'Can edit') }),
    h('option', { value: 'admin', text: t('share.permission.admin', 'Admin') })
  );

  const addBtn = h('button', {
    class: 'btn btn-primary',
    text: t('share.collaborators.invite', 'Invite'),
  });

  // Progress indicator for batch invites
  const progressEl = h('div', { class: 'share-collaborator-progress' });

  const formRow = h('div', { class: 'share-collaborator-form-row has-autocomplete' }, [
    autocomplete.el,
    permissionSelect,
    addBtn,
  ]);

  form.append(formRow, progressEl);

  // Collaborators list
  const list = h('div', { class: 'share-collaborators-list' });

  section.append(title, helpText, form, list);

  function updateExcludeEmails() {
    // Exclude owner, current user, and existing collaborators
    const excludeEmails = [
      currentUserEmail,
      pres?.ownerEmail,
      ...collaborators.map((c) => c.userEmail),
    ].filter(Boolean).map((e) => e.toLowerCase());

    autocomplete.setExcludeEmails(excludeEmails);
  }

  async function loadCollaborators() {
    try {
      const resp = await api(`/api/presentations/${presentationId}/collaborators`);
      collaborators = resp?.collaborators || [];
      renderCollaboratorsList();
      updateExcludeEmails();
    } catch {
      list.innerHTML = '';
      list.append(
        h('div', { class: 'share-collaborators-error', text: t('share.collaborators.loadError', 'Failed to load collaborators') })
      );
    }
  }

  /**
   * Render the owner item at the top of the list
   */
  function renderOwnerItem() {
    if (!ownerEmail) return null;

    const item = h('div', { class: 'share-collaborator-item share-collaborator-owner' });

    const info = h('div', { class: 'share-collaborator-info' });
    const emailEl = h('div', { class: 'share-collaborator-email', text: ownerEmail });
    const badge = h('span', {
      class: 'share-owner-badge',
      text: t('share.collaborators.owner', 'Owner'),
    });
    info.append(emailEl, badge);

    // Transfer ownership button (only for owner)
    if (isOwner) {
      const transferBtn = h('button', {
        class: 'btn btn-secondary btn-sm',
        text: t('share.collaborators.transferOwnership', 'Transfer'),
        title: t('share.collaborators.transferOwnershipTitle', 'Transfer ownership to another user'),
        onclick: () => showTransferOwnershipDialog(),
      });
      item.append(info, transferBtn);
    } else {
      item.append(info);
    }

    return item;
  }

  /**
   * Show transfer ownership dialog
   */
  async function showTransferOwnershipDialog() {
    // Get list of potential new owners (collaborators with edit or admin permission)
    const eligibleUsers = collaborators.filter(
      (c) => c.permission === 'edit' || c.permission === 'admin'
    );

    if (eligibleUsers.length === 0) {
      toast?.warning(
        t('share.collaborators.noEligibleOwners', 'No collaborators with edit access to transfer ownership to. Add a collaborator with edit or admin permission first.'),
        { durationMs: 4000 }
      );
      return;
    }

    const newOwner = await promptModal(h, modalRoot, {
      title: t('share.collaborators.transferOwnership', 'Transfer ownership'),
      message: t('share.collaborators.transferOwnershipPrompt', 'Enter the email of the new owner (must be an existing collaborator with edit access):\n\nEligible users: {users}', {
        users: eligibleUsers.map((u) => u.userEmail).join(', '),
      }),
      placeholder: t('share.collaborators.transferOwnershipPlaceholder', 'name@example.com'),
      confirmLabel: t('common.continue', 'Continue'),
    }, openOverlayClosers);

    if (!newOwner) return;

    const trimmedEmail = newOwner.trim().toLowerCase();
    const eligible = eligibleUsers.find((u) => u.userEmail.toLowerCase() === trimmedEmail);

    if (!eligible) {
      toast?.error(
        t('share.collaborators.notEligibleOwner', 'This user is not eligible for ownership transfer. They must have edit or admin permission.'),
        { durationMs: 3000 }
      );
      return;
    }

    const confirmed = await confirmModal(h, modalRoot, {
      title: t('share.collaborators.transferOwnership', 'Transfer ownership'),
      message: t('share.collaborators.transferOwnershipConfirm', 'Transfer ownership of this presentation to {email}?\n\nYou will become a collaborator with edit access.', {
        email: trimmedEmail,
      }),
      confirmLabel: t('share.collaborators.transferOwnership', 'Transfer ownership'),
      danger: true,
    }, openOverlayClosers);

    if (!confirmed) return;

    try {
      await api(`/api/presentations/${presentationId}/transfer-ownership`, {
        method: 'POST',
        body: JSON.stringify({ newOwnerEmail: trimmedEmail }),
      });
      toast?.success(
        t('share.collaborators.ownershipTransferred', 'Ownership transferred to {email}', { email: trimmedEmail }),
        { durationMs: 3000 }
      );
      // Reload the page to reflect the change
      window.location.reload();
    } catch (e) {
      toast?.error(String(e?.message || e), { durationMs: 3000 });
    }
  }

  function renderCollaboratorsList() {
    list.innerHTML = '';

    // Always show owner at top
    const ownerItem = renderOwnerItem();
    if (ownerItem) {
      list.append(ownerItem);
    }

    if (collaborators.length === 0) {
      list.append(
        h('div', { class: 'share-collaborators-empty', text: t('share.collaborators.empty', 'No collaborators yet') })
      );
      return;
    }

    for (const collab of collaborators) {
      const item = h('div', { class: 'share-collaborator-item' });

      const info = h('div', { class: 'share-collaborator-info' });
      const email = h('div', { class: 'share-collaborator-email', text: collab.userEmail });
      const name = collab.userName ? h('div', { class: 'share-collaborator-name', text: collab.userName }) : null;
      if (name) info.append(name);
      info.append(email);

      // Permission selector with tooltip
      const permSelect = h('select', {
        class: 'form-input share-collaborator-perm-select',
        title: t(PERMISSION_DESCRIPTIONS[collab.permission] || '', ''),
        onchange: async () => {
          try {
            permSelect.disabled = true;
            await api(`/api/presentations/${presentationId}/collaborators/${encodeURIComponent(collab.userEmail)}`, {
              method: 'PATCH',
              body: JSON.stringify({ permission: permSelect.value }),
            });
            await loadCollaborators();
            toast?.success(t('share.collaborators.permissionUpdated', 'Permission updated'), { durationMs: 2000 });
          } catch (e) {
            toast?.error(String(e?.message || e), { durationMs: 3000 });
            permSelect.value = collab.permission;
          } finally {
            permSelect.disabled = false;
          }
        },
      });
      permSelect.append(
        h('option', {
          value: 'view',
          text: t('share.permission.view', 'Can view'),
          selected: collab.permission === 'view',
          title: t('share.permission.viewDescription', 'Can only view the presentation'),
        }),
        h('option', {
          value: 'comment',
          text: t('share.permission.comment', 'Can comment'),
          selected: collab.permission === 'comment',
          title: t('share.permission.commentDescription', 'Can view and add comments'),
        }),
        h('option', {
          value: 'edit',
          text: t('share.permission.edit', 'Can edit'),
          selected: collab.permission === 'edit',
          title: t('share.permission.editDescription', 'Can edit the presentation'),
        }),
        h('option', {
          value: 'admin',
          text: t('share.permission.admin', 'Admin'),
          selected: collab.permission === 'admin',
          title: t('share.permission.adminDescription', 'Can edit and manage collaborators'),
        })
      );

      const removeBtn = h('button', {
        class: 'btn btn-danger btn-sm',
        text: t('share.collaborators.remove', 'Remove'),
        onclick: async () => {
          const result = await openRevokeMessageModal({
            h,
            root: modalRoot || document.body,
            context: REVOKE_CONTEXT.COLLABORATOR,
            targetName: collab.userName || collab.userEmail,
            openOverlayClosers,
          });
          if (!result.ok) return;
          try {
            await api(`/api/presentations/${presentationId}/collaborators/${encodeURIComponent(collab.userEmail)}`, {
              method: 'DELETE',
              body: JSON.stringify({ message: result.message }),
            });
            await loadCollaborators();
            toast?.success(t('share.collaborators.removed', 'Collaborator removed'), { durationMs: 2000 });
          } catch (e) {
            toast?.error(String(e?.message || e), { durationMs: 3000 });
          }
        },
      });

      item.append(info, permSelect, removeBtn);
      list.append(item);
    }
  }

  addBtn.addEventListener('click', async () => {
    const selectedUsers = autocomplete.getSelected();
    if (selectedUsers.length === 0) {
      toast?.error(t('share.collaborators.selectUserError', 'Please select at least one user'), { durationMs: 2000 });
      return;
    }

    if (isAddingCollaborator) return;
    isAddingCollaborator = true;
    addBtn.disabled = true;

    const isBatch = selectedUsers.length > 1;
    if (isBatch) {
      addBtn.textContent = t('share.collaborators.invitingMultiple', 'Inviting {count}...', { count: selectedUsers.length });
      progressEl.textContent = t('share.collaborators.progress', 'Sending invitations...');
      progressEl.classList.add('is-visible');
    } else {
      addBtn.textContent = t('share.collaborators.inviting', 'Inviting...');
    }

    try {
      const userEmails = selectedUsers.map((u) => u.email);

      const resp = await api(`/api/presentations/${presentationId}/collaborators`, {
        method: 'POST',
        body: JSON.stringify({
          userEmails,
          permission: permissionSelect.value,
        }),
      });

      // Reset form
      autocomplete.clear();
      permissionSelect.value = 'view';

      await loadCollaborators();

      // Show appropriate success message
      if (resp?.summary) {
        const { successful, failed, total } = resp.summary;
        if (failed > 0) {
          toast?.warning(
            t('share.collaborators.invitedPartial', '{successful} of {total} invitations sent. {failed} failed.', { successful, total, failed }),
            { durationMs: 4000 }
          );
        } else {
          toast?.success(
            t('share.collaborators.invitedMultiple', '{count} invitations sent', { count: successful }),
            { durationMs: 2500 }
          );
        }
      } else {
        toast?.success(t('share.collaborators.invited', 'Invitation sent'), { durationMs: 2500 });
      }
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('already_exists')) {
        toast?.error(t('share.collaborators.alreadyExists', 'One or more users are already collaborators'), { durationMs: 3000 });
      } else {
        toast?.error(msg, { durationMs: 3000 });
      }
    } finally {
      isAddingCollaborator = false;
      addBtn.disabled = false;
      addBtn.textContent = t('share.collaborators.invite', 'Invite');
      progressEl.classList.remove('is-visible');
      progressEl.textContent = '';
    }
  });

  return {
    element: section,
    loadCollaborators,
    detach: () => {
      autocomplete?.detach();
    },
  };
}