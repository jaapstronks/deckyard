/**
 * Integrations Tab Component
 * Webhooks + RSS Feed configuration
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/toast.js';
import { createAdminWebhooksSection } from '../sections/index.js';
import {
  fetchAppSettings,
  updateAppSettings,
  fetchOrgSettings,
  updateOrgSettings,
  invalidateSettingsCache,
} from '../../../lib/settings.js';

/**
 * Create the integrations tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createIntegrationsTab({ user }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-integrations',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-integrations-btn',
    'data-tab': 'integrations',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.integrations', 'Integrations'),
  });

  const description = h('p', {
    class: 'settings-tab-description',
    text: t(
      'settings.integrations.description',
      'Connect external services via webhooks to receive notifications about events.'
    ),
  });

  // Webhooks card
  const webhooksCard = h('div', { class: 'stack editor-card' });
  const adminWebhooks = createAdminWebhooksSection({ h });
  webhooksCard.append(...adminWebhooks.elements);

  // ─── RSS Feed card ───────────────────────────────────────
  const rssCard = h('div', { class: 'stack editor-card' });

  const rssCardTitle = h('h3', {
    class: 'editor-card-title',
    text: t('settings.integrations.rss.title', 'RSS Feed'),
  });
  const rssCardDesc = h('p', {
    class: 'help',
    text: t(
      'settings.integrations.rss.description',
      'Connect your published presentations to any feed reader, Slack channel, or automation tool.'
    ),
  });

  // Enable toggle
  const rssEnableRow = h('label', {
    class: 'row is-start is-gap-xs',
    style: 'margin-top: var(--ps-space-2);',
  });
  const rssEnableCb = h('input', { type: 'checkbox' });
  rssEnableRow.append(
    rssEnableCb,
    h('span', {
      text: t('settings.integrations.rss.enable', 'Enable RSS feed'),
    })
  );

  // Fields (hidden when disabled)
  const rssFields = h('div', {
    class: 'stack is-gap-sm',
    style: 'display:none;',
  });

  const rssTitleInput = h('input', {
    type: 'text',
    class: 'form-input',
    maxlength: '200',
    placeholder: t('settings.integrations.rss.titlePlaceholder', 'My Presentations'),
  });
  const rssDescInput = h('input', {
    type: 'text',
    class: 'form-input',
    maxlength: '500',
    placeholder: t('settings.integrations.rss.descPlaceholder', 'Published presentations from our team'),
  });
  const rssLangSel = h('select', { class: 'form-input' });
  for (const [val, label] of [
    ['en', 'English'],
    ['nl', 'Nederlands'],
    ['de', 'Deutsch'],
    ['fr', 'Français'],
    ['es', 'Español'],
    ['it', 'Italiano'],
    ['pt', 'Português'],
  ]) {
    rssLangSel.append(h('option', { value: val, text: label }));
  }
  const rssMaxInput = h('input', {
    type: 'number',
    class: 'form-input',
    min: '1',
    max: '100',
    value: '50',
  });
  const rssCopyrightInput = h('input', {
    type: 'text',
    class: 'form-input',
    maxlength: '200',
  });
  const rssAuthorInput = h('input', {
    type: 'text',
    class: 'form-input',
    maxlength: '100',
  });

  // Feed URLs (shown after saving with enabled)
  const rssFeedUrlsWrap = h('div', {
    class: 'stack is-gap-xs',
    style: 'display:none;',
  });
  const createFeedUrlRow = (label, feedPath) => {
    const row = h('div', {
      class: 'row is-gap-xs',
      style: 'align-items:center;',
    });
    const lbl = h('span', {
      class: 'help',
      style: 'min-width:40px; font-weight:600;',
      text: label,
    });
    const url = h('code', {
      style:
        'flex:1; word-break:break-all; font-size:var(--ps-font-xs);',
      text: `${location.origin}${feedPath}`,
    });
    const btn = h('button', {
      class: 'btn btn-sm',
      text: t('common.copy', 'Copy'),
    });
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(
          `${location.origin}${feedPath}`
        );
        toast.success(t('common.copied', 'Copied'), {
          durationMs: 1200,
        });
      } catch {
        /* ignore */
      }
    });
    row.append(lbl, url, btn);
    return row;
  };
  rssFeedUrlsWrap.append(
    h('div', {
      class: 'field-label',
      text: t('settings.integrations.rss.feedUrls', 'Feed URLs'),
    }),
    createFeedUrlRow('RSS', '/feed/rss.xml'),
    createFeedUrlRow('Atom', '/feed/atom.xml'),
    createFeedUrlRow('JSON', '/feed/feed.json')
  );

  rssFields.append(
    h('label', {
      class: 'field-label',
      text: t('settings.integrations.rss.feedTitle', 'Title'),
    }),
    rssTitleInput,
    h('label', {
      class: 'field-label',
      text: t(
        'settings.integrations.rss.feedDescription',
        'Description'
      ),
    }),
    rssDescInput,
    h('label', {
      class: 'field-label',
      text: t('settings.integrations.rss.language', 'Language'),
    }),
    rssLangSel,
    h('label', {
      class: 'field-label',
      text: t('settings.integrations.rss.maxItems', 'Max items'),
    }),
    rssMaxInput,
    h('label', {
      class: 'field-label',
      text: t('settings.integrations.rss.copyright', 'Copyright'),
    }),
    rssCopyrightInput,
    h('label', {
      class: 'field-label',
      text: t(
        'settings.integrations.rss.authorName',
        'Author name'
      ),
    }),
    rssAuthorInput,
    rssFeedUrlsWrap
  );

  rssEnableCb.addEventListener('change', () => {
    rssFields.style.display = rssEnableCb.checked ? '' : 'none';
  });

  rssCard.append(rssCardTitle, rssCardDesc, rssEnableRow, rssFields);

  // RSS helpers
  const rssSetValues = (rss) => {
    const v = rss && typeof rss === 'object' ? rss : {};
    rssEnableCb.checked = !!v.enabled;
    rssTitleInput.value = v.title || '';
    rssDescInput.value = v.description || '';
    rssLangSel.value = v.language || 'en';
    rssMaxInput.value = String(v.maxItems || 50);
    rssCopyrightInput.value = v.copyright || '';
    rssAuthorInput.value = v.authorName || '';
    rssFields.style.display = rssEnableCb.checked ? '' : 'none';
    rssFeedUrlsWrap.style.display = v.enabled ? '' : 'none';
  };

  const rssGetValues = () => ({
    enabled: !!rssEnableCb.checked,
    title: rssTitleInput.value.trim(),
    description: rssDescInput.value.trim(),
    language: rssLangSel.value,
    maxItems: Math.max(
      1,
      Math.min(100, Number(rssMaxInput.value) || 50)
    ),
    copyright: rssCopyrightInput.value.trim(),
    authorName: rssAuthorInput.value.trim(),
  });

  const rssSetDisabled = (v) => {
    rssEnableCb.disabled = v;
    rssTitleInput.disabled = v;
    rssDescInput.disabled = v;
    rssLangSel.disabled = v;
    rssMaxInput.disabled = v;
    rssCopyrightInput.disabled = v;
    rssAuthorInput.disabled = v;
  };

  // ─── Save button ─────────────────────────────────────────
  const actions = h('div', { class: 'row is-end', style: 'margin-top: var(--ps-space-4);' });
  const btnSave = h('button', {
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  actions.append(btnSave);

  const cards = h('div', { class: 'settings-admin-cards' }, [
    webhooksCard,
    rssCard,
  ]);

  container.append(title, description, cards, actions);

  let busy = false;
  let loaded = false;

  const setBusy = (v) => {
    busy = v;
    btnSave.disabled = busy;
    adminWebhooks.setDisabled(busy);
    rssSetDisabled(busy);
  };

  const load = async () => {
    if (loaded) return;
    loaded = true;

    try {
      const [app, orgSettings] = await Promise.all([
        fetchAppSettings(),
        fetchOrgSettings(),
      ]);
      adminWebhooks.setValues(app?.webhooks);
      rssSetValues(orgSettings?.rss);
    } catch (e) {
      toast.error(String(e?.message || e), { id: 'settings-load' });
    }
  };

  btnSave.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);

    try {
      const webhookValues = adminWebhooks.getValues();
      const rssValues = rssGetValues();

      await Promise.all([
        updateAppSettings({ webhooks: webhookValues }),
        updateOrgSettings({ rss: rssValues }),
      ]);

      invalidateSettingsCache();
      // Show feed URLs after first save with enabled
      rssFeedUrlsWrap.style.display = rssValues.enabled ? '' : 'none';
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
