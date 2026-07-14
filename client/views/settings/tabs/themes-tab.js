/**
 * Themes Tab Component
 * Manage custom organization themes with live preview editor.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/toast.js';
import { api } from '../../../lib/api.js';
import { confirmModal } from '../../../lib/modal.js';
import { createThemeEditor } from '../theme-editor/index.js';

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
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-themes-btn',
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
      'Create and manage custom themes for your organization. Custom themes define colors, fonts, and logos for presentations.'
    ),
  });

  // Theme list container
  const themeListSection = h('div', { class: 'themes-list-section' });

  const listHeader = h('div', { class: 'themes-list-header row is-between is-center' });
  const listTitle = h('h3', {
    class: 'field-label',
    text: t('settings.themes.customThemes', 'Custom Themes'),
  });

  const createBtn = h('button', {
    class: 'btn btn-primary btn-sm',
    type: 'button',
    text: t('settings.themes.createTheme', 'Create Theme'),
  });

  listHeader.append(listTitle, createBtn);

  const themeList = h('div', { class: 'themes-grid' });
  const emptyState = h('div', { class: 'themes-empty-state' }, [
    h('p', { text: t('settings.themes.noThemes', 'No custom themes yet.') }),
    h('p', {
      class: 'help',
      text: t(
        'settings.themes.noThemesHint',
        'Create a custom theme to define your organization\'s brand colors and fonts.'
      ),
    }),
  ]);

  themeListSection.append(listHeader, themeList, emptyState);

  // Editor container (hidden by default)
  const editorSection = h('div', { class: 'theme-editor-section is-hidden' });

  // Assemble container
  container.append(title, description, themeListSection, editorSection);

  // State
  let themes = [];
  let loaded = false;
  let editorInstance = null;

  /**
   * Render the theme list.
   */
  function renderThemeList() {
    themeList.innerHTML = '';

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
    const nameRow = h('div', { class: 'theme-card-name-row row is-center gap-2' });
    const name = h('span', { class: 'theme-card-name', text: theme.label });
    nameRow.append(name);

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

    const editBtn = h('button', {
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
    moreBtn.innerHTML = '&#8942;'; // ⋮

    actions.append(editBtn, moreBtn);

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

    const menu = h('div', { class: 'theme-context-menu dropdown-menu is-open' });

    // Set as default
    if (!theme.isDefault) {
      const setDefaultItem = h('button', {
        class: 'dropdown-item',
        type: 'button',
        text: t('settings.themes.setAsDefault', 'Set as default'),
        onclick: async () => {
          menu.remove();
          await setDefaultTheme(theme.id);
        },
      });
      menu.append(setDefaultItem);
    } else {
      const clearDefaultItem = h('button', {
        class: 'dropdown-item',
        type: 'button',
        text: t('settings.themes.clearDefault', 'Clear default'),
        onclick: async () => {
          menu.remove();
          await clearDefaultTheme();
        },
      });
      menu.append(clearDefaultItem);
    }

    // Duplicate
    const duplicateItem = h('button', {
      class: 'dropdown-item',
      type: 'button',
      text: t('settings.themes.duplicate', 'Duplicate'),
      onclick: async () => {
        menu.remove();
        await duplicateTheme(theme);
      },
    });
    menu.append(duplicateItem);

    // Delete
    const deleteItem = h('button', {
      class: 'dropdown-item is-danger',
      type: 'button',
      text: t('common.delete', 'Delete'),
      onclick: async () => {
        menu.remove();
        await confirmDeleteTheme(theme);
      },
    });
    menu.append(deleteItem);

    // Position menu
    const rect = e.target.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    menu.style.zIndex = '1000';

    document.body.append(menu);

    // Close on outside click
    const closeMenu = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closeMenu, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', closeMenu, true);
    }, 0);
  }

  /**
   * Set a theme as default.
   * @param {string} themeId - Theme ID
   */
  async function setDefaultTheme(themeId) {
    try {
      await api(`/api/themes/custom/${themeId}/set-default`, { method: 'POST' });
      toast.success(t('settings.themes.setDefaultSuccess', 'Theme set as default.'));
      await loadThemes();
    } catch (err) {
      toast.error(String(err?.message || err));
    }
  }

  /**
   * Clear the default theme.
   */
  async function clearDefaultTheme() {
    try {
      await api('/api/themes/custom/clear-default', { method: 'POST' });
      toast.success(t('settings.themes.clearDefaultSuccess', 'Default theme cleared.'));
      await loadThemes();
    } catch (err) {
      toast.error(String(err?.message || err));
    }
  }

  /**
   * Duplicate a theme.
   * @param {Object} theme - Theme to duplicate
   */
  async function duplicateTheme(theme) {
    try {
      const newTheme = {
        label: `${theme.label} (Copy)`,
        colors: { ...theme.colors },
        fonts: { ...theme.fonts },
        logoUrl: theme.logoUrl,
        logoSmallUrl: theme.logoSmallUrl,
      };

      const result = await api('/api/themes/custom', {
        method: 'POST',
        body: JSON.stringify(newTheme),
      });

      toast.success(t('settings.themes.duplicateSuccess', 'Theme duplicated.'));
      await loadThemes();

      // Open editor for new theme
      openEditor(result);
    } catch (err) {
      toast.error(String(err?.message || err));
    }
  }

  /**
   * Confirm and delete a theme.
   * @param {Object} theme - Theme to delete
   */
  async function confirmDeleteTheme(theme) {
    const confirmed = await confirmModal(h, document.body, {
      title: t('common.delete', 'Delete'),
      message: t('settings.themes.deleteConfirm', `Delete theme "${theme.label}"? This cannot be undone.`),
      confirmLabel: t('common.delete', 'Delete'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      await api(`/api/themes/custom/${theme.id}`, { method: 'DELETE' });
      toast.success(t('settings.themes.deleteSuccess', 'Theme deleted.'));
      await loadThemes();
    } catch (err) {
      toast.error(String(err?.message || err));
    }
  }

  /**
   * Open the theme editor.
   * @param {Object|null} theme - Theme to edit, or null for new theme
   */
  function openEditor(theme = null) {
    themeListSection.classList.add('is-hidden');
    editorSection.classList.remove('is-hidden');
    editorSection.innerHTML = '';

    editorInstance = createThemeEditor({
      theme,
      onSave: async (themeData) => {
        try {
          if (theme?.id) {
            // Update existing
            await api(`/api/themes/custom/${theme.id}`, {
              method: 'PUT',
              body: JSON.stringify(themeData),
            });
            toast.success(t('settings.themes.updateSuccess', 'Theme updated.'));
          } else {
            // Create new
            await api('/api/themes/custom', {
              method: 'POST',
              body: JSON.stringify(themeData),
            });
            toast.success(t('settings.themes.createSuccess', 'Theme created.'));
          }
          await loadThemes();
          closeEditor();
        } catch (err) {
          toast.error(String(err?.message || err));
        }
      },
      onCancel: closeEditor,
    });

    editorSection.append(editorInstance.el);
  }

  /**
   * Close the theme editor.
   */
  function closeEditor() {
    editorSection.classList.add('is-hidden');
    themeListSection.classList.remove('is-hidden');
    editorSection.innerHTML = '';
    editorInstance = null;
  }

  /**
   * Load themes from API.
   */
  async function loadThemes() {
    try {
      const result = await api('/api/themes/custom');
      themes = result?.themes || [];
      renderThemeList();
    } catch (err) {
      toast.error(String(err?.message || err));
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
