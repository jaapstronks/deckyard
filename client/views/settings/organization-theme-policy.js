/** Organization theme policy. Theme editing itself remains in the design workbench. */
import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';
import { api } from '../../lib/api.js';
import { toast } from '../../lib/dom/toast.js';
import { createInlineError } from '../../lib/dom/inline-error.js';
import {
  fetchOrgSettings,
  updateOrgSettings,
  invalidateSettingsCache,
} from '../../lib/net/settings.js';

/** @returns {{el: HTMLElement, load: () => Promise<void>}} */
export function createOrganizationThemePolicy() {
  const el = h('section', { class: 'stack editor-card themes-workspace-card' });
  const heading = h('h3', {
    class: 'field-label',
    text: t('settings.themes.workspace.title', 'Theme picker'),
  });
  const hint = h('p', {
    class: 'help',
    text: t(
      'settings.organization.themePolicyHint',
      'The stored list limits available themes. An empty stored list inherits the installation allowlist.',
    ),
  });
  const defaultLabel = h('label', {
    class: 'field-label',
    for: 'settings-default-theme',
    text: t('settings.themes.workspace.defaultTheme', 'Default theme'),
  });
  const defaultSelect = h('select', {
    class: 'form-input is-compact',
    id: 'settings-default-theme',
  });
  const visibleLabel = h('div', {
    class: 'field-label',
    text: t('settings.themes.workspace.visibleInPicker', 'Visible in picker'),
  });
  const inherit = h('input', { type: 'checkbox' });
  const inheritRow = h(
    'label',
    { class: 'row is-center gap-2 themes-inherit-row' },
    [
      inherit,
      h('span', {
        text: t(
          'settings.organization.inheritThemeList',
          'Use installation theme list',
        ),
      }),
    ],
  );
  const source = h('p', { class: 'help', role: 'status' });
  const visibleList = h('div', { class: 'themes-visible-list stack' });
  const error = createInlineError({ callout: true });
  const save = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  const actions = h('div', { class: 'row is-end settings-policy-actions' }, [
    save,
  ]);
  el.append(
    heading,
    hint,
    defaultLabel,
    defaultSelect,
    visibleLabel,
    inheritRow,
    source,
    visibleList,
    error.el,
    actions,
  );

  let allThemes = [];
  let checked = new Map();
  let loaded = false;
  let loading = false;
  let inheritedDefault = '';
  save.disabled = true;
  defaultSelect.disabled = true;
  inherit.disabled = true;

  function syncListState() {
    source.textContent = inherit.checked
      ? t(
          'settings.organization.themeListInherited',
          'The installation allowlist is in effect.',
        )
      : t(
          'settings.organization.themeListCustom',
          'This organization chooses its available themes.',
        );
    for (const [id, input] of checked) {
      const isDefault = id === (defaultSelect.value || inheritedDefault);
      input.disabled = !loaded || inherit.checked || isDefault;
      if (isDefault) input.checked = true;
    }
  }
  defaultSelect.addEventListener('change', syncListState);
  inherit.addEventListener('change', syncListState);

  async function load() {
    if (loaded || loading) return;
    loading = true;
    save.disabled = true;
    error.clear();
    try {
      const [themesResponse, org] = await Promise.all([
        api('/api/themes?all=1'),
        fetchOrgSettings({ maxAgeMs: 0 }),
      ]);
      allThemes = Array.isArray(themesResponse?.themes)
        ? themesResponse.themes
        : [];
      const effective = Array.isArray(themesResponse?.enabledThemes)
        ? themesResponse.enabledThemes
        : org?.enabledThemes || [];
      const enabled = new Set(effective.map((id) => String(id).toLowerCase()));
      inherit.checked =
        !Array.isArray(org?.enabledThemes) || org.enabledThemes.length === 0;
      const defaultId = String(
        org?.defaultThemeId ||
          allThemes.find((theme) => theme?.isDefault)?.id ||
          '',
      );
      inheritedDefault = String(
        allThemes.find((theme) => theme?.isDefault)?.id || '',
      );
      defaultSelect.replaceChildren(
        h('option', {
          value: '',
          text: t(
            'settings.organization.inheritDefault',
            'Installation default',
          ),
        }),
        ...allThemes.map((theme) =>
          h('option', { value: theme.id, text: theme.label || theme.id }),
        ),
      );
      defaultSelect.value =
        allThemes.some((theme) => theme.id === defaultId) && org?.defaultThemeId
          ? defaultId
          : '';
      checked = new Map();
      visibleList.replaceChildren();
      for (const theme of allThemes) {
        const isDefault =
          theme.id === (defaultSelect.value || inheritedDefault);
        const input = h('input', {
          type: 'checkbox',
          checked:
            enabled.size === 0 ||
            enabled.has(theme.id.toLowerCase()) ||
            isDefault,
          disabled: isDefault,
        });
        checked.set(theme.id, input);
        visibleList.append(
          h('label', { class: 'row is-center gap-2 themes-visible-row' }, [
            input,
            h('span', { text: theme.label || theme.id }),
          ]),
        );
      }
      loaded = true;
      defaultSelect.disabled = false;
      inherit.disabled = false;
      save.textContent = t('common.save', 'Save');
      syncListState();
    } catch (err) {
      error.show(err.message);
      save.textContent = t('common.retry', 'Retry');
      save.disabled = false;
    } finally {
      loading = false;
      if (loaded) save.disabled = false;
    }
  }

  save.addEventListener('click', async () => {
    if (!loaded) {
      await load();
      return;
    }
    error.clear();
    save.disabled = true;
    try {
      // Store explicit IDs. Empty is the installation fallback, not "all".
      const enabledThemes = inherit.checked
        ? []
        : [...checked].filter(([, input]) => input.checked).map(([id]) => id);
      await updateOrgSettings({
        defaultThemeId: defaultSelect.value || '',
        enabledThemes,
      });
      invalidateSettingsCache();
      toast.success(t('settings.saved', 'Saved.'));
    } catch (err) {
      error.show(err.message);
    } finally {
      save.disabled = !loaded;
    }
  });

  return { el, load };
}
