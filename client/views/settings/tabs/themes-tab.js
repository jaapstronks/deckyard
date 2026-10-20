/**
 * Themes Tab Component
 * Manage organization themes and inspect the available seeds.
 */

import { h } from '../../../lib/dom/index.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { api } from '../../../lib/api.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { planRowRemoval } from '../../../lib/dom/row-removal.js';
import { isOrganizationAdmin } from '../../../../shared/organization-role.js';
import { createThemeEditor } from '../theme-editor/index.js';
import { invalidateTheme } from '../../../lib/theme/theme.js';
import { createEmptyState } from '../../../lib/dom/empty-state.js';
import { icon } from '../../../lib/dom/icons.js';

/**
 * Create the themes tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createThemesTab({ user }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-themes',
    'data-tab': 'themes',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.themes', 'Themes'),
  });

  const description = h('p', {
    class: 'settings-tab-description',
    text: t(
      'settings.themes.description',
      'Choose from built-in themes or create a theme for your organization.',
    ),
  });

  const policyLink = h('a', {
    class: 'btn btn-secondary',
    href: '/settings#organization',
    text: t('settings.themes.organizationPolicy', 'Organization theme policy'),
  });

  // Theme list container
  const themeListSection = h('div', { class: 'themes-list-section' });

  const listHeader = h('div', {
    class: 'themes-list-header row is-between is-center',
  });
  const listTitle = h('h3', {
    class: 'field-label',
    text: t('settings.themes.customThemes', 'Available themes'),
  });

  const createBtn = h('button', {
    class: 'btn btn-primary btn-sm',
    type: 'button',
    text: t('settings.themes.createTheme', 'Create Theme'),
  });

  listHeader.append(listTitle, createBtn);

  const themeList = h('div', { class: 'themes-grid' });
  const emptyState = createEmptyState({
    icon: null,
    className: 'empty-state-panel',
    title: t('settings.themes.noThemes', 'No themes available.'),
    message: t(
      'settings.themes.noThemesHint',
      'Create a theme for your organization.',
    ),
  });

  themeListSection.append(listHeader, themeList, emptyState);

  // Editor container (hidden by default)
  const editorSection = h('div', { class: 'theme-editor-section is-hidden' });

  // Assemble container
  container.append(
    title,
    description,
    ...(isOrganizationAdmin(user) ? [policyLink] : []),
    themeListSection,
    editorSection,
  );

  // State
  let themes = [];
  let loaded = false;
  let editorInstance = null;

  /**
   * Render the theme list.
   */
  function renderThemeList() {
    themeList.replaceChildren();

    if (themes.length === 0) {
      emptyState.classList.remove('is-hidden');
      themeList.classList.add('is-hidden');
      return;
    }

    emptyState.classList.add('is-hidden');
    themeList.classList.remove('is-hidden');

    for (const theme of themes) {
      const card = createThemeCard(theme);
      themeList.append(card);
    }
  }

  /**
   * Create a theme card.
   * @param {Object} theme - Theme object
   * @returns {HTMLElement}
   */
  function createThemeCard(theme) {
    const card = h('div', { class: 'theme-card editor-card' });

    // Preview swatch
    const preview = h('div', { class: 'theme-card-preview' });
    const primaryColor = theme.colors?.primary || '#3B82F6';
    const bgColor = theme.colors?.background || '#ffffff';
    preview.style.background = `linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor} 50%, ${bgColor} 50%, ${bgColor} 100%)`;

    if (theme.logoUrl) {
      const logo = h('img', {
        class: 'theme-card-logo',
        src: theme.logoUrl,
        alt: theme.label,
      });
      preview.append(logo);
    }

    // Theme info
    const info = h('div', { class: 'theme-card-info' });
    const nameRow = h('div', {
      class: 'theme-card-name-row row is-center gap-2',
    });
    const name = h('span', { class: 'theme-card-name', text: theme.label });
    nameRow.append(name);

    if (theme.source === 'seed') {
      nameRow.append(
        h('span', {
          class: 'badge',
          text: t('settings.themes.seed', 'Built-in'),
        }),
      );
    }

    if (theme.isDefault) {
      const defaultBadge = h('span', {
        class: 'badge badge-primary',
        text: t('settings.themes.default', 'Default'),
      });
      nameRow.append(defaultBadge);
    }

    const fonts = h('div', { class: 'theme-card-fonts help' });
    fonts.textContent = `${theme.fonts?.heading || 'Inter'} / ${theme.fonts?.body || 'Inter'}`;

    info.append(nameRow, fonts);

    // Actions
    const actions = h('div', { class: 'theme-card-actions row gap-2' });

    const editBtn =
      theme.source === 'seed'
        ? null
        : h('button', {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            text: t('common.edit', 'Edit'),
            onclick: () => openEditor(theme),
          });

    const moreBtn = h('button', {
      class: 'btn btn-secondary btn-sm btn-icon',
      type: 'button',
      'aria-label': t('common.more', 'More'),
      onclick: (e) => showThemeMenu(e, theme),
    });
    moreBtn.append(icon('ellipsis-vertical'));

    if (editBtn) actions.append(editBtn);
    actions.append(moreBtn);

    card.append(preview, info, actions);
    return card;
  }

  /**
   * Show context menu for theme actions.
   * @param {Event} e - Click event
   * @param {Object} theme - Theme object
   */
  function showThemeMenu(e, theme) {
    e.stopPropagation();

    // Remove any existing menu
    const existingMenu = document.querySelector('.theme-context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = h('div', {
      class: 'theme-context-menu dropdown-menu is-open',
    });

    // Single teardown: removes the node AND the outside-click listener. Every
    // item calls this, so clicking one doesn't leave the pointerdown handler
    // bound to document (the leak #343 left out of scope).
    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
    const onPointerDown = (ev) => {
      if (!menu.contains(ev.target)) closeMenu();
    };

    // Duplicate
    const duplicateItem = h('button', {
      class: 'dropdown-item',
      type: 'button',
      text: t('settings.themes.duplicate', 'Duplicate'),
      onclick: async () => {
        closeMenu();
        await duplicateTheme(theme);
      },
    });
    menu.append(duplicateItem);

    // The PPTX template: a starting document on this theme's layouts. A plain
    // link, because the answer is an attachment and the browser is better at
    // saving one than any fetch-and-revoke dance would be (B274).
    const templateItem = h('a', {
      class: 'dropdown-item',
      href: `/api/themes/${theme.id}/template.pptx`,
      download: '',
      text: t('settings.themes.downloadTemplate', 'Download PPTX template'),
      onclick: closeMenu,
    });
    menu.append(templateItem);

    if (theme.source !== 'seed') {
      const deleteItem = h('button', {
        class: 'dropdown-item is-danger',
        type: 'button',
        text: t('common.delete', 'Delete'),
        onclick: async () => {
          closeMenu();
          await confirmDeleteTheme(theme);
        },
      });
      menu.append(deleteItem);
    }

    // Position menu
    const rect = e.target.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    menu.style.zIndex = '1000';

    document.body.append(menu);

    // Close on outside click (teardown defined above, next to the menu node).
    setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
    }, 0);
  }

  /**
   * Duplicate a theme.
   * @param {Object} theme - Theme to duplicate
   */
  async function duplicateTheme(theme) {
    try {
      const original = await api(`/api/themes/${theme.id}`);
      const newTheme = {
        label: `${theme.label} (Copy)`,
        colors: { ...original.colors },
        fonts: { ...original.fonts },
        logoUrl: original.logoUrl,
        logoSmallUrl: original.logoSmallUrl,
        // The whole theme, not the four colours and two fonts: a copy that
        // dropped the surfaces, variants and logos was a different theme.
        config: original.config,
      };

      const result = await api('/api/themes', {
        method: 'POST',
        body: newTheme,
      });

      await loadThemes();

      // Open editor for new theme
      openEditor(result);
    } catch (err) {
      toast.error(err);
    }
  }

  /**
   * Confirm and delete a theme.
   * @param {Object} theme - Theme to delete
   */
  async function confirmDeleteTheme(theme) {
    const confirmed = await confirmModal(document.body, {
      title: t('common.delete', 'Delete'),
      message: t(
        'settings.themes.deleteConfirm',
        'Delete theme "{label}"? This cannot be undone.',
        {
          label: theme.label,
        },
      ),
      confirmLabel: t('common.delete', 'Delete'),
      danger: true,
    });
    if (!confirmed) return;

    // The delete button lived in the card that is about to go, so focus has to
    // be put back in the list by hand (B647).
    const land = planRowRemoval(themeList, {
      index: themes.findIndex((x) => x.id === theme.id),
      fallback: createBtn,
    });

    try {
      await api(`/api/themes/${theme.id}`, { method: 'DELETE' });
      invalidateTheme(theme.id);
      await loadThemes();
      land(t('common.rowRemoved', '{label} removed.', { label: theme.label }));
    } catch (err) {
      toast.error(err);
    }
  }

  /**
   * Open the theme editor.
   * @param {Object|null} theme - Theme to edit, or null for new theme
   */
  async function openEditor(theme = null) {
    // The list response is a summary. Saving it as a full record would erase
    // config and the small logo, which only the record endpoint returns.
    if (theme?.id) {
      try {
        theme = await api(`/api/themes/${theme.id}`);
      } catch (err) {
        toast.error(err);
        return;
      }
    }
    policyLink.classList.add('is-hidden');
    themeListSection.classList.add('is-hidden');
    editorSection.classList.remove('is-hidden');
    editorSection.replaceChildren();

    editorInstance = createThemeEditor({
      theme,
      // No catch here: a refusal of this save is a state of the editor's form,
      // and the editor is what has a place to put it — beside its own Save,
      // on the control `details.field` names. Rejecting is how it gets there
      // (docs/reference/feedback-surfaces.md; the same shape as the slide-type
      // editor's `onSave`).
      onSave: async (themeData) => {
        if (theme?.id) {
          // Update existing
          await api(`/api/themes/${theme.id}`, {
            method: 'PUT',
            body: themeData,
          });
          // Drop the cached copy (here and in other tabs) so decks on this
          // theme pick the change up without a reload.
          invalidateTheme(theme.id);
          toast.success(t('settings.themes.updateSuccess', 'Theme updated.'));
        } else {
          // Create new
          await api('/api/themes', {
            method: 'POST',
            body: themeData,
          });
        }
        await loadThemes();
        closeEditor();
      },
      onCancel: closeEditor,
    });

    editorSection.append(editorInstance.el);
  }

  /**
   * Close the theme editor.
   */
  function closeEditor() {
    try {
      editorInstance?.detach?.();
    } catch {
      /* teardown must not block closing the editor */
    }
    editorSection.classList.add('is-hidden');
    policyLink.classList.remove('is-hidden');
    themeListSection.classList.remove('is-hidden');
    editorSection.replaceChildren();
    editorInstance = null;
  }

  /**
   * Load themes from API.
   */
  async function loadThemes() {
    try {
      const result = await api('/api/themes?all=1');
      themes = result?.themes || [];
      renderThemeList();
    } catch (err) {
      toast.error(err);
      themes = [];
      renderThemeList();
    }
  }

  // Event listeners
  createBtn.addEventListener('click', () => openEditor(null));

  // Public interface
  const load = async () => {
    if (loaded) return;
    loaded = true;
    await loadThemes();
  };

  return {
    el: container,
    load,
  };
}
