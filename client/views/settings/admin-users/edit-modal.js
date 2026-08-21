/**
 * Edit user modal with profile image upload.
 */

import { h } from '../../../lib/dom.js';
import { createModal, createModalActions } from '../../../lib/dom/modal.js';
import { labeledCheckbox } from '../../../lib/dom/labeled-checkbox.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { api } from '../../../lib/api.js';
import { createAvatar, updateAvatar } from '../../../lib/user/avatar.js';
import { displayNameFromEmail } from '../../../lib/user/user-format.js';
import {
  invalidateProfile,
  getUserProfileAsync,
} from '../../../lib/user/user-profiles.js';

/**
 * Create profile image section with upload/remove buttons.
 * @param {Object} targetUser - User being edited
 * @param {HTMLElement} avatarEl - Avatar element to update
 * @param {string} initialImageUrl - Initial image URL
 * @returns {{ section: HTMLElement, getCurrentImageUrl: () => string }}
 */
function createProfileImageSection(targetUser, avatarEl, initialImageUrl) {
  let currentImageUrl = initialImageUrl;

  const profileSection = h('div', {
    class: 'profile-image-section',
    style: 'margin-bottom: 12px;',
  });
  const imageActions = h('div', { class: 'profile-image-actions' });

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp',
    style: 'display: none;',
  });

  const uploadBtn = h('button', {
    class: 'btn btn-sm btn-secondary',
    type: 'button',
    text: t('admin.users.uploadPhoto', 'Upload photo'),
  });

  const removeBtn = h('button', {
    class: 'btn btn-sm btn-secondary',
    type: 'button',
    text: t('admin.users.removePhoto', 'Remove'),
    style: currentImageUrl ? '' : 'display: none;',
  });

  const imageStatus = h('div', {
    class: 'help',
    text: '',
    style: 'font-size: 11px;',
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      imageStatus.textContent = t(
        'admin.users.invalidImageType',
        'Invalid image type.',
      );
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      imageStatus.textContent = t(
        'admin.users.imageTooLarge',
        'Image too large (max 5MB).',
      );
      return;
    }

    uploadBtn.disabled = true;
    imageStatus.textContent = t('admin.users.uploading', 'Uploading…');

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const resp = await api(
        `/api/profile/image/${encodeURIComponent(targetUser.email)}`,
        {
          method: 'POST',
          body: JSON.stringify({ dataUrl }),
        },
      );

      if (resp?.imageUrl) {
        currentImageUrl = resp.imageUrl;
        updateAvatar(avatarEl, { imageUrl: currentImageUrl });
        removeBtn.style.display = '';
        imageStatus.textContent = '';
        invalidateProfile(targetUser.id);
      }
    } catch (err) {
      imageStatus.textContent = String(
        err?.message || t('admin.users.uploadFailed', 'Upload failed'),
      );
    } finally {
      uploadBtn.disabled = false;
      fileInput.value = '';
    }
  });

  uploadBtn.addEventListener('click', () => fileInput.click());

  removeBtn.addEventListener('click', async () => {
    removeBtn.disabled = true;
    imageStatus.textContent = t('admin.users.removing', 'Removing…');

    try {
      await api(`/api/profile/image/${encodeURIComponent(targetUser.email)}`, {
        method: 'DELETE',
      });
      currentImageUrl = '';
      updateAvatar(avatarEl, { imageUrl: '' });
      removeBtn.style.display = 'none';
      imageStatus.textContent = '';
      invalidateProfile(targetUser.id);
    } catch (err) {
      imageStatus.textContent = String(
        err?.message || t('admin.users.removeFailed', 'Failed to remove'),
      );
    } finally {
      removeBtn.disabled = false;
    }
  });

  imageActions.append(uploadBtn, removeBtn, fileInput);
  profileSection.append(avatarEl, imageActions, imageStatus);

  return {
    section: profileSection,
    getCurrentImageUrl: () => currentImageUrl,
  };
}

/**
 * Show modal to edit a user.
 * @param {Object} targetUser - User to edit
 * @param {Function} onSuccess - Callback after successful update
 */
export async function showEditModal(targetUser, onSuccess) {
  const modal = createModal({
    title: t('admin.users.editModal.title', 'Edit user'),
  });

  const form = h('div', { class: 'stack modal-form' });

  const emailDisplay = h('div', {
    class: 'help',
    text: targetUser.email,
    style: 'margin-bottom: 8px;',
  });

  // Fetch existing profile data
  let currentImageUrl = '';
  const profile = await getUserProfileAsync(targetUser.id).catch(() => null);
  if (profile?.imageUrl) {
    currentImageUrl = profile.imageUrl;
  }

  const avatarEl = createAvatar({
    seed: targetUser.id || targetUser.email,
    name: targetUser.name || displayNameFromEmail(targetUser.email),
    imageUrl: currentImageUrl,
    size: 'lg',
  });

  const { section: profileSection } = createProfileImageSection(
    targetUser,
    avatarEl,
    currentImageUrl,
  );

  const nameInput = h('input', {
    class: 'form-input',
    type: 'text',
    placeholder: t(
      'admin.users.addModal.namePlaceholder',
      'Full name (optional)',
    ),
    value: targetUser.name || '',
  });

  const roleSelect = h('select', { class: 'form-input' });
  roleSelect.append(
    h('option', {
      value: 'user',
      text: t('admin.users.roleUser', 'User'),
      selected: targetUser.role !== 'admin',
    }),
    h('option', {
      value: 'admin',
      text: t('admin.users.roleAdmin', 'Admin'),
      selected: targetUser.role === 'admin',
    }),
  );

  // Designer capability toggle
  const { element: designerRow, input: designerCheckbox } = labeledCheckbox({
    text: t('admin.users.designerCapability', 'Designer'),
    className: 'form-checkbox-row',
    checked: Boolean(targetUser.isExplicitDesigner),
    labelAttrs: {
      style: 'display: flex; align-items: center; gap: 8px; margin-top: 4px;',
    },
  });
  const designerHelp = h('div', {
    class: 'help',
    text: t(
      'admin.users.designerHelp',
      'Can manage themes and slide types. Admins and owners have this by default.',
    ),
    style: 'font-size: 11px; margin-top: 2px;',
  });

  const status = h('div', { class: 'help modal-status', role: 'status' });

  const actions = createModalActions({
    cancelText: t('common.cancel', 'Cancel'),
    actionText: t('admin.users.editModal.submit', 'Save changes'),
    onCancel: () => modal.requestClose(),
    onAction: () => submit(),
  });

  form.append(
    emailDisplay,
    profileSection,
    nameInput,
    roleSelect,
    designerRow,
    designerHelp,
    status,
    actions.wrap,
  );
  modal.append(form);
  modal.show(document.body);

  requestAnimationFrame(() => {
    try {
      nameInput.focus();
    } catch {
      // ignore
    }
  });

  return modal;

  /**
   * Set the disabled state of every input in the form.
   * @param {boolean} disabled - Whether the form is locked
   */
  function setDisabled(disabled) {
    actions.setDisabled(disabled);
    nameInput.disabled = disabled;
    roleSelect.disabled = disabled;
    designerCheckbox.disabled = disabled;
  }

  /**
   * Save the edited user and report the outcome.
   * @returns {Promise<void>}
   */
  async function submit() {
    if (modal.isBusy()) return;

    const name = nameInput.value.trim();
    const role = roleSelect.value;
    const isDesigner = designerCheckbox.checked;

    modal.setBusy(true);
    setDisabled(true);
    status.textContent = t('admin.users.editModal.saving', 'Saving…');

    try {
      await api(`/api/admin/users/${targetUser.id}`, {
        method: 'PATCH',
        body: { name, role, isDesigner },
      });
      toast.success(
        t('admin.users.editModal.success', 'User updated successfully.'),
      );
      modal.setBusy(false);
      modal.close();
      onSuccess();
    } catch (e) {
      status.textContent = t(
        'admin.users.editModal.error',
        'Failed to update user.',
      );
      modal.setBusy(false);
      setDisabled(false);
    }
  }
}
