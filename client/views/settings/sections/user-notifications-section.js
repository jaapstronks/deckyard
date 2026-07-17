/**
 * User notification preferences section.
 * Allows users to configure how they receive notifications: channel master
 * switches (email / Slack), the default subscription level for decks
 * without a per-deck override, and email per comment-event type.
 */

import { t } from '../../../lib/ui-i18n.js';

const LEVEL_OPTIONS = [
  { value: 'watching', label: () => t('subscription.level.watching', 'Watching') },
  { value: 'participating', label: () => t('subscription.level.participating', 'Participating') },
  { value: 'mentions_only', label: () => t('subscription.level.mentionsOnly', 'Mentions only') },
  { value: 'mute', label: () => t('subscription.level.mute', 'Mute') },
];

const EMAIL_TYPES = [
  { key: 'comment_created', label: () => t('settings.notifications.emailCommentCreated', 'New comments') },
  { key: 'comment_reply', label: () => t('settings.notifications.emailCommentReply', 'Replies to your comments') },
  { key: 'comment_mention', label: () => t('settings.notifications.emailCommentMention', 'Mentions') },
];

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

  // Default subscription level (per-deck overrides win; see the deck's
  // more-menu → Deck notifications)
  const levelSelect = h('select', { class: 'form-input' });
  for (const opt of LEVEL_OPTIONS) {
    levelSelect.append(h('option', { value: opt.value, text: opt.label() }));
  }
  levelSelect.value = 'participating';
  const levelField = h('label', { class: 'stack', style: 'gap:4px;' }, [
    h('span', {
      class: 'field-label',
      text: t('settings.notifications.defaultLevel', 'Default level per deck'),
    }),
    levelSelect,
    h('span', {
      class: 'help',
      text: t(
        'settings.notifications.defaultLevel.help',
        'Applies to decks without their own setting. Direct @mentions always come through.'
      ),
    }),
  ]);

  // Email per comment-event type (gates the email channel only; the bell
  // always follows the subscription level)
  const emailTypeInputs = new Map();
  const emailTypeRows = EMAIL_TYPES.map(({ key, label }) => {
    const input = h('input', { type: 'checkbox', checked: true });
    emailTypeInputs.set(key, input);
    return h('label', { class: 'row is-wrap', style: 'gap:10px;' }, [
      input,
      h('span', { text: label() }),
    ]);
  });
  const emailTypesField = h('div', { class: 'stack', style: 'gap:6px;' }, [
    h('span', {
      class: 'field-label',
      text: t('settings.notifications.emailByType', 'Email me about'),
    }),
    ...emailTypeRows,
  ]);

  card.append(hint, emailCheckbox, slackCheckbox, levelField, emailTypesField);

  return {
    element: card,
    setDisabled: (disabled) => {
      emailCheckboxInput.disabled = disabled;
      slackCheckboxInput.disabled = disabled;
      levelSelect.disabled = disabled;
      for (const input of emailTypeInputs.values()) input.disabled = disabled;
    },
    getValues: () => ({
      emailEnabled: emailCheckboxInput.checked,
      slackEnabled: slackCheckboxInput.checked,
      defaultLevel: levelSelect.value,
      emailByType: Object.fromEntries(
        [...emailTypeInputs.entries()].map(([key, input]) => [key, input.checked])
      ),
    }),
    setValues: (notifications) => {
      const notif = notifications && typeof notifications === 'object' ? notifications : {};
      // Default to true if not explicitly set to false
      emailCheckboxInput.checked = notif.emailEnabled !== false;
      slackCheckboxInput.checked = notif.slackEnabled !== false;
      levelSelect.value = LEVEL_OPTIONS.some((o) => o.value === notif.defaultLevel)
        ? notif.defaultLevel
        : 'participating';
      const byType = notif.emailByType && typeof notif.emailByType === 'object' ? notif.emailByType : {};
      for (const [key, input] of emailTypeInputs) {
        input.checked = byType[key] !== false;
      }
    },
  };
}
