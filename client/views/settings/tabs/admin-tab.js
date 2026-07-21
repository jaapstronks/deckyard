/**
 * Admin Tab Component
 * General admin settings: supported languages, themes, AI identity, email sender, session, etc.
 */

import { h } from '../../../lib/dom.js';
import { getAppName } from '../../../lib/theme/branding.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import {
  fetchAppSettings,
  updateAppSettings,
  invalidateSettingsCache,
} from '../../../lib/net/settings.js';
import { getSupportedLangs, setSupportedLangs } from '../../../lib/format/i18n.js';
import { DEFAULT_AI_NAME, DEFAULT_AI_EMAIL } from '../../../../shared/constants/ai.js';

/**
 * Create the admin tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createAdminTab({ user }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-admin',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-admin-btn',
    'data-tab': 'admin',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.admin', 'Admin'),
  });

  const description = h('p', {
    class: 'settings-tab-description',
    text: t(
      'settings.admin.description',
      'Configure workspace-wide settings that apply to all users.'
    ),
  });

  // Supported languages card
  const langCard = h('div', { class: 'stack editor-card' });
  langCard.append(
    h('div', {
      class: 'field-label',
      text: t(
        'settings.admin.supportedSlideLangs.title',
        'Supported slide languages'
      ),
    })
  );
  const langHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.supportedSlideLangs.hint',
      'Controls which languages are available in language mode and translation tools.'
    ),
  });

  const langOptions = h('div', { class: 'admin-checkbox-list' });
  const chkNl = h('label', { class: 'admin-checkbox-item' }, [
    h('input', { type: 'checkbox' }),
    h('span', { text: 'Nederlands (NL)' }),
  ]);
  const chkEn = h('label', { class: 'admin-checkbox-item' }, [
    h('input', { type: 'checkbox' }),
    h('span', { text: 'English (EN-GB)' }),
  ]);
  langOptions.append(chkNl, chkEn);
  langCard.append(langHint, langOptions);

  // AI Assistant Identity card
  const aiCard = h('div', { class: 'stack editor-card' });
  aiCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.admin.aiAssistant.title', 'AI Assistant Identity'),
    })
  );
  const aiHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.aiAssistant.hint',
      'Customize the name and email shown for AI-generated content.'
    ),
  });
  const aiNameInput = h('input', {
    type: 'text',
    class: 'input',
    placeholder: DEFAULT_AI_NAME,
    maxlength: '64',
  });
  const aiEmailInput = h('input', {
    type: 'email',
    class: 'input',
    placeholder: DEFAULT_AI_EMAIL,
    maxlength: '255',
  });
  const aiFields = h('div', { class: 'stack gap-2' }, [
    h('label', { class: 'field-row' }, [
      h('span', { class: 'field-row-label', text: t('settings.admin.aiAssistant.name', 'Name') }),
      aiNameInput,
    ]),
    h('label', { class: 'field-row' }, [
      h('span', { class: 'field-row-label', text: t('settings.admin.aiAssistant.email', 'Email') }),
      aiEmailInput,
    ]),
  ]);
  aiCard.append(aiHint, aiFields);

  // Email Sender Identity card
  const senderCard = h('div', { class: 'stack editor-card' });
  senderCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.admin.emailSender.title', 'Email Sender Identity'),
    })
  );
  const senderHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.emailSender.hint',
      'From address for system emails. Falls back to environment variables if empty.'
    ),
  });
  const senderEmailInput = h('input', {
    type: 'email',
    class: 'input',
    placeholder: 'noreply@example.com',
    maxlength: '255',
  });
  const senderNameInput = h('input', {
    type: 'text',
    class: 'input',
    placeholder: getAppName(),
    maxlength: '128',
  });
  const senderFields = h('div', { class: 'stack gap-2' }, [
    h('label', { class: 'field-row' }, [
      h('span', { class: 'field-row-label', text: t('settings.admin.emailSender.email', 'Email') }),
      senderEmailInput,
    ]),
    h('label', { class: 'field-row' }, [
      h('span', { class: 'field-row-label', text: t('settings.admin.emailSender.name', 'Name') }),
      senderNameInput,
    ]),
  ]);
  senderCard.append(senderHint, senderFields);

  // Session Duration card
  const sessionCard = h('div', { class: 'stack editor-card' });
  sessionCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.admin.sessionDuration.title', 'Session Duration'),
    })
  );
  const sessionHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.sessionDuration.hint',
      'How long users stay logged in before needing to sign in again.'
    ),
  });
  const sessionSelect = h('select', { class: 'select' }, [
    h('option', { value: '1', text: t('settings.admin.sessionDuration.1day', '1 day') }),
    h('option', { value: '7', text: t('settings.admin.sessionDuration.7days', '7 days') }),
    h('option', { value: '14', text: t('settings.admin.sessionDuration.14days', '14 days') }),
    h('option', { value: '30', text: t('settings.admin.sessionDuration.30days', '30 days (default)') }),
    h('option', { value: '90', text: t('settings.admin.sessionDuration.90days', '90 days') }),
    h('option', { value: '365', text: t('settings.admin.sessionDuration.365days', '1 year') }),
  ]);
  const sessionField = h('label', { class: 'field-row' }, [
    h('span', { class: 'field-row-label', text: t('settings.admin.sessionDuration.duration', 'Duration') }),
    sessionSelect,
  ]);
  sessionCard.append(sessionHint, sessionField);

  // Theme configuration (default theme + picker visibility) lives in the
  // Themes settings tab.

  // Engagement Insights (Analytics) card
  const analyticsCard = h('div', { class: 'stack editor-card' });
  analyticsCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.admin.analytics.title', 'Engagement Insights'),
    })
  );
  const analyticsHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.analytics.hint',
      'Configure how presentation engagement is tracked and reported.'
    ),
  });

  // Master analytics toggle
  const analyticsEnabledCheck = h('input', { type: 'checkbox', checked: true });
  const analyticsEnabledLabel = h('label', { class: 'admin-checkbox-item' }, [
    analyticsEnabledCheck,
    h('span', { text: t('settings.admin.analytics.enabled', 'Enable engagement insights') }),
  ]);

  // Team analytics policy
  const teamPolicySelect = h('select', { class: 'select', 'aria-label': t('settings.admin.analytics.teamPolicy', 'Team analytics policy') }, [
    h('option', { value: 'off', text: t('settings.admin.analytics.teamPolicyOff', "Off - Don't track team member views") }),
    h('option', { value: 'aggregate', text: t('settings.admin.analytics.teamPolicyAggregate', 'Aggregate - Show counts without names') }),
    h('option', { value: 'opt-in-detailed', text: t('settings.admin.analytics.teamPolicyOptIn', 'Opt-in detailed - Show names if viewer allows') }),
  ]);
  const teamPolicyField = h('label', { class: 'field-row' }, [
    h('span', { class: 'field-row-label', text: t('settings.admin.analytics.teamPolicy', 'Team analytics policy') }),
    teamPolicySelect,
  ]);

  // Allow detailed opt-in toggle
  const allowDetailedOptInCheck = h('input', { type: 'checkbox', checked: true });
  const allowDetailedOptInLabel = h('label', { class: 'admin-checkbox-item' }, [
    allowDetailedOptInCheck,
    h('span', { text: t('settings.admin.analytics.allowDetailedOptIn', 'Allow presenters to request detailed team analytics') }),
  ]);

  // External analytics toggle
  const externalAnalyticsCheck = h('input', { type: 'checkbox', checked: true });
  const externalAnalyticsLabel = h('label', { class: 'admin-checkbox-item' }, [
    externalAnalyticsCheck,
    h('span', { text: t('settings.admin.analytics.externalEnabled', 'Track external/anonymous viewers') }),
  ]);

  // Retention settings
  const retentionSessionSelect = h('select', { class: 'select', 'aria-label': t('settings.admin.analytics.retentionDays', 'Keep session data for') }, [
    h('option', { value: '30', text: t('settings.admin.analytics.daysOption', '{n} days', { n: 30 }) }),
    h('option', { value: '60', text: t('settings.admin.analytics.daysOption', '{n} days', { n: 60 }) }),
    h('option', { value: '90', text: t('settings.admin.analytics.daysOptionDefault', '{n} days (default)', { n: 90 }) }),
    h('option', { value: '180', text: t('settings.admin.analytics.daysOption', '{n} days', { n: 180 }) }),
    h('option', { value: '365', text: t('settings.admin.analytics.daysOption', '{n} days', { n: 365 }) }),
  ]);
  const retentionSessionField = h('label', { class: 'field-row' }, [
    h('span', { class: 'field-row-label', text: t('settings.admin.analytics.retentionDays', 'Keep session data for') }),
    retentionSessionSelect,
  ]);

  const retentionIpSelect = h('select', { class: 'select', 'aria-label': t('settings.admin.analytics.retentionIpDays', 'Anonymize IP addresses after') }, [
    h('option', { value: '1', text: t('settings.admin.analytics.daysOption', '{n} days', { n: 1 }) }),
    h('option', { value: '7', text: t('settings.admin.analytics.daysOptionDefault', '{n} days (default)', { n: 7 }) }),
    h('option', { value: '14', text: t('settings.admin.analytics.daysOption', '{n} days', { n: 14 }) }),
    h('option', { value: '30', text: t('settings.admin.analytics.daysOption', '{n} days', { n: 30 }) }),
  ]);
  const retentionIpField = h('label', { class: 'field-row' }, [
    h('span', { class: 'field-row-label', text: t('settings.admin.analytics.retentionIpDays', 'Anonymize IP addresses after') }),
    retentionIpSelect,
  ]);

  const analyticsOptions = h('div', { class: 'stack gap-3' }, [
    analyticsEnabledLabel,
    teamPolicyField,
    allowDetailedOptInLabel,
    externalAnalyticsLabel,
    h('div', { class: 'field-label', style: 'margin-top: var(--ps-space-3);', text: t('settings.admin.analytics.retention', 'Data retention') }),
    retentionSessionField,
    retentionIpField,
  ]);
  analyticsCard.append(analyticsHint, analyticsOptions);

  // Stock Media card
  const stockMediaCard = h('div', { class: 'stack editor-card' });
  stockMediaCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.admin.stockMedia.title', 'Stock Media'),
    })
  );
  const stockMediaHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.stockMedia.hint',
      'Enable stock photo and GIF integrations for the image picker.'
    ),
  });

  // Unsplash toggle
  const unsplashEnabledCheck = h('input', { type: 'checkbox' });
  const unsplashStatusSpan = h('span', { class: 'help stock-media-status' });
  const unsplashLabel = h('label', { class: 'admin-checkbox-item' }, [
    unsplashEnabledCheck,
    h('span', { text: t('settings.admin.stockMedia.unsplash', 'Enable Unsplash photos') }),
    unsplashStatusSpan,
  ]);

  // Giphy toggle
  const giphyEnabledCheck = h('input', { type: 'checkbox' });
  const giphyStatusSpan = h('span', { class: 'help stock-media-status' });
  const giphyLabel = h('label', { class: 'admin-checkbox-item' }, [
    giphyEnabledCheck,
    h('span', { text: t('settings.admin.stockMedia.giphy', 'Enable Giphy GIFs') }),
    giphyStatusSpan,
  ]);

  const stockMediaOptions = h('div', { class: 'stack gap-2' }, [
    unsplashLabel,
    giphyLabel,
  ]);
  stockMediaCard.append(stockMediaHint, stockMediaOptions);

  // Save button
  const actions = h('div', { class: 'row is-end', style: 'margin-top: var(--ps-space-4);' });
  const btnSave = h('button', {
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  actions.append(btnSave);

  const cards = h('div', { class: 'settings-admin-cards' }, [
    langCard,
    aiCard,
    senderCard,
    sessionCard,
    analyticsCard,
    stockMediaCard,
  ]);

  container.append(title, description, cards, actions);

  let busy = false;
  let loaded = false;

  const allInputs = [
    chkNl.querySelector('input'),
    chkEn.querySelector('input'),
    aiNameInput,
    aiEmailInput,
    senderEmailInput,
    senderNameInput,
    sessionSelect,
    analyticsEnabledCheck,
    teamPolicySelect,
    allowDetailedOptInCheck,
    externalAnalyticsCheck,
    retentionSessionSelect,
    retentionIpSelect,
    unsplashEnabledCheck,
    giphyEnabledCheck,
  ];

  const setBusy = (v) => {
    busy = v;
    btnSave.disabled = busy;
    allInputs.forEach((el) => { el.disabled = busy; });
  };

  const load = async () => {
    if (loaded) return;
    loaded = true;

    try {
      const app = await fetchAppSettings();
      const supportedSlideLangs = Array.isArray(app?.supportedSlideLangs)
        ? app.supportedSlideLangs
        : getSupportedLangs();

      chkNl.querySelector('input').checked = supportedSlideLangs.includes('nl');
      chkEn.querySelector('input').checked = supportedSlideLangs.includes('en-GB');

      // AI assistant identity
      aiNameInput.value = app?.aiAssistant?.name || '';
      aiEmailInput.value = app?.aiAssistant?.email || '';

      // Email sender identity
      senderEmailInput.value = app?.emailSender?.email || '';
      senderNameInput.value = app?.emailSender?.name || '';

      // Session duration
      const sessionDays = String(app?.sessionDurationDays || 30);
      sessionSelect.value = sessionDays;
      // If the value isn't in the options, default to 30
      if (sessionSelect.value !== sessionDays) {
        sessionSelect.value = '30';
      }

      // Analytics settings
      const analytics = app?.analytics || {};
      analyticsEnabledCheck.checked = analytics?.enabled !== false;
      teamPolicySelect.value = analytics?.teamAnalytics?.policy || 'aggregate';
      allowDetailedOptInCheck.checked = analytics?.teamAnalytics?.allowDetailedOptIn !== false;
      externalAnalyticsCheck.checked = analytics?.externalAnalytics?.enabled !== false;
      retentionSessionSelect.value = String(analytics?.retention?.sessionDataDays || 90);
      retentionIpSelect.value = String(analytics?.retention?.ipAnonymizationDays || 7);

      // Stock media settings
      const stockMedia = app?.stockMedia || {};
      unsplashEnabledCheck.checked = stockMedia?.unsplash?.enabled === true;
      giphyEnabledCheck.checked = stockMedia?.giphy?.enabled === true;

      // Fetch stock media status to show if API keys are configured
      try {
        const resp = await fetch('/api/stock-media/status');
        if (resp.ok) {
          const status = await resp.json();
          const notConfigured = t('settings.admin.stockMedia.notConfiguredParen', '(Not configured)');
          const configured = t('settings.admin.stockMedia.configuredParen', '(API key configured)');

          if (status?.unsplash?.configured) {
            unsplashStatusSpan.textContent = ` ${configured}`;
            unsplashStatusSpan.classList.remove('is-warning');
          } else {
            unsplashStatusSpan.textContent = ` ${notConfigured}`;
            unsplashStatusSpan.classList.add('is-warning');
            unsplashEnabledCheck.disabled = true;
          }

          if (status?.giphy?.configured) {
            giphyStatusSpan.textContent = ` ${configured}`;
            giphyStatusSpan.classList.remove('is-warning');
          } else {
            giphyStatusSpan.textContent = ` ${notConfigured}`;
            giphyStatusSpan.classList.add('is-warning');
            giphyEnabledCheck.disabled = true;
          }
        }
      } catch {
        // Ignore status fetch errors
      }
    } catch (e) {
      toast.error(String(e?.message || e), { id: 'settings-load' });
    }
  };

  btnSave.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);

    try {
      const nextSupported = [];
      if (chkNl.querySelector('input').checked) nextSupported.push('nl');
      if (chkEn.querySelector('input').checked) nextSupported.push('en-GB');

      const updatedApp = await updateAppSettings({
        supportedSlideLangs: nextSupported,
        aiAssistant: {
          name: aiNameInput.value.trim(),
          email: aiEmailInput.value.trim(),
        },
        emailSender: {
          email: senderEmailInput.value.trim(),
          name: senderNameInput.value.trim(),
        },
        sessionDurationDays: parseInt(sessionSelect.value, 10) || 30,
        analytics: {
          enabled: analyticsEnabledCheck.checked,
          teamAnalytics: {
            policy: teamPolicySelect.value,
            allowDetailedOptIn: allowDetailedOptInCheck.checked,
          },
          externalAnalytics: {
            enabled: externalAnalyticsCheck.checked,
          },
          retention: {
            sessionDataDays: parseInt(retentionSessionSelect.value, 10) || 90,
            ipAnonymizationDays: parseInt(retentionIpSelect.value, 10) || 7,
          },
        },
        stockMedia: {
          unsplash: { enabled: unsplashEnabledCheck.checked },
          giphy: { enabled: giphyEnabledCheck.checked },
        },
      });

      const supportedSlideLangs = Array.isArray(updatedApp?.supportedSlideLangs)
        ? updatedApp.supportedSlideLangs
        : null;
      if (supportedSlideLangs) {
        setSupportedLangs(supportedSlideLangs);
      }

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