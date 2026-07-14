/**
 * Admin webhooks configuration section.
 * Allows admins to configure webhook URLs for various events.
 */

import { t } from '../../../lib/ui-i18n.js';

/**
 * Webhook configuration definition.
 */
const WEBHOOK_CONFIGS = [
  {
    key: 'movedToWorkspace',
    settingsKey: 'presentationMovedToWorkspaceUrl',
    titleKey: 'settings.admin.webhooks.movedToWorkspace.title',
    titleDefault: 'When a presentation is shared to the workspace',
    hintKey: 'settings.admin.webhooks.movedToWorkspace.hint',
    hintDefault: 'Event: presentation.moved_to_workspace',
  },
  {
    key: 'slideAddedToTeamLibrary',
    settingsKey: 'slideAddedToTeamLibraryUrl',
    titleKey: 'settings.admin.webhooks.slideAddedToTeamLibrary.title',
    titleDefault: 'When a slide is added to the team library',
    hintKey: 'settings.admin.webhooks.slideAddedToTeamLibrary.hint',
    hintDefault: 'Event: slide.added_to_team_library',
  },
  {
    key: 'published',
    settingsKey: 'presentationPublishedUrl',
    titleKey: 'settings.admin.webhooks.published.title',
    titleDefault: 'When a presentation is published',
    hintKey: 'settings.admin.webhooks.published.hint',
    hintDefault: 'Event: presentation.published',
  },
  {
    key: 'commentCreated',
    settingsKey: 'commentCreatedUrl',
    titleKey: 'settings.admin.webhooks.commentCreated.title',
    titleDefault: 'When a comment is posted',
    hintKey: 'settings.admin.webhooks.commentCreated.hint',
    hintDefault: 'Event: comment.created',
  },
  {
    key: 'pollClosed',
    settingsKey: 'interactionPollClosedUrl',
    titleKey: 'settings.admin.webhooks.pollClosed.title',
    titleDefault: 'When a poll is closed',
    hintKey: 'settings.admin.webhooks.pollClosed.hint',
    hintDefault: 'Event: interaction.poll_closed',
  },
  {
    key: 'likertClosed',
    settingsKey: 'interactionLikertClosedUrl',
    titleKey: 'settings.admin.webhooks.likertClosed.title',
    titleDefault: 'When a Likert scale is closed',
    hintKey: 'settings.admin.webhooks.likertClosed.hint',
    hintDefault: 'Event: interaction.likert_closed',
  },
  {
    key: 'feedbackSubmitted',
    settingsKey: 'interactionFeedbackSubmittedUrl',
    titleKey: 'settings.admin.webhooks.feedbackSubmitted.title',
    titleDefault: 'When feedback is submitted',
    hintKey: 'settings.admin.webhooks.feedbackSubmitted.hint',
    hintDefault: 'Event: interaction.feedback_submitted',
  },
];

/**
 * Create the admin webhooks section component.
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function for creating DOM elements
 * @returns {Object} { elements, inputs, setDisabled, getValues, setValues }
 */
export function createAdminWebhooksSection({ h }) {
  const elements = [];
  const inputs = {};

  // Title and hint
  const title = h('div', {
    class: 'field-label',
    style: 'margin-top:10px;',
    text: t('settings.admin.webhooks.title', 'Admin: webhooks'),
  });

  const hint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.webhooks.hint',
      'Configure webhook URLs to receive POSTed JSON payloads when certain events happen.'
    ),
  });

  elements.push(title, hint);

  // Create input fields for each webhook
  for (const config of WEBHOOK_CONFIGS) {
    const label = h('div', {
      class: 'field-label',
      text: t(config.titleKey, config.titleDefault),
    });

    const input = h('input', {
      class: 'form-input',
      placeholder: 'https://…',
      value: '',
    });

    const inputHint = h('div', {
      class: 'help',
      text: t(config.hintKey, config.hintDefault),
    });

    inputs[config.key] = input;
    elements.push(label, input, inputHint);
  }

  return {
    elements,
    inputs,
    setDisabled: (disabled) => {
      for (const input of Object.values(inputs)) {
        input.disabled = disabled;
      }
    },
    getValues: () => {
      const values = {};
      for (const config of WEBHOOK_CONFIGS) {
        values[config.settingsKey] = String(inputs[config.key].value || '').trim();
      }
      return values;
    },
    setValues: (webhooks) => {
      const wh = webhooks && typeof webhooks === 'object' ? webhooks : {};
      for (const config of WEBHOOK_CONFIGS) {
        inputs[config.key].value = String(wh[config.settingsKey] || '');
      }
    },
  };
}