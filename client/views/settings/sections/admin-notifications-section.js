/**
 * Admin email notifications configuration section.
 * Allows admins to enable/disable email notifications for comments.
 */

import { t } from '../../../lib/ui-i18n.js';

/**
 * Create the admin notifications section component.
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function for creating DOM elements
 * @returns {Object} { elements, checkbox, setDisabled, getValue, setValue }
 */
export function createAdminNotificationsSection({ h }) {
  const elements = [];

  const title = h('div', {
    class: 'field-label',
    style: 'margin-top:10px;',
    text: t('settings.admin.notifications.title', 'Admin: email notifications'),
  });

  const hint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.notifications.hint',
      'Configure email notifications for comments. Requires BREVO_API_KEY and BREVO_SENDER_EMAIL environment variables.'
    ),
  });

  const checkboxInput = h('input', { type: 'checkbox' });
  const checkbox = h('label', { class: 'row is-wrap', style: 'gap:10px;' }, [
    checkboxInput,
    h('span', {
      text: t(
        'settings.admin.notifications.emailEnabled',
        'Send email notifications for comments'
      ),
    }),
  ]);

  elements.push(title, hint, checkbox);

  return {
    elements,
    checkbox,
    setDisabled: (disabled) => {
      checkboxInput.disabled = disabled;
    },
    getValue: () => checkboxInput.checked,
    setValue: (enabled) => {
      checkboxInput.checked = enabled === true;
    },
  };
}