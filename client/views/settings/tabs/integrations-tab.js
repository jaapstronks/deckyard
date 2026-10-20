/** Installation webhook settings. Organization RSS lives under Organization. */
import { h } from '../../../lib/dom/index.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { createAdminWebhooksSection } from '../sections/index.js';
import {
  fetchAppSettings,
  updateAppSettings,
  invalidateSettingsCache,
} from '../../../lib/net/settings.js';

/** @returns {{el: HTMLElement, load: () => Promise<void>}} */
export function createIntegrationsTab() {
  const el = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-integrations',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-integrations-btn',
    'data-tab': 'integrations',
  });
  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.integrations', 'Webhooks'),
  });
  const description = h('p', {
    class: 'settings-tab-description',
    text: t(
      'settings.integrations.description',
      'Connect external services via webhooks to receive notifications about events.',
    ),
  });
  const webhooks = createAdminWebhooksSection();
  const card = h('div', { class: 'stack editor-card' }, webhooks.elements);
  const error = createInlineError({ callout: true });
  const save = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  el.append(
    title,
    description,
    card,
    error.el,
    h('div', { class: 'row is-end settings-policy-actions' }, [save]),
  );
  let loaded = false;

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const app = await fetchAppSettings();
      webhooks.setValues(app?.webhooks);
    } catch (err) {
      error.show(err.message);
      loaded = false;
    }
  }

  save.addEventListener('click', async () => {
    error.clear();
    save.disabled = true;
    webhooks.setDisabled(true);
    try {
      await updateAppSettings({ webhooks: webhooks.getValues() });
      invalidateSettingsCache();
      toast.success(t('settings.saved', 'Saved.'));
    } catch (err) {
      error.show(err.message);
    } finally {
      save.disabled = false;
      webhooks.setDisabled(false);
    }
  });
  return { el, load };
}
