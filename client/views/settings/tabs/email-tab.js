/**
 * Email Tab Component
 * Email templates panel + admin notifications
 */

import { h } from '../../../lib/dom/index.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { createEmailTemplatesPanel } from '../email-templates/index.js';
import { createAdminNotificationsSection } from '../sections/index.js';
import { getAppName } from '../../../lib/theme/branding.js';
import {
  fetchAppSettings,
  updateAppSettings,
  invalidateSettingsCache,
} from '../../../lib/net/settings.js';

/**
 * Create the email tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createEmailTab({ user }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-email',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-email-btn',
    'data-tab': 'email',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.email', 'Email'),
  });

  const senderCard = h('section', { class: 'stack editor-card' });
  senderCard.append(
    h('h3', {
      class: 'field-label',
      text: t('settings.admin.emailSender.title', 'Email Sender Identity'),
    }),
  );
  senderCard.append(
    h('p', {
      class: 'help',
      text: t(
        'settings.admin.emailSender.hint',
        'From address for system emails. Falls back to environment variables if empty.',
      ),
    }),
  );
  const senderEmail = h('input', {
    type: 'email',
    class: 'form-input',
    maxlength: '255',
    placeholder: 'noreply@example.com',
  });
  const senderName = h('input', {
    type: 'text',
    class: 'form-input',
    maxlength: '128',
    placeholder: getAppName(),
  });
  senderCard.append(
    h('label', { class: 'field-row' }, [
      h('span', {
        class: 'field-row-label',
        text: t('settings.admin.emailSender.email', 'Email'),
      }),
      senderEmail,
    ]),
    h('label', { class: 'field-row' }, [
      h('span', {
        class: 'field-row-label',
        text: t('settings.admin.emailSender.name', 'Name'),
      }),
      senderName,
    ]),
  );
  const senderError = createInlineError({ callout: true });
  const saveSender = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  senderCard.append(
    senderError.el,
    h('div', { class: 'row is-end settings-policy-actions' }, [saveSender]),
  );

  // Admin notifications section
  const notificationsCard = h('div', { class: 'stack editor-card' });
  const adminNotifications = createAdminNotificationsSection();
  notificationsCard.append(...adminNotifications.elements);

  // Save button for notifications
  const notifActions = h('div', {
    class: 'row is-end',
    style: 'margin-top: var(--ps-space-3);',
  });
  const btnSaveNotif = h('button', {
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  notifActions.append(btnSaveNotif);
  // A refused save is a state of this form, so it stays beside Save until the
  // next attempt (docs/reference/feedback-surfaces.md). The settings routes
  // answer about the request as a whole — permission, a malformed body — and
  // name no `details.field`, so there is no control to mark.
  const notifError = createInlineError({ callout: true });
  notificationsCard.append(notifError.el, notifActions);

  let busy = false;
  let loaded = false;
  let emailPanel = null;

  const load = async () => {
    if (loaded) return;
    loaded = true;

    // Load admin notification settings
    try {
      const app = await fetchAppSettings();
      senderEmail.value = app?.emailSender?.email || '';
      senderName.value = app?.emailSender?.name || '';
      const notif =
        app?.notifications && typeof app.notifications === 'object'
          ? app.notifications
          : {};
      adminNotifications.setValue(notif?.emailEnabled === true);
    } catch (e) {
      toast.error(e, { id: 'settings-load' });
    }

    // Render email templates panel (it handles its own data loading)
    emailPanel = createEmailTemplatesPanel({ user });
    container.append(emailPanel);
  };

  btnSaveNotif.addEventListener('click', async () => {
    if (busy) return;
    notifError.clear();
    busy = true;
    btnSaveNotif.disabled = true;
    adminNotifications.setDisabled(true);

    try {
      const emailEnabled = adminNotifications.getValue();
      await updateAppSettings({
        notifications: { emailEnabled },
      });
      invalidateSettingsCache();
      toast.success(t('settings.saved', 'Saved.'), {
        id: 'settings-save',
        durationMs: 1800,
      });
    } catch (e) {
      notifError.show(e.message);
    } finally {
      busy = false;
      btnSaveNotif.disabled = false;
      adminNotifications.setDisabled(false);
    }
  });

  saveSender.addEventListener('click', async () => {
    senderError.clear();
    saveSender.disabled = true;
    senderEmail.disabled = true;
    senderName.disabled = true;
    try {
      await updateAppSettings({
        emailSender: {
          email: senderEmail.value.trim(),
          name: senderName.value.trim(),
        },
      });
      invalidateSettingsCache();
      toast.success(t('settings.saved', 'Saved.'));
    } catch (err) {
      senderError.show(err.message);
    } finally {
      saveSender.disabled = false;
      senderEmail.disabled = false;
      senderName.disabled = false;
    }
  });

  container.append(title, senderCard, notificationsCard);

  return {
    el: container,
    load,
  };
}
