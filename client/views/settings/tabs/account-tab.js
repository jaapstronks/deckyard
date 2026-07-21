/**
 * Account Tab Component
 * Profile section + password section
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { api } from '../../../lib/api.js';
import { createAvatar, updateAvatar } from '../../../lib/user/avatar.js';
import { invalidateProfile } from '../../../lib/user/user-profiles.js';
import { createPasswordSection } from '../sections/index.js';
import { fetchMySettings, updateMySettings, invalidateSettingsCache } from '../../../lib/net/settings.js';

/**
 * Create the account tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createAccountTab({ user }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-account',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-account-btn',
    'data-tab': 'account',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.account', 'Account'),
  });

  // Profile card
  const profileCard = h('div', { class: 'stack editor-card' });
  profileCard.append(
    h('div', { class: 'field-label', text: t('settings.profile.title', 'Profile') })
  );

  // Profile image section
  let currentImageUrl = '';
  const profileImageWrap = h('div', { class: 'profile-image-section' });

  const avatarEl = createAvatar({
    email: user?.email || '',
    name: user?.name || '',
    size: 'xl',
    className: 'profile-image-preview',
  });

  const profileImageActions = h('div', { class: 'profile-image-actions' });

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp',
    style: 'display: none;',
  });

  const uploadBtn = h('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    text: t('settings.profile.uploadImage', 'Upload photo'),
  });

  const removeBtn = h('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    text: t('settings.profile.removeImage', 'Remove'),
    style: 'display: none;',
  });

  const imageStatus = h('div', { class: 'help', text: '' });

  // File input change handler
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    // Validate file type
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error(t('settings.profile.invalidImageType', 'Please select a PNG, JPEG, or WebP image.'), { id: 'profile-image' });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('settings.profile.imageTooLarge', 'Image must be smaller than 5MB.'), { id: 'profile-image' });
      return;
    }

    uploadBtn.disabled = true;
    imageStatus.textContent = t('settings.profile.uploading', 'Uploading...');

    try {
      // Read file as data URL
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Upload to server
      const resp = await api('/api/profile/image', {
        method: 'POST',
        body: JSON.stringify({ dataUrl }),
      });

      if (resp?.imageUrl) {
        currentImageUrl = resp.imageUrl;
        updateAvatar(avatarEl, { imageUrl: currentImageUrl });
        removeBtn.style.display = '';
        toast.success(t('settings.profile.imageUploaded', 'Profile photo updated.'), { id: 'profile-image', durationMs: 2000 });
        invalidateProfile(user?.email);
      }
    } catch (err) {
      toast.error(String(err?.message || err), { id: 'profile-image' });
    } finally {
      uploadBtn.disabled = false;
      imageStatus.textContent = '';
      fileInput.value = '';
    }
  });

  uploadBtn.addEventListener('click', () => fileInput.click());

  removeBtn.addEventListener('click', async () => {
    removeBtn.disabled = true;
    imageStatus.textContent = t('settings.profile.removing', 'Removing...');

    try {
      await api('/api/profile/image', { method: 'DELETE' });
      currentImageUrl = '';
      updateAvatar(avatarEl, { imageUrl: '' });
      removeBtn.style.display = 'none';
      toast.success(t('settings.profile.imageRemoved', 'Profile photo removed.'), { id: 'profile-image', durationMs: 2000 });
      invalidateProfile(user?.email);
    } catch (err) {
      toast.error(String(err?.message || err), { id: 'profile-image' });
    } finally {
      removeBtn.disabled = false;
      imageStatus.textContent = '';
    }
  });

  profileImageActions.append(uploadBtn, removeBtn, fileInput);
  profileImageWrap.append(avatarEl, profileImageActions, imageStatus);

  // Profile name input
  const profileName = h('input', {
    class: 'form-input settings-compact-control',
    placeholder: t('settings.profile.placeholder', 'Display name (optional)'),
    value: '',
  });
  const profileHint = h('div', {
    class: 'help',
    text: t(
      'settings.profile.hint',
      'Used as your name in the app (instead of the auth name).'
    ),
  });
  profileCard.append(profileImageWrap, profileName, profileHint);

  // Save button for profile
  const profileActions = h('div', { class: 'row is-end', style: 'margin-top: var(--ps-space-3);' });
  const btnSaveProfile = h('button', {
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  profileActions.append(btnSaveProfile);
  profileCard.append(profileActions);

  // Password section
  const passwordSection = createPasswordSection({ h });

  const cards = h('div', { class: 'settings-tab-cards' }, [
    profileCard,
    passwordSection.element,
  ]);

  container.append(title, cards);

  let busy = false;
  let loaded = false;

  const load = async () => {
    if (loaded) return;
    loaded = true;

    try {
      const my = await fetchMySettings();
      profileName.value = String(my?.profile?.name || '');

      // Load profile image
      const savedImageUrl = String(my?.profile?.imageUrl || '').trim();
      if (savedImageUrl) {
        currentImageUrl = savedImageUrl;
        updateAvatar(avatarEl, { imageUrl: savedImageUrl, name: my?.profile?.name || user?.name });
        removeBtn.style.display = '';
      }
    } catch (e) {
      toast.error(String(e?.message || e), { id: 'settings-load' });
    }
  };

  btnSaveProfile.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    btnSaveProfile.disabled = true;
    profileName.disabled = true;

    try {
      const name = String(profileName.value || '').trim();
      await updateMySettings({ profile: { name } });
      invalidateSettingsCache();
      toast.success(t('settings.saved', 'Saved.'), {
        id: 'settings-save',
        durationMs: 1800,
      });
    } catch (e) {
      toast.error(String(e?.message || e), { id: 'settings-save' });
    } finally {
      busy = false;
      btnSaveProfile.disabled = false;
      profileName.disabled = false;
    }
  });

  return {
    el: container,
    load,
  };
}