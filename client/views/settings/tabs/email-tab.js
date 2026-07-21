/**
 * Email Tab Component
 * Email templates panel + admin notifications
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { createEmailTemplatesPanel } from '../email-templates-panel.js';
import { createAdminNotificationsSection } from '../sections/index.js';
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

  // Admin notifications section
  const notificationsCard = h('div', { class: 'stack editor-card' });
  const adminNotifications = createAdminNotificationsSection({ h });
  notificationsCard.append(...adminNotifications.elements);

  // Save button for notifications
  const notifActions = h('div', { class: 'row is-end', style: 'margin-top: var(--ps-space-3);' });
  const btnSaveNotif = h('button', {
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  notifActions.append(btnSaveNotif);
  notificationsCard.append(notifActions);

  let busy = false;
  let loaded = false;
  let emailPanel = null;

  const load = async () => {
    if (loaded) return;
    loaded = true;

    // Load admin notification settings
    try {
      const app = await fetchAppSettings();
      const notif = app?.notifications && typeof app.notifications === 'object'
        ? app.notifications
        : {};
      adminNotifications.setValue(notif?.emailEnabled === true);
    } catch (e) {
      toast.error(String(e?.message || e), { id: 'settings-load' });
    }

    // Render email templates panel (it handles its own data loading)
    emailPanel = createEmailTemplatesPanel({ user });
    container.append(emailPanel);
  };

  btnSaveNotif.addEventListener('click', async () => {
    if (busy) return;
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
      toast.error(String(e?.message || e), { id: 'settings-save' });
    } finally {
      busy = false;
      btnSaveNotif.disabled = false;
      adminNotifications.setDisabled(false);
    }
  });

  container.append(title, notificationsCard);

  return {
    el: container,
    load,
  };
}