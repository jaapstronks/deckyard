import { toast } from '../../lib/toast.js';
import { api } from '../../lib/api.js';
import {
  defaultLang,
  getSupportedLangs,
  readLangMode,
  setSupportedLangs,
  writeLangMode,
} from '../../lib/i18n.js';
import {
  fetchUiLocaleManifest,
  getUiLocale,
  setUiLocale,
  t,
} from '../../lib/ui-i18n.js';
import {
  fetchAppSettings,
  fetchMySettings,
  invalidateSettingsCache,
  updateAppSettings,
  updateMySettings,
} from '../../lib/settings.js';
import { getLangShortLabel, getLangDisplayName } from '../../lib/lang-selector.js';
import { renderAdminUsersPanel } from './admin-users-panel.js';
import { createEmailTemplatesPanel } from './email-templates-panel.js';
import {
  createPasswordSection,
  createAdminWebhooksSection,
  createAdminNotificationsSection,
  createUserNotificationsSection,
} from './sections/index.js';
import { createAvatar, updateAvatar } from '../../lib/avatar.js';
import { invalidateProfile } from '../../lib/user-profiles.js';

export async function createSettingsPanel({
  h,
  user,
  hideTitle = false,
  onDone,
} = {}) {
  const title = h('h2', { text: t('settings.title', 'Settings') });
  const help = h('div', {
    class: 'help',
    text: t(
      'settings.help',
      'Profile and UI language are stored per user. Slide language support is managed centrally (admin).'
    ),
  });

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

  const uiLocaleCard = h('div', { class: 'stack editor-card' });
  uiLocaleCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.uiLocale.title', 'Application language'),
    })
  );
  const uiLocaleSelect = h('select', { class: 'form-input settings-compact-control' });
  const uiLocaleHint = h('div', {
    class: 'help',
    text: t(
      'settings.uiLocale.hint',
      "The language of this application's interface, unrelated to the language used in slides."
    ),
  });
  uiLocaleCard.append(uiLocaleSelect, uiLocaleHint);

  const langCard = h('div', { class: 'stack editor-card' });
  langCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.slideLangMode.title', 'Slides language mode'),
    })
  );
  let langMode = readLangMode();
  let langControlEl = null;
  let langButtons = {};
  let useDropdownForLang = false;

  // Create language selector (will be rebuilt when supported langs are loaded)
  const langControlWrap = h('div', {
    title: t(
      'settings.slideLangMode.titleHint',
      'Language mode (default for new presentations and AI)'
    ),
  });

  const syncLangUi = () => {
    if (useDropdownForLang && langControlEl?.tagName === 'SELECT') {
      langControlEl.value = langMode;
    } else {
      for (const [code, btn] of Object.entries(langButtons)) {
        btn.classList.toggle('is-active', langMode === code);
        btn.setAttribute('aria-pressed', langMode === code ? 'true' : 'false');
      }
    }
  };

  const buildLangControl = (supportedList) => {
    langControlWrap.innerHTML = '';
    langButtons = {};
    const langs = Array.isArray(supportedList) && supportedList.length > 0
      ? supportedList
      : ['nl', 'en-GB'];

    useDropdownForLang = langs.length > 2;

    if (langs.length < 2) {
      langControlWrap.style.display = 'none';
      return;
    }
    langControlWrap.style.display = '';

    if (useDropdownForLang) {
      langControlEl = h('select', { class: 'form-input' });
      for (const code of langs) {
        const option = h('option', {
          value: code,
          text: getLangDisplayName(code),
        });
        langControlEl.append(option);
      }
      langControlEl.value = langMode;
      langControlEl.addEventListener('change', () => {
        langMode = langControlEl.value;
        syncLangUi();
      });
      langControlWrap.append(langControlEl);
    } else {
      const langSeg = h('div', { class: 'sb-segmented is-toggle' });
      for (const code of langs) {
        const btn = h('button', {
          class: 'sb-segmented-btn',
          type: 'button',
          text: getLangShortLabel(code),
          onclick: () => {
            langMode = code;
            syncLangUi();
          },
        });
        langButtons[code] = btn;
        langSeg.append(btn);
      }
      langControlEl = langSeg;
      langControlWrap.append(langSeg);
    }
    syncLangUi();
  };

  // Initialize with default langs
  buildLangControl(getSupportedLangs());

  const langHint = h('div', {
    class: 'help',
    text: t(
      'settings.slideLangMode.hint',
      'Used for the editor\'s "language mode", AI output, and slide translation tools.'
    ),
  });
  langCard.append(langControlWrap, langHint);

  // User notification preferences (using extracted component)
  const userNotifications = createUserNotificationsSection({ h });
  const notifCard = userNotifications.element;

  // Change password card (using extracted component)
  const passwordSection = createPasswordSection({ h });
  const passwordCard = passwordSection.element;

  const adminCard = h('div', {
    class: 'stack editor-card',
    style: user?.isAdmin ? '' : 'display:none;',
  });
  adminCard.append(
    h('div', {
      class: 'field-label',
      text: t(
        'settings.admin.supportedSlideLangs.title',
        'Admin: supported slide languages'
      ),
    })
  );
  const adminHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.supportedSlideLangs.hint',
      'This controls which languages are visible/usable in language mode and translation.'
    ),
  });
  const adminRow = h('div', { class: 'row is-wrap' });
  const chkNl = h('label', { class: 'row is-wrap', style: 'gap:10px;' }, [
    h('input', { type: 'checkbox' }),
    h('span', { text: t('settings.langMode.nl', 'NL') }),
  ]);
  const chkEn = h('label', { class: 'row is-wrap', style: 'gap:10px;' }, [
    h('input', { type: 'checkbox' }),
    h('span', { text: 'EN (UK)' }),
  ]);
  adminRow.append(chkNl, chkEn);
  adminCard.append(adminHint, adminRow);

  // Admin: webhooks (using extracted component)
  const adminWebhooks = createAdminWebhooksSection({ h });
  adminCard.append(...adminWebhooks.elements);

  // Admin: notifications (using extracted component)
  const adminNotifications = createAdminNotificationsSection({ h });
  adminCard.append(...adminNotifications.elements);

  const actions = h('div', { class: 'row is-end is-mt-8' });
  const btnSave = h('button', {
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  actions.append(btnSave);

  // Admin users panel (only visible to admins)
  const adminUsersCard = renderAdminUsersPanel({ user });

  // Admin email templates panel (only visible to admins)
  const emailTemplatesCard = createEmailTemplatesPanel({ user });

  const cards = h('div', { class: 'settings-cards' }, [
    profileCard,
    uiLocaleCard,
    langCard,
    notifCard,
    passwordCard,
    adminCard,
    emailTemplatesCard,
    adminUsersCard,
  ]);

  const el = h('div', { class: 'settings-panel-content' });
  if (!hideTitle) el.append(title);
  el.append(help, cards, actions);

  const applySupportedUi = (supportedList) => {
    const supported = new Set(Array.isArray(supportedList) ? supportedList : []);
    const supportedArr = Array.isArray(supportedList) ? supportedList : [];

    // Ensure langMode is valid for the supported set
    if (!supported.has(langMode)) {
      langMode = supportedArr[0] || defaultLang();
    }

    // Rebuild the language control with the new supported languages
    buildLangControl(supportedArr);
  };

  // Load current settings
  let busy = false;
  const setBusy = (v) => {
    busy = v;
    btnSave.disabled = busy;
    profileName.disabled = busy;
    uiLocaleSelect.disabled = busy;
    // Disable language control
    if (useDropdownForLang && langControlEl?.tagName === 'SELECT') {
      langControlEl.disabled = busy;
    } else {
      for (const btn of Object.values(langButtons)) {
        btn.disabled = busy;
      }
    }
    // User notification preferences
    userNotifications.setDisabled(busy);
    if (user?.isAdmin) {
      chkNl.querySelector('input').disabled = busy;
      chkEn.querySelector('input').disabled = busy;
      adminWebhooks.setDisabled(busy);
      adminNotifications.setDisabled(busy);
    }
  };

  try {
    const [my, app] = await Promise.all([fetchMySettings(), fetchAppSettings()]);
    profileName.value = String(my?.profile?.name || '');

    // Load profile image
    const savedImageUrl = String(my?.profile?.imageUrl || '').trim();
    if (savedImageUrl) {
      currentImageUrl = savedImageUrl;
      updateAvatar(avatarEl, { imageUrl: savedImageUrl, name: my?.profile?.name || user?.name });
      removeBtn.style.display = '';
    }
    if (typeof my?.uiLang === 'string') langMode = my.uiLang;
    const myUiLocale =
      typeof my?.uiLocale === 'string' ? my.uiLocale : getUiLocale();

    const supportedSlideLangs = Array.isArray(app?.supportedSlideLangs)
      ? app.supportedSlideLangs
      : getSupportedLangs();
    applySupportedUi(supportedSlideLangs);

    // User notification preferences (default to true if not set)
    const myNotif = my?.notifications && typeof my.notifications === 'object'
      ? my.notifications
      : {};
    userNotifications.setValues(myNotif);

    if (user?.isAdmin) {
      chkNl.querySelector('input').checked = supportedSlideLangs.includes('nl');
      chkEn.querySelector('input').checked =
        supportedSlideLangs.includes('en-GB');
      adminWebhooks.setValues(app?.webhooks);
      const notif = app?.notifications && typeof app.notifications === 'object'
        ? app.notifications
        : {};
      adminNotifications.setValue(notif?.emailEnabled === true);
    }

    // UI locale selector options
    const manifest = await fetchUiLocaleManifest();
    const locales = Array.isArray(manifest?.locales) ? manifest.locales : [];
    uiLocaleSelect.innerHTML = '';
    if (!locales.length) {
      uiLocaleSelect.append(
        h('option', { value: 'en', text: 'English', selected: myUiLocale === 'en' }),
        h('option', { value: 'nl', text: 'Nederlands', selected: myUiLocale === 'nl' })
      );
    } else {
      for (const l of locales) {
        const id = String(l?.id || '').trim();
        const label = String(l?.label || '').trim();
        if (!id || !label) continue;
        const isSelected = id === myUiLocale;
        uiLocaleSelect.append(h('option', { value: id, text: label, selected: isSelected }));
      }
    }
    // Also set via property for browser compatibility
    uiLocaleSelect.value = String(myUiLocale || 'en');
  } catch (e) {
    toast.error(String(e?.message || e), { id: 'settings-load' });
  }

  btnSave.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Admin (optional)
      if (user?.isAdmin) {
        const nextSupported = [];
        if (chkNl.querySelector('input').checked) nextSupported.push('nl');
        if (chkEn.querySelector('input').checked) nextSupported.push('en-GB');
        const webhookValues = adminWebhooks.getValues();
        const emailEnabled = adminNotifications.getValue();
        const updatedApp = await updateAppSettings({
          supportedSlideLangs: nextSupported,
          webhooks: webhookValues,
          notifications: {
            emailEnabled,
          },
        });
        const supportedSlideLangs = Array.isArray(updatedApp?.supportedSlideLangs)
          ? updatedApp.supportedSlideLangs
          : null;
        if (supportedSlideLangs) {
          setSupportedLangs(supportedSlideLangs);
          applySupportedUi(supportedSlideLangs);
        }
      }

      // User settings
      const name = String(profileName.value || '').trim();
      // Use selectedOptions for more reliable value reading across browsers
      const selectedOption = uiLocaleSelect.selectedOptions?.[0];
      const uiLocale = String(selectedOption?.value || uiLocaleSelect.value || '').trim() || 'en';
      const userNotifValues = userNotifications.getValues();
      const updatedMe = await updateMySettings({
        profile: { name },
        uiLocale,
        uiLang: langMode,
        notifications: userNotifValues,
      });

      // Keep local language mode in sync with saved settings (and supported set).
      if (typeof updatedMe?.uiLang === 'string') writeLangMode(updatedMe.uiLang);
      else writeLangMode(defaultLang());

      invalidateSettingsCache();
      toast.success(t('settings.saved', 'Saved.'), {
        id: 'settings-save',
        durationMs: 1800,
      });

      // Apply locale immediately - use the saved value from server or fallback to what user selected
      const finalLocale = typeof updatedMe?.uiLocale === 'string' ? updatedMe.uiLocale : uiLocale;
      await setUiLocale(finalLocale);

      onDone?.();
    } catch (e) {
      toast.error(String(e?.message || e), { id: 'settings-save' });
    } finally {
      setBusy(false);
    }
  });

  syncLangUi();

  return {
    el,
    focusEl: profileName,
    canClose: () => !busy,
  };
}
