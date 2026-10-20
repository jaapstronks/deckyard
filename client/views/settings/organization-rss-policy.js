/** Organization RSS policy, separate from installation webhooks. */
import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';
import { toast } from '../../lib/dom/toast.js';
import { createInlineError } from '../../lib/dom/inline-error.js';
import { debugLog } from '../../lib/state/debug.js';
import {
  fetchOrgSettings,
  updateOrgSettings,
  invalidateSettingsCache,
} from '../../lib/net/settings.js';

/** @returns {{el: HTMLElement, load: () => Promise<void>}} */
export function createOrganizationRssPolicy() {
  const el = h('section', { class: 'stack editor-card' });
  const heading = h('h3', {
    class: 'editor-card-title',
    text: t('settings.integrations.rss.title', 'RSS Feed'),
  });
  const description = h('p', {
    class: 'help',
    text: t(
      'settings.integrations.rss.description',
      'Connect your published presentations to any feed reader, Slack channel, or automation tool.',
    ),
  });
  const enabled = h('input', { type: 'checkbox' });
  const toggle = h('label', { class: 'row is-start is-gap-xs' }, [
    enabled,
    h('span', {
      text: t('settings.integrations.rss.enable', 'Enable RSS feed'),
    }),
  ]);
  const fields = h('div', { class: 'stack is-gap-sm' });
  const labels = {
    title: t('settings.integrations.rss.feedTitle', 'Title'),
    description: t('settings.integrations.rss.feedDescription', 'Description'),
    maxItems: t('settings.integrations.rss.maxItems', 'Max items'),
    copyright: t('settings.integrations.rss.copyright', 'Copyright'),
    authorName: t('settings.integrations.rss.authorName', 'Author name'),
  };
  const specs = [
    ['title', 'text', 200],
    ['description', 'text', 500],
    ['maxItems', 'number', 100],
    ['copyright', 'text', 200],
    ['authorName', 'text', 100],
  ];
  const inputs = {};
  for (const [key, type, max] of specs) {
    const input = h('input', {
      type,
      class: 'form-input',
      ...(type === 'number'
        ? { min: '1', max: String(max) }
        : { maxlength: String(max) }),
    });
    inputs[key] = input;
    fields.append(
      h('label', { class: 'field-row' }, [
        h('span', {
          class: 'field-row-label',
          text: labels[key],
        }),
        input,
      ]),
    );
  }
  const language = h('select', { class: 'form-input' });
  for (const [value, label] of [
    ['en', 'English'],
    // eslint-disable-next-line no-restricted-syntax -- RSS metadata codes are independent of deck language codes.
    ['nl', 'Nederlands'],
    ['de', 'Deutsch'],
    ['fr', 'Français'],
    ['es', 'Español'],
    ['it', 'Italiano'],
    ['pt', 'Português'],
  ]) {
    language.append(h('option', { value, text: label }));
  }
  fields.append(
    h('label', { class: 'field-row' }, [
      h('span', {
        class: 'field-row-label',
        text: t('settings.integrations.rss.language', 'Language'),
      }),
      language,
    ]),
  );
  const urls = h('div', { class: 'stack is-gap-xs' });
  for (const [label, path] of [
    ['RSS', '/feed/rss.xml'],
    ['Atom', '/feed/atom.xml'],
    ['JSON', '/feed/feed.json'],
  ]) {
    const url = `${location.origin}${path}`;
    const copy = h('button', {
      class: 'btn btn-sm',
      type: 'button',
      text: t('common.copy', 'Copy'),
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast.success(t('common.copied', 'Copied'));
        } catch (err) {
          debugLog('RSS URL clipboard copy failed', err);
        }
      },
    });
    urls.append(
      h('div', { class: 'row is-gap-xs settings-rss-url' }, [
        h('span', { text: label }),
        h('code', { text: url }),
        copy,
      ]),
    );
  }
  const error = createInlineError({ callout: true });
  const save = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  el.append(
    heading,
    description,
    toggle,
    fields,
    urls,
    error.el,
    h('div', { class: 'row is-end settings-policy-actions' }, [save]),
  );

  let loaded = false;
  let customFeedUrl = '';
  const updateVisibility = () => {
    fields.hidden = !enabled.checked;
    urls.hidden = !enabled.checked;
  };
  enabled.addEventListener('change', updateVisibility);
  updateVisibility();

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const rss = (await fetchOrgSettings({ maxAgeMs: 0 }))?.rss || {};
      enabled.checked = rss.enabled === true;
      for (const [key] of specs)
        inputs[key].value = String(rss[key] ?? (key === 'maxItems' ? 50 : ''));
      language.value = rss.language || 'en';
      customFeedUrl = rss.customFeedUrl || '';
      updateVisibility();
    } catch (err) {
      error.show(err.message);
      loaded = false;
    }
  }

  save.addEventListener('click', async () => {
    if (!loaded) return;
    error.clear();
    save.disabled = true;
    try {
      await updateOrgSettings({
        rss: {
          enabled: enabled.checked,
          title: inputs.title.value.trim(),
          description: inputs.description.value.trim(),
          language: language.value,
          maxItems: Math.max(
            1,
            Math.min(100, Number(inputs.maxItems.value) || 50),
          ),
          copyright: inputs.copyright.value.trim(),
          authorName: inputs.authorName.value.trim(),
          customFeedUrl,
        },
      });
      invalidateSettingsCache();
      updateVisibility();
      toast.success(t('settings.saved', 'Saved.'));
    } catch (err) {
      error.show(err.message);
    } finally {
      save.disabled = false;
    }
  });
  return { el, load };
}
