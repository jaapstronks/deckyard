/**
 * User notification preferences section.
 * Allows users to configure how they receive notifications.
 */

import { t } from '../../../lib/ui-i18n.js';

/**
 * Create the user notifications section component.
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function for creating DOM elements
 * @returns {Object} { element, setDisabled, getValues, setValues }
 */
export function createUserNotificationsSection({ h }) {
  const card = h('div', { class: 'stack editor-card' });
  card.append(
    h('div', {
      class: 'field-label',
      text: t('settings.notifications.title', 'Notifications'),
    })
  );

  const hint = h('div', {
    class: 'help',
    text: t(
      'settings.notifications.hint',
      'Choose how you want to be notified about comments on your presentations.'
    ),
  });

  const emailCheckboxInput = h('input', { type: 'checkbox', checked: true });
  const emailCheckbox = h('label', { class: 'row is-wrap', style: 'gap:10px;' }, [
    emailCheckboxInput,
    h('span', {
      text: t('settings.notifications.emailEnabled', 'Email notifications'),
    }),
  ]);

  const slackCheckboxInput = h('input', { type: 'checkbox', checked: true });
  const slackCheckbox = h('label', { class: 'row is-wrap', style: 'gap:10px;' }, [
    slackCheckboxInput,
    h('span', {
      text: t('settings.notifications.slackEnabled', 'Slack / Teams notifications'),
    }),
  ]);

  card.append(hint, emailCheckbox, slackCheckbox);

  return {
    element: card,
    setDisabled: (disabled) => {
      emailCheckboxInput.disabled = disabled;
      slackCheckboxInput.disabled = disabled;
    },
    getValues: () => ({
      emailEnabled: emailCheckboxInput.checked,
      slackEnabled: slackCheckboxInput.checked,
    }),
    setValues: (notifications) => {
      const notif = notifications && typeof notifications === 'object' ? notifications : {};
      // Default to true if not explicitly set to false
      emailCheckboxInput.checked = notif.emailEnabled !== false;
      slackCheckboxInput.checked = notif.slackEnabled !== false;
    },
  };
}