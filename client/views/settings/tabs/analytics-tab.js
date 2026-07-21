/**
 * Analytics Tab Component
 * External analytics providers configuration
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import {
  fetchAppSettings,
  updateAppSettings,
  invalidateSettingsCache,
} from '../../../lib/net/settings.js';

/**
 * Create a provider configuration card.
 * @param {Object} options
 * @param {string} options.key - Provider key (umami, plausible, matomo, googleAnalytics)
 * @param {string} options.title - Provider display name
 * @param {string} options.description - Short description
 * @param {boolean} options.privacyFriendly - Whether it's privacy-friendly
 * @param {string} options.privacyNote - Additional privacy note
 * @param {Array} options.fields - Array of field definitions
 * @param {Array} options.requiredFields - Field keys that are required when enabled
 * @returns {Object} { el, getValues, setValues, setDisabled, validate }
 */
function createProviderCard({ key, title, description, privacyFriendly, privacyNote, fields, requiredFields = [] }) {
  const card = h('div', { class: 'analytics-provider-card' });

  // Header with toggle
  const header = h('div', { class: 'analytics-provider-header' });
  const enabledCheck = h('input', {
    type: 'checkbox',
    id: `provider-${key}-enabled`,
    'aria-describedby': `provider-${key}-desc`,
  });
  const titleEl = h('label', {
    class: 'analytics-provider-title',
    for: `provider-${key}-enabled`,
    text: title,
  });

  // Privacy badge
  if (privacyFriendly) {
    const badge = h('span', {
      class: 'analytics-provider-badge privacy-friendly',
      text: t('settings.analytics.providers.privacyFriendly', 'Privacy-friendly'),
    });
    titleEl.append(badge);
  } else {
    const badge = h('span', {
      class: 'analytics-provider-badge requires-consent',
      text: t('settings.analytics.providers.requiresConsent', 'Requires consent'),
    });
    titleEl.append(badge);
  }

  header.append(enabledCheck, titleEl);

  // Description
  const descEl = h('div', {
    class: 'analytics-provider-description',
    id: `provider-${key}-desc`,
    text: description,
  });

  // Privacy note (if any)
  let privacyNoteEl = null;
  if (privacyNote) {
    privacyNoteEl = h('div', {
      class: 'analytics-provider-privacy-note',
      text: privacyNote,
    });
  }

  // Config section (shown when enabled)
  const configSection = h('div', { class: 'analytics-provider-config' });

  const fieldInputs = {};
  for (const field of fields) {
    const fieldId = `provider-${key}-${field.key}`;
    const fieldRow = h('label', { class: 'field-row' });
    const labelSpan = h('span', {
      class: 'field-row-label',
      text: field.label,
    });

    let input;
    if (field.type === 'checkbox') {
      input = h('input', {
        type: 'checkbox',
        id: fieldId,
        checked: field.defaultValue === true,
      });
      fieldRow.classList.add('is-checkbox');
    } else {
      input = h('input', {
        type: field.type || 'text',
        class: 'input',
        id: fieldId,
        placeholder: field.placeholder || '',
        maxlength: String(field.maxLength || 255),
      });
    }

    fieldInputs[field.key] = input;
    fieldRow.append(labelSpan, input);

    if (field.hint) {
      const hintEl = h('div', { class: 'help', text: field.hint });
      fieldRow.append(hintEl);
    }

    configSection.append(fieldRow);
  }

  // Validation warning element
  const warningEl = h('div', {
    class: 'analytics-provider-warning',
    text: t(
      'settings.analytics.validation.enabledButMissing',
      'Provider is enabled but required fields are missing. It won\'t be active until configured.'
    ),
  });
  warningEl.style.display = 'none';

  // Check if required fields are filled
  const checkRequiredFields = () => {
    if (!enabledCheck.checked || requiredFields.length === 0) {
      warningEl.style.display = 'none';
      return true;
    }
    const hasAllRequired = requiredFields.every((fieldKey) => {
      const input = fieldInputs[fieldKey];
      if (!input) return true;
      return input.value && input.value.trim() !== '';
    });
    warningEl.style.display = hasAllRequired ? 'none' : 'block';
    return hasAllRequired;
  };

  // Update config visibility based on enabled state
  const updateConfigVisibility = () => {
    configSection.style.display = enabledCheck.checked ? 'block' : 'none';
    checkRequiredFields();
  };
  enabledCheck.addEventListener('change', updateConfigVisibility);

  // Add change listeners to required fields
  for (const fieldKey of requiredFields) {
    const input = fieldInputs[fieldKey];
    if (input) {
      input.addEventListener('input', checkRequiredFields);
    }
  }

  card.append(header, descEl);
  if (privacyNoteEl) card.append(privacyNoteEl);
  card.append(configSection, warningEl);

  return {
    el: card,
    getValues: () => {
      const values = { enabled: enabledCheck.checked };
      for (const field of fields) {
        if (field.type === 'checkbox') {
          values[field.key] = fieldInputs[field.key].checked;
        } else {
          values[field.key] = fieldInputs[field.key].value.trim();
        }
      }
      return values;
    },
    setValues: (values) => {
      enabledCheck.checked = values?.enabled === true;
      for (const field of fields) {
        if (field.type === 'checkbox') {
          fieldInputs[field.key].checked = values?.[field.key] === true;
        } else {
          fieldInputs[field.key].value = values?.[field.key] || '';
        }
      }
      updateConfigVisibility();
    },
    setDisabled: (disabled) => {
      enabledCheck.disabled = disabled;
      for (const input of Object.values(fieldInputs)) {
        input.disabled = disabled;
      }
    },
    validate: checkRequiredFields,
  };
}

/**
 * Create the analytics tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createAnalyticsTab({ user }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-analytics',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-analytics-btn',
    'data-tab': 'analytics',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.analytics', 'External Analytics'),
  });

  const description = h('p', {
    class: 'settings-tab-description',
    text: t(
      'settings.analytics.description',
      'External analytics complement built-in insights by tracking cross-site visitor journeys. Choose privacy-friendly providers that respect your visitors.'
    ),
  });

  // Info note about env vars
  const envNote = h('div', { class: 'settings-info-note' });
  envNote.append(
    h('span', {
      class: 'settings-info-note-icon',
      text: '\u2139\uFE0F', // i emoji
    }),
    h('span', {
      text: t(
        'settings.analytics.envVarsNote',
        'Analytics can also be configured via environment variables. Settings configured here will override environment variables.'
      ),
    })
  );

  // Privacy-friendly section
  const privacySection = h('div', { class: 'analytics-section' });
  const privacySectionTitle = h('h3', {
    class: 'analytics-section-title privacy-friendly',
    text: t('settings.analytics.privacyFriendlySection', 'Privacy-Friendly Providers'),
  });
  const privacySectionDesc = h('p', {
    class: 'analytics-section-description',
    text: t(
      'settings.analytics.privacyFriendlyDesc',
      'These providers are designed with privacy in mind. They typically do not use cookies and are GDPR-compliant by default.'
    ),
  });
  privacySection.append(privacySectionTitle, privacySectionDesc);

  // Umami provider
  const umamiCard = createProviderCard({
    key: 'umami',
    title: 'Umami',
    description: t(
      'settings.analytics.providers.umami.description',
      'Cookie-free, GDPR compliant, open-source analytics. Can be self-hosted.'
    ),
    privacyFriendly: true,
    requiredFields: ['websiteId'],
    fields: [
      {
        key: 'websiteId',
        label: t('settings.analytics.providers.umami.websiteId', 'Website ID'),
        placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        hint: t('settings.analytics.providers.umami.websiteIdHint', 'Found in your Umami dashboard under Settings > Websites'),
        maxLength: 64,
      },
      {
        key: 'url',
        label: t('settings.analytics.providers.umami.url', 'Server URL'),
        placeholder: 'https://cloud.umami.is',
        hint: t('settings.analytics.providers.umami.urlHint', 'Leave empty for Umami Cloud, or enter your self-hosted URL'),
        maxLength: 255,
      },
    ],
  });

  // Plausible provider
  const plausibleCard = createProviderCard({
    key: 'plausible',
    title: 'Plausible',
    description: t(
      'settings.analytics.providers.plausible.description',
      'Lightweight, cookie-free analytics. EU-hosted cloud option available.'
    ),
    privacyFriendly: true,
    requiredFields: ['domain'],
    fields: [
      {
        key: 'domain',
        label: t('settings.analytics.providers.plausible.domain', 'Domain'),
        placeholder: 'example.com',
        hint: t('settings.analytics.providers.plausible.domainHint', 'The domain you want to track'),
        maxLength: 255,
      },
      {
        key: 'url',
        label: t('settings.analytics.providers.plausible.url', 'Server URL'),
        placeholder: 'https://plausible.io',
        hint: t('settings.analytics.providers.plausible.urlHint', 'Leave empty for Plausible Cloud, or enter your self-hosted URL'),
        maxLength: 255,
      },
    ],
  });

  // Matomo provider
  const matomoCard = createProviderCard({
    key: 'matomo',
    title: 'Matomo',
    description: t(
      'settings.analytics.providers.matomo.description',
      'Full-featured, self-hostable analytics with cookie-free tracking mode.'
    ),
    privacyFriendly: true,
    requiredFields: ['url', 'siteId'],
    fields: [
      {
        key: 'url',
        label: t('settings.analytics.providers.matomo.url', 'Matomo URL'),
        placeholder: 'https://analytics.example.com',
        hint: t('settings.analytics.providers.matomo.urlHint', 'Your Matomo server URL'),
        maxLength: 255,
      },
      {
        key: 'siteId',
        label: t('settings.analytics.providers.matomo.siteId', 'Site ID'),
        placeholder: '1',
        hint: t('settings.analytics.providers.matomo.siteIdHint', 'Found in Matomo under Settings > Websites > Manage'),
        maxLength: 32,
      },
      {
        key: 'disableCookies',
        label: t('settings.analytics.providers.matomo.disableCookies', 'Disable cookies (recommended)'),
        type: 'checkbox',
        defaultValue: true,
        hint: t('settings.analytics.providers.matomo.disableCookiesHint', 'Track without setting any cookies'),
      },
      {
        key: 'requireConsent',
        label: t('settings.analytics.providers.matomo.requireConsent', 'Require consent'),
        type: 'checkbox',
        defaultValue: false,
        hint: t('settings.analytics.providers.matomo.requireConsentHint', 'Wait for explicit user consent before tracking'),
      },
    ],
  });

  privacySection.append(umamiCard.el, plausibleCard.el, matomoCard.el);

  // Requires consent section
  const consentSection = h('div', { class: 'analytics-section' });
  const consentSectionTitle = h('h3', {
    class: 'analytics-section-title requires-consent',
    text: t('settings.analytics.requiresConsentSection', 'Requires Consent'),
  });
  const consentSectionDesc = h('p', {
    class: 'analytics-section-description',
    text: t(
      'settings.analytics.requiresConsentDesc',
      'These providers set cookies and require a consent banner under GDPR/ePrivacy. Consider privacy-friendly alternatives above.'
    ),
  });
  consentSection.append(consentSectionTitle, consentSectionDesc);

  // Google Analytics 4 provider
  const ga4Card = createProviderCard({
    key: 'googleAnalytics',
    title: 'Google Analytics 4',
    description: t(
      'settings.analytics.providers.googleAnalytics.description',
      'Google\'s analytics platform. Widely used but sets cookies.'
    ),
    privacyFriendly: false,
    requiredFields: ['measurementId'],
    privacyNote: t(
      'settings.analytics.providers.googleAnalytics.privacyNote',
      'Google Analytics sets cookies and shares data with Google. You should display a cookie consent banner and update your privacy policy when using this provider.'
    ),
    fields: [
      {
        key: 'measurementId',
        label: t('settings.analytics.providers.googleAnalytics.measurementId', 'Measurement ID'),
        placeholder: 'G-XXXXXXXXXX',
        hint: t('settings.analytics.providers.googleAnalytics.measurementIdHint', 'Found in GA4 > Admin > Data Streams > your stream'),
        maxLength: 32,
      },
    ],
  });

  consentSection.append(ga4Card.el);

  // Save button
  const actions = h('div', { class: 'row is-end', style: 'margin-top: var(--ps-space-4);' });
  const btnSave = h('button', {
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  actions.append(btnSave);

  const cards = h('div', { class: 'settings-admin-cards' }, [
    envNote,
    privacySection,
    consentSection,
  ]);

  container.append(title, description, cards, actions);

  let busy = false;
  let loaded = false;

  const providerCards = {
    umami: umamiCard,
    plausible: plausibleCard,
    matomo: matomoCard,
    googleAnalytics: ga4Card,
  };

  const setBusy = (v) => {
    busy = v;
    btnSave.disabled = busy;
    for (const card of Object.values(providerCards)) {
      card.setDisabled(busy);
    }
  };

  const load = async () => {
    if (loaded) return;

    try {
      const app = await fetchAppSettings();
      const providers = app?.analytics?.externalProviders || {};

      for (const [key, card] of Object.entries(providerCards)) {
        card.setValues(providers[key] || {});
      }
      // Only mark as loaded after successful fetch
      loaded = true;
    } catch (e) {
      toast.error(String(e?.message || e), { id: 'settings-load' });
    }
  };

  btnSave.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);

    try {
      // Gather all provider values
      const externalProviders = {};
      for (const [key, card] of Object.entries(providerCards)) {
        externalProviders[key] = card.getValues();
      }

      // Get current analytics settings and merge with new providers
      const app = await fetchAppSettings();
      const currentAnalytics = app?.analytics || {};

      await updateAppSettings({
        analytics: {
          ...currentAnalytics,
          externalProviders,
        },
      });

      invalidateSettingsCache();
      toast.success(t('settings.saved', 'Saved.'), {
        id: 'settings-save',
        durationMs: 1800,
      });
    } catch (e) {
      toast.error(String(e?.message || e), { id: 'settings-save' });
    } finally {
      setBusy(false);
    }
  });

  return {
    el: container,
    load,
  };
}
