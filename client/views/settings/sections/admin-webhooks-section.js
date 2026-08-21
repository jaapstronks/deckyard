/**
 * Admin webhooks configuration section.
 * Allows admins to configure webhook URLs for various events.
 */

import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom.js';

/**
 * Webhook configuration definition.
 */
const WEBHOOK_CONFIGS = [
  {
    key: 'movedToOrganization',
    settingsKey: 'presentationMovedToOrganizationUrl',
    titleKey: 'settings.admin.webhooks.movedToOrganization.title',
    title: 'When a presentation is shared to the workspace',
    hintKey: 'settings.admin.webhooks.movedToOrganization.hint',
    hint: 'Event: presentation.moved_to_organization',
  },
  {
    key: 'slideAddedToOrganizationLibrary',
    settingsKey: 'slideAddedToOrganizationLibraryUrl',
    titleKey: 'settings.admin.webhooks.slideAddedToOrganizationLibrary.title',
    title: 'When a slide is added to the team library',
    hintKey: 'settings.admin.webhooks.slideAddedToOrganizationLibrary.hint',
    hint: 'Event: slide.added_to_organization_library',
  },
  {
    key: 'published',
    settingsKey: 'presentationPublishedUrl',
    titleKey: 'settings.admin.webhooks.published.title',
    title: 'When a presentation is published',
    hintKey: 'settings.admin.webhooks.published.hint',
    hint: 'Event: presentation.published',
  },
  {
    key: 'commentCreated',
    settingsKey: 'commentCreatedUrl',
    titleKey: 'settings.admin.webhooks.commentCreated.title',
    title: 'When a comment is posted',
    hintKey: 'settings.admin.webhooks.commentCreated.hint',
    hint: 'Event: comment.created',
  },
  {
    key: 'pollClosed',
    settingsKey: 'interactionPollClosedUrl',
    titleKey: 'settings.admin.webhooks.pollClosed.title',
    title: 'When a poll is closed',
    hintKey: 'settings.admin.webhooks.pollClosed.hint',
    hint: 'Event: interaction.poll_closed',
  },
  {
    key: 'likertClosed',
    settingsKey: 'interactionLikertClosedUrl',
    titleKey: 'settings.admin.webhooks.likertClosed.title',
    title: 'When a Likert scale is closed',
    hintKey: 'settings.admin.webhooks.likertClosed.hint',
    hint: 'Event: interaction.likert_closed',
  },
  {
    key: 'feedbackSubmitted',
    settingsKey: 'interactionFeedbackSubmittedUrl',
    titleKey: 'settings.admin.webhooks.feedbackSubmitted.title',
    title: 'When feedback is submitted',
    hintKey: 'settings.admin.webhooks.feedbackSubmitted.hint',
    hint: 'Event: interaction.feedback_submitted',
  },
  {
    key: 'leadSubmitted',
    settingsKey: 'leadSubmittedUrl',
    titleKey: 'settings.admin.webhooks.leadSubmitted.title',
    title: 'When a lead is submitted',
    hintKey: 'settings.admin.webhooks.leadSubmitted.hint',
    hint: 'Event: lead.submitted',
  },
];

/**
 * Create the admin webhooks section component.
 * @param {Object} options
 * @returns {Object} { elements, inputs, setDisabled, getValues, setValues }
 */
export function createAdminWebhooksSection() {
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
      'Configure webhook URLs to receive POSTed JSON payloads when certain events happen.',
    ),
  });

  elements.push(title, hint);

  // Create input fields for each webhook
  for (const config of WEBHOOK_CONFIGS) {
    const label = h('div', {
      class: 'field-label',
      text: t(config.titleKey, config.title),
    });

    const input = h('input', {
      class: 'form-input',
      placeholder: 'https://…',
      value: '',
    });

    const inputHint = h('div', {
      class: 'help',
      text: t(config.hintKey, config.hint),
    });

    inputs[config.key] = input;
    elements.push(label, input, inputHint);
  }

  // Optional HMAC signing secret. Not per-event: one secret signs every
  // delivery, sent in the `x-sb-signature` header (B81). A password field so
  // the value is not shoulder-surfed in the admin UI.
  const secretLabel = h('div', {
    class: 'field-label',
    style: 'margin-top:10px;',
    text: t(
      'settings.admin.webhooks.signingSecret.title',
      'Signing secret (optional)',
    ),
  });

  const secretInput = h('input', {
    class: 'form-input',
    type: 'password',
    autocomplete: 'off',
    placeholder: '',
    value: '',
  });

  const secretHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.webhooks.signingSecret.hint',
      'When set, each delivery is signed with HMAC-SHA256 over the request body and the signature is sent in the x-sb-signature header as sha256=<hex>. Leave empty to send unsigned.',
    ),
  });

  inputs.signingSecret = secretInput;
  elements.push(secretLabel, secretInput, secretHint);

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
        values[config.settingsKey] = String(
          inputs[config.key].value || '',
        ).trim();
      }
      values.signingSecret = String(inputs.signingSecret.value || '').trim();
      return values;
    },
    setValues: (webhooks) => {
      const wh = webhooks && typeof webhooks === 'object' ? webhooks : {};
      for (const config of WEBHOOK_CONFIGS) {
        inputs[config.key].value = String(wh[config.settingsKey] || '');
      }
      inputs.signingSecret.value = String(wh.signingSecret || '');
    },
  };
}
