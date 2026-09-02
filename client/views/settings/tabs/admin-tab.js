/**
 * Admin Tab Component
 * General admin settings: supported languages, themes, AI identity, email sender, session, etc.
 */

import { h } from '../../../lib/dom.js';
import { labeledCheckbox } from '../../../lib/dom/labeled-checkbox.js';
import { getAppName } from '../../../lib/theme/branding.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import {
  fetchAppSettings,
  updateAppSettings,
  invalidateSettingsCache,
} from '../../../lib/net/settings.js';
import {
  fetchStockMediaStatus,
  invalidateStockMediaStatus,
} from '../../../lib/net/stock-media.js';
import {
  getSupportedLangs,
  setSupportedLangs,
} from '../../../lib/format/i18n.js';
import {
  DEFAULT_AI_NAME,
  DEFAULT_AI_EMAIL,
} from '../../../../shared/constants/ai.js';
import {
  getLangDisplayName,
  TRANSLATION_LANGS,
} from '../../../../shared/i18n-utils.js';

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
      'Configure workspace-wide settings that apply to all users.',
    ),
  });

  // Supported languages card
  const langCard = h('div', { class: 'stack editor-card' });
  langCard.append(
    h('div', {
      class: 'field-label',
      text: t(
        'settings.admin.supportedSlideLangs.title',
        'Admin: supported slide languages',
      ),
    }),
  );
  const langHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.supportedSlideLangs.hint',
      'This controls which languages are visible/usable in language mode and translation.',
    ),
  });

  // One checkbox per deck language, built from the axis
  // (`TRANSLATION_LANGS`). This was two fixed `Nederlands (NL)` /
  // `English (EN-GB)` boxes, which is why nothing else could ever be switched
  // on however configurable the accessor claimed to be (D61).
  const langOptions = h('div', { class: 'admin-checkbox-list' });
  /** @type {Record<string, HTMLInputElement>} */
  const langChecks = {};
  for (const code of TRANSLATION_LANGS) {
    const { el } = labeledCheckbox({
      text: `${getLangDisplayName(code)} (${code})`,
    });
    langChecks[code] = el.querySelector('input');
    langOptions.append(el);
  }
  langCard.append(langHint, langOptions);

  // AI Assistant Identity card
  const aiCard = h('div', { class: 'stack editor-card' });
  aiCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.admin.aiAssistant.title', 'AI Assistant Identity'),
    }),
  );
  const aiHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.aiAssistant.hint',
      'Customize the name and email shown for AI-generated content.',
    ),
  });
  const aiNameInput = h('input', {
    type: 'text',
    class: 'form-input',
    placeholder: DEFAULT_AI_NAME,
    maxlength: '64',
  });
  const aiEmailInput = h('input', {
    type: 'email',
    class: 'form-input',
    placeholder: DEFAULT_AI_EMAIL,
    maxlength: '255',
  });
  const aiFields = h('div', { class: 'stack gap-2' }, [
    h('label', { class: 'field-row' }, [
      h('span', {
        class: 'field-row-label',
        text: t('settings.admin.aiAssistant.name', 'Name'),
      }),
      aiNameInput,
    ]),
    h('label', { class: 'field-row' }, [
      h('span', {
        class: 'field-row-label',
        text: t('settings.admin.aiAssistant.email', 'Email'),
      }),
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
    }),
  );
  const senderHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.emailSender.hint',
      'From address for system emails. Falls back to environment variables if empty.',
    ),
  });
  const senderEmailInput = h('input', {
    type: 'email',
    class: 'form-input',
    placeholder: 'noreply@example.com',
    maxlength: '255',
  });
  const senderNameInput = h('input', {
    type: 'text',
    class: 'form-input',
    placeholder: getAppName(),
    maxlength: '128',
  });
  const senderFields = h('div', { class: 'stack gap-2' }, [
    h('label', { class: 'field-row' }, [
      h('span', {
        class: 'field-row-label',
        text: t('settings.admin.emailSender.email', 'Email'),
      }),
      senderEmailInput,
    ]),
    h('label', { class: 'field-row' }, [
      h('span', {
        class: 'field-row-label',
        text: t('settings.admin.emailSender.name', 'Name'),
      }),
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
    }),
  );
  const sessionHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.sessionDuration.hint',
      'How long users stay logged in before needing to sign in again.',
    ),
  });
  const sessionSelect = h('select', { class: 'form-input' }, [
    h('option', {
      value: '1',
      text: t('settings.admin.sessionDuration.1day', '1 day'),
    }),
    h('option', {
      value: '7',
      text: t('settings.admin.sessionDuration.7days', '7 days'),
    }),
    h('option', {
      value: '14',
      text: t('settings.admin.sessionDuration.14days', '14 days'),
    }),
    h('option', {
      value: '30',
      text: t('settings.admin.sessionDuration.30days', '30 days (default)'),
    }),
    h('option', {
      value: '90',
      text: t('settings.admin.sessionDuration.90days', '90 days'),
    }),
    h('option', {
      value: '365',
      text: t('settings.admin.sessionDuration.365days', '1 year'),
    }),
  ]);
  const sessionField = h('label', { class: 'field-row' }, [
    h('span', {
      class: 'field-row-label',
      text: t('settings.admin.sessionDuration.duration', 'Duration'),
    }),
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
    }),
  );
  const analyticsHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.analytics.hint',
      'Configure how engagement data is collected and displayed.',
    ),
  });

  // Master analytics toggle — the only tracking switch. The former team-policy,
  // detailed-opt-in and external-viewer toggles gated a distinction the data
  // never carried; they were removed with the internal/external chain
  // (done/decisions.md § analytics-privacy-naden).
  const { el: analyticsEnabledLabel, input: analyticsEnabledCheck } =
    labeledCheckbox({
      text: t('settings.admin.analytics.enabled', 'Enable engagement insights'),
      checked: true,
    });

  // Retention settings
  const retentionSessionSelect = h(
    'select',
    {
      class: 'form-input',
      'aria-label': t(
        'settings.admin.analytics.retentionDays',
        'Keep session data for',
      ),
    },
    [
      h('option', {
        value: '30',
        text: t('settings.admin.analytics.daysOption', '{n} days', { n: 30 }),
      }),
      h('option', {
        value: '60',
        text: t('settings.admin.analytics.daysOption', '{n} days', { n: 60 }),
      }),
      h('option', {
        value: '90',
        text: t(
          'settings.admin.analytics.daysOptionDefault',
          '{n} days (default)',
          { n: 90 },
        ),
      }),
      h('option', {
        value: '180',
        text: t('settings.admin.analytics.daysOption', '{n} days', { n: 180 }),
      }),
      h('option', {
        value: '365',
        text: t('settings.admin.analytics.daysOption', '{n} days', { n: 365 }),
      }),
    ],
  );
  const retentionSessionField = h('label', { class: 'field-row' }, [
    h('span', {
      class: 'field-row-label',
      text: t(
        'settings.admin.analytics.retentionDays',
        'Keep session data for',
      ),
    }),
    retentionSessionSelect,
  ]);

  const retentionIpSelect = h(
    'select',
    {
      class: 'form-input',
      'aria-label': t(
        'settings.admin.analytics.retentionIpDays',
        'Anonymize IP addresses after',
      ),
    },
    [
      h('option', {
        value: '1',
        text: t('settings.admin.analytics.daysOption', '{n} days', { n: 1 }),
      }),
      h('option', {
        value: '7',
        text: t(
          'settings.admin.analytics.daysOptionDefault',
          '{n} days (default)',
          { n: 7 },
        ),
      }),
      h('option', {
        value: '14',
        text: t('settings.admin.analytics.daysOption', '{n} days', { n: 14 }),
      }),
      h('option', {
        value: '30',
        text: t('settings.admin.analytics.daysOption', '{n} days', { n: 30 }),
      }),
    ],
  );
  const retentionIpField = h('label', { class: 'field-row' }, [
    h('span', {
      class: 'field-row-label',
      text: t(
        'settings.admin.analytics.retentionIpDays',
        'Anonymize IP addresses after',
      ),
    }),
    retentionIpSelect,
  ]);

  const analyticsOptions = h('div', { class: 'stack gap-3' }, [
    analyticsEnabledLabel,
    h('div', {
      class: 'field-label',
      style: 'margin-top: var(--ps-space-3);',
      text: t('settings.admin.analytics.retention', 'Data retention'),
    }),
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
    }),
  );
  const stockMediaHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.stockMedia.hint',
      'Enable stock photo and GIF integrations for the image picker. Requires API keys in server environment.',
    ),
  });

  // Bundled gradients toggle. No key to check, so no status span: the assets
  // ship with the app and are always "configured".
  const { el: bundledLabel, input: bundledEnabledCheck } = labeledCheckbox({
    text: t('settings.admin.stockMedia.bundled', 'Enable bundled gradients'),
  });
  const bundledHint = h('div', {
    class: 'help',
    text: t(
      'settings.admin.stockMedia.bundledHint',
      'Abstract backgrounds generated from the built-in themes. No API key, no attribution, no external requests.',
    ),
  });

  // Unsplash toggle
  const unsplashStatusSpan = h('span', { class: 'help stock-media-status' });
  const { el: unsplashLabel, input: unsplashEnabledCheck } = labeledCheckbox({
    content: [
      h('span', {
        text: t('settings.admin.stockMedia.unsplash', 'Enable Unsplash photos'),
      }),
      unsplashStatusSpan,
    ],
  });

  // Giphy toggle
  const giphyStatusSpan = h('span', { class: 'help stock-media-status' });
  const { el: giphyLabel, input: giphyEnabledCheck } = labeledCheckbox({
    content: [
      h('span', {
        text: t('settings.admin.stockMedia.giphy', 'Enable Giphy GIFs'),
      }),
      giphyStatusSpan,
    ],
  });

  const stockMediaOptions = h('div', { class: 'stack gap-2' }, [
    bundledLabel,
    bundledHint,
    unsplashLabel,
    giphyLabel,
  ]);
  stockMediaCard.append(stockMediaHint, stockMediaOptions);

  // Save button
  const actions = h('div', {
    class: 'row is-end',
    style: 'margin-top: var(--ps-space-4);',
  });
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

  // A refused save is a state of this form, so it stays beside Save until the
  // next attempt (docs/reference/feedback-surfaces.md). The settings routes
  // answer about the request as a whole — permission, a malformed body — and
  // name no `details.field`, so there is no control to mark.
  const saveError = createInlineError({ callout: true });

  container.append(title, description, cards, saveError.el, actions);

  let busy = false;
  let loaded = false;

  const allInputs = [
    ...Object.values(langChecks),
    aiNameInput,
    aiEmailInput,
    senderEmailInput,
    senderNameInput,
    sessionSelect,
    analyticsEnabledCheck,
    retentionSessionSelect,
    retentionIpSelect,
    unsplashEnabledCheck,
    giphyEnabledCheck,
  ];

  const setBusy = (v) => {
    busy = v;
    btnSave.disabled = busy;
    allInputs.forEach((el) => {
      el.disabled = busy;
    });
  };

  const load = async () => {
    if (loaded) return;
    loaded = true;

    try {
      const app = await fetchAppSettings();
      const supportedSlideLangs = Array.isArray(app?.supportedSlideLangs)
        ? app.supportedSlideLangs
        : getSupportedLangs();

      for (const [code, input] of Object.entries(langChecks))
        input.checked = supportedSlideLangs.includes(code);

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
      retentionSessionSelect.value = String(
        analytics?.retention?.sessionDataDays || 90,
      );
      retentionIpSelect.value = String(
        analytics?.retention?.ipAnonymizationDays || 7,
      );

      // Stock media settings
      const stockMedia = app?.stockMedia || {};
      bundledEnabledCheck.checked = stockMedia?.bundled?.enabled === true;
      unsplashEnabledCheck.checked = stockMedia?.unsplash?.enabled === true;
      giphyEnabledCheck.checked = stockMedia?.giphy?.enabled === true;

      // Fetch stock media status to show if API keys are configured
      try {
        const status = await fetchStockMediaStatus({ maxAgeMs: 0 });
        const notConfigured = t(
          'settings.admin.stockMedia.notConfiguredParen',
          '(Not configured)',
        );
        const configured = t(
          'settings.admin.stockMedia.configuredParen',
          '(API key configured)',
        );

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
      } catch {
        // Ignore status fetch errors
      }
    } catch (e) {
      toast.error(e, { id: 'settings-load' });
    }
  };

  btnSave.addEventListener('click', async () => {
    if (busy) return;
    saveError.clear();
    setBusy(true);

    try {
      // Axis order, so the first enabled language is a stable default.
      const nextSupported = TRANSLATION_LANGS.filter(
        (code) => langChecks[code]?.checked,
      );

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
          retention: {
            sessionDataDays: parseInt(retentionSessionSelect.value, 10) || 90,
            ipAnonymizationDays: parseInt(retentionIpSelect.value, 10) || 7,
          },
        },
        stockMedia: {
          bundled: { enabled: bundledEnabledCheck.checked },
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
      // An editor opened after this save must see the new source list.
      invalidateStockMediaStatus();
      toast.success(t('settings.saved', 'Saved.'), {
        id: 'settings-save',
        durationMs: 1800,
      });
    } catch (e) {
      saveError.show(e.message);
    } finally {
      setBusy(false);
    }
  });

  return {
    el: container,
    load,
  };
}
