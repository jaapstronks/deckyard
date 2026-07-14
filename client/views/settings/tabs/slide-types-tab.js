/**
 * Slide Types curation tab for designers.
 * Shows custom slide types management and core type curation toggles.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { api } from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';
import { confirmModal } from '../../../lib/modal.js';
import { createSlideTypeEditor } from '../slide-type-editor/index.js';
import { renderSlideElement } from '../../../lib/slide-render.js';
import { getSampleContent } from '../../editor/slide-type-sample-content.js';
import { SLIDE_TYPES as BUNDLED_SLIDE_TYPES } from '../../../../shared/slide-types.js';
import { loadThemeById } from '../../../lib/theme.js';

/**
 * Slide type category definitions.
 * Matches the picker categories for familiarity.
 */
const CATEGORIES = [
  {
    key: 'basic',
    label: 'Basic',
    types: ['title-slide', 'chapter-title-slide', 'content-slide', 'quote-slide', 'lijstje-slide'],
  },
  {
    key: 'media',
    label: 'Media',
    types: [
      'image-text-slide', 'image-slide', 'gallery-slide', 'video-slide',
      'embed-slide', 'split-partner-title-slide', 'team-cards-slide', 'logo-wall-slide',
    ],
  },
  {
    key: 'layouts',
    label: 'Layouts',
    types: [
      'content-columns-slide', 'text-blocks-slide', 'card-stack-slide',
      'icon-card-grid-slide', 'freeform-slide',
    ],
  },
  {
    key: 'data',
    label: 'Data',
    types: [
      'table-slide', 'chart-slide', 'kpi-metrics-slide', 'comparison-slide',
      'matrix-slide', 'funnel-slide', 'pyramid-slide', 'cycle-slide',
    ],
  },
  {
    key: 'process',
    label: 'Process',
    types: ['process-slide', 'timeline-slide'],
  },
  {
    key: 'interaction',
    label: 'Interaction',
    types: [
      'poll-slide', 'likert-slide', 'likert-slider-slide',
      'feedback-slide', 'follow-invite-slide',
    ],
  },
  {
    key: 'other',
    label: 'Other',
    types: [
      'payoff-slide', 'lead-capture-slide',
    ],
  },
];

/**
 * Create the slide types curation tab.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {{ el: HTMLElement, load: Function }}
 */
export function createSlideTypesTab({ user } = {}) {
  const el = h('div', {
    class: 'settings-tab',
    id: 'settings-tab-slide-types',
    role: 'tabpanel',
  });

  let disabledTypes = new Set();
  let slideTypeMeta = {};
  let customTypes = [];
  let saveTimer = null;
  let currentTheme = null;

  // Section containers
  const customTypesSection = h('div', { class: 'custom-types-section' });
  const curationSection = h('div', { class: 'curation-section' });
  const editorSection = h('div', { class: 'slide-type-editor-section is-hidden' });

  const load = async () => {
    el.innerHTML = '';

    el.append(
      h('h2', { text: t('settings.slideTypes.title', 'Slide Types') }),
      h('p', {
        class: 'help',
        text: t(
          'settings.slideTypes.description',
          'Create custom slide types and control which types are available in the slide picker.'
        ),
      })
    );

    el.append(customTypesSection, editorSection, curationSection);

    try {
      // Load all data in parallel
      const [orgSettingsRes, typeMetaRes, customTypesRes, themesRes] = await Promise.all([
        api('/api/settings/organization'),
        api('/api/slide-types'),
        api('/api/custom-slide-types').catch(() => ({ customSlideTypes: [] })),
        api('/api/themes').catch(() => ({ themes: [] })),
      ]);

      const orgSettings = orgSettingsRes?.settings || {};
      disabledTypes = new Set(
        Array.isArray(orgSettings.disabledSlideTypes) ? orgSettings.disabledSlideTypes : []
      );
      slideTypeMeta = typeMetaRes || {};
      customTypes = customTypesRes?.customSlideTypes || [];
      const themes = Array.isArray(themesRes?.themes) ? themesRes.themes : [];
      const defaultThemeId = themes.find(t => t.isDefault)?.id || 'deckyard';
      currentTheme = await loadThemeById(defaultThemeId);

      renderCustomTypesSection();
      renderCatalog();
    } catch (err) {
      el.append(
        h('div', {
          class: 'help',
          text: t('settings.slideTypes.loadError', 'Failed to load slide type settings.'),
        })
      );
    }
  };

  // ============================================================
  // Custom Slide Types Section
  // ============================================================

  function renderCustomTypesSection() {
    customTypesSection.innerHTML = '';

    const sectionHeader = h('div', { class: 'themes-list-header row is-between is-center' });
    sectionHeader.append(
      h('h3', {
        class: 'field-label',
        text: t('settings.slideTypes.customTypes', 'Custom Slide Types'),
      }),
      h('button', {
        class: 'btn btn-primary btn-sm',
        type: 'button',
        text: t('settings.slideTypes.createType', 'Create Type'),
        onclick: () => openEditor(null),
      })
    );

    const grid = h('div', { class: 'custom-types-grid' });
    const emptyState = h('div', { class: 'custom-types-empty-state' }, [
      h('p', { text: t('settings.slideTypes.noCustomTypes', 'No custom slide types yet.') }),
      h('p', {
        class: 'help',
        text: t(
          'settings.slideTypes.noCustomTypesHint',
          'Create a custom slide type to define your own layout with fields, templates, and CSS.'
        ),
      }),
    ]);

    if (customTypes.length === 0) {
      emptyState.classList.remove('is-hidden');
      grid.classList.add('is-hidden');
    } else {
      emptyState.classList.add('is-hidden');
      grid.classList.remove('is-hidden');
      for (const ct of customTypes) {
        grid.append(createCustomTypeCard(ct));
      }
    }

    customTypesSection.append(sectionHeader, grid, emptyState);
  }

  /**
   * Create a card for a custom slide type.
   * @param {Object} ct - Custom slide type object
   * @returns {HTMLElement}
   */
  function createCustomTypeCard(ct) {
    const card = h('div', { class: 'custom-type-card editor-card' });

    // Header with name and status
    const cardHeader = h('div', { class: 'custom-type-card-header' });
    const name = h('span', { class: 'custom-type-card-name', text: ct.label });
    const statusBadge = h('span', {
      class: `slide-type-status-badge ${ct.isPublished ? 'is-published' : 'is-draft'}`,
      text: ct.isPublished
        ? t('settings.slideTypes.published', 'Published')
        : t('settings.slideTypes.draft', 'Draft'),
    });
    cardHeader.append(name, statusBadge);

    // Meta info
    const meta = h('div', { class: 'custom-type-card-meta' });
    meta.append(h('span', { class: 'custom-type-card-slug', text: ct.slug }));
    if (ct.baseType) {
      meta.append(h('span', {
        class: 'custom-type-card-base',
        text: t('settings.slideTypes.basedOn', 'Based on: {type}', { type: ct.baseType }),
      }));
    }

    // Actions
    const actions = h('div', { class: 'custom-type-card-actions' });
    const editBtn = h('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: t('common.edit', 'Edit'),
      onclick: () => openEditor(ct),
    });
    const moreBtn = h('button', {
      class: 'btn btn-secondary btn-sm btn-icon',
      type: 'button',
      'aria-label': t('common.more', 'More'),
      onclick: (e) => showCustomTypeMenu(e, ct),
    });
    moreBtn.innerHTML = '&#8942;';
    actions.append(editBtn, moreBtn);

    card.append(cardHeader, meta, actions);
    return card;
  }

  /**
   * Show context menu for a custom slide type.
   */
  function showCustomTypeMenu(e, ct) {
    e.stopPropagation();

    // Remove any existing menu
    const existing = document.querySelector('.custom-type-context-menu');
    if (existing) existing.remove();

    const menu = h('div', { class: 'custom-type-context-menu dropdown-menu is-open' });

    // Publish / Unpublish
    menu.append(h('button', {
      class: 'dropdown-item',
      type: 'button',
      text: ct.isPublished
        ? t('settings.slideTypes.unpublish', 'Unpublish')
        : t('settings.slideTypes.publish', 'Publish'),
      onclick: async () => {
        menu.remove();
        await togglePublish(ct);
      },
    }));

    // Duplicate
    menu.append(h('button', {
      class: 'dropdown-item',
      type: 'button',
      text: t('settings.slideTypes.duplicate', 'Duplicate'),
      onclick: async () => {
        menu.remove();
        await duplicateCustomType(ct);
      },
    }));

    // Delete
    menu.append(h('button', {
      class: 'dropdown-item is-danger',
      type: 'button',
      text: t('common.delete', 'Delete'),
      onclick: async () => {
        menu.remove();
        await confirmDeleteCustomType(ct);
      },
    }));

    // Position menu
    const rect = e.target.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    menu.style.zIndex = '1000';

    document.body.append(menu);

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

  async function togglePublish(ct) {
    try {
      await api(`/api/custom-slide-types/${ct.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isPublished: !ct.isPublished }),
      });
      toast.success(
        ct.isPublished
          ? t('settings.slideTypes.unpublished', 'Slide type unpublished.')
          : t('settings.slideTypes.publishedMsg', 'Slide type published.')
      );
      await reloadCustomTypes();
    } catch (err) {
      toast.error(String(err?.message || err));
    }
  }

  async function duplicateCustomType(ct) {
    try {
      await api(`/api/custom-slide-types/${ct.id}/duplicate`, { method: 'POST' });
      toast.success(t('settings.slideTypes.duplicateSuccess', 'Slide type duplicated.'));
      await reloadCustomTypes();
    } catch (err) {
      toast.error(String(err?.message || err));
    }
  }

  async function confirmDeleteCustomType(ct) {
    const confirmed = await confirmModal(h, document.body, {
      title: t('common.delete', 'Delete'),
      message: t('settings.slideTypes.deleteConfirm', `Delete custom type "${ct.label}"? This cannot be undone.`),
      confirmLabel: t('common.delete', 'Delete'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(`/api/custom-slide-types/${ct.id}`, { method: 'DELETE' });
      toast.success(t('settings.slideTypes.deleteSuccess', 'Slide type deleted.'));
      await reloadCustomTypes();
    } catch (err) {
      toast.error(String(err?.message || err));
    }
  }

  /**
   * Duplicate a core type as a new custom type.
   * @param {string} coreTypeKey
   * @param {Object} meta - Slide type metadata
   */
  function duplicateCoreType(coreTypeKey, meta) {
    const prefilled = {
      label: `Copy of ${meta?.label || coreTypeKey}`,
      baseType: coreTypeKey,
      fields: Array.isArray(meta?.fields) ? structuredClone(meta.fields) : [],
      defaults: meta?.defaults ? structuredClone(meta.defaults) : {},
    };
    openEditor(prefilled);
  }

  async function reloadCustomTypes() {
    try {
      const res = await api('/api/custom-slide-types');
      customTypes = res?.customSlideTypes || [];
      renderCustomTypesSection();
    } catch (err) {
      toast.error(String(err?.message || err));
    }
  }

  // ============================================================
  // Editor open/close
  // ============================================================

  function openEditor(slideType) {
    customTypesSection.classList.add('is-hidden');
    curationSection.classList.add('is-hidden');
    editorSection.classList.remove('is-hidden');
    editorSection.innerHTML = '';

    const editor = createSlideTypeEditor({
      slideType,
      coreTypes: slideTypeMeta,
      onSave: async (data) => {
        try {
          if (slideType?.id) {
            await api(`/api/custom-slide-types/${slideType.id}`, {
              method: 'PUT',
              body: JSON.stringify(data),
            });
            toast.success(t('settings.slideTypes.updateSuccess', 'Slide type updated.'));
          } else {
            await api('/api/custom-slide-types', {
              method: 'POST',
              body: JSON.stringify(data),
            });
            toast.success(t('settings.slideTypes.createSuccess', 'Slide type created.'));
          }
          await reloadCustomTypes();
          closeEditor();
        } catch (err) {
          toast.error(String(err?.message || err));
        }
      },
      onCancel: closeEditor,
    });

    editorSection.append(editor.el);
  }

  function closeEditor() {
    editorSection.classList.add('is-hidden');
    editorSection.innerHTML = '';
    customTypesSection.classList.remove('is-hidden');
    curationSection.classList.remove('is-hidden');
  }

  // ============================================================
  // Curation Section (core type toggles)
  // ============================================================

  const saveCuration = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await api('/api/settings/organization', {
          method: 'PATCH',
          body: JSON.stringify({ disabledSlideTypes: [...disabledTypes] }),
        });
        toast.success(t('settings.slideTypes.saved', 'Slide type settings saved.'));
      } catch {
        toast.error(t('settings.slideTypes.saveError', 'Failed to save settings.'));
      }
    }, 400);
  };

  const renderCatalog = () => {
    curationSection.innerHTML = '';

    curationSection.append(
      h('h3', {
        class: 'field-label',
        style: 'margin-top: var(--ps-space-5); padding-top: var(--ps-space-4); border-top: 1px solid hsl(var(--app-border-subtle));',
        text: t('settings.slideTypes.curation', 'Slide Type Curation'),
      }),
      h('p', {
        class: 'help',
        text: t(
          'settings.slideTypes.curationDescription',
          'Control which core slide types are available for new slides. Disabling a type hides it from the picker but existing slides remain unaffected.'
        ),
      })
    );

    // Track all categorized types
    const categorized = new Set();
    for (const cat of CATEGORIES) {
      for (const type of cat.types) categorized.add(type);
    }

    // Find uncategorized types from the metadata
    const uncategorized = Object.keys(slideTypeMeta)
      .filter(type => !categorized.has(type))
      .sort();

    // Build categories including any uncategorized types.
    // Merge uncategorized into the existing 'other' group to avoid duplicate headings.
    const allCategories = CATEGORIES.map(c => ({ ...c, types: [...c.types] }));
    if (uncategorized.length) {
      const otherCat = allCategories.find(c => c.key === 'other');
      if (otherCat) {
        otherCat.types.push(...uncategorized);
      } else {
        allCategories.push({ key: 'other', label: 'Other', types: uncategorized });
      }
    }

    // Collect all valid types across categories for lightbox navigation
    const allTypesList = [];
    for (const cat of allCategories) {
      for (const type of cat.types) {
        if (slideTypeMeta[type]) {
          allTypesList.push({ type, category: cat.key });
        }
      }
    }

    for (const cat of allCategories) {
      const validTypes = cat.types.filter(type => slideTypeMeta[type]);
      if (!validTypes.length) continue;

      const group = h('div', { class: 'slide-type-curation-group' });
      group.append(h('h3', {
        class: 'slide-type-curation-group-title',
        text: t(`settings.slideTypes.group.${cat.key}`, cat.label),
      }));

      const grid = h('div', { class: 'slide-type-curation-grid' });

      for (const type of validTypes) {
        grid.append(createCurationCard(type, allTypesList));
      }

      group.append(grid);
      curationSection.append(group);
    }
  };

  // ============================================================
  // Curation Thumbnails
  // ============================================================

  function createCurationThumbnail(type, className) {
    if (type === 'video-slide') {
      return createVideoMockup(className);
    }

    const sampleContent = getSampleContent(type, BUNDLED_SLIDE_TYPES, currentTheme);
    const slide = {
      id: `curation-${type}`,
      type,
      content: sampleContent,
      notes: '',
    };

    const thumbWrap = h('div', { class: `${className} thumb` });
    try {
      const el = renderSlideElement(slide, { mode: 'thumb', theme: currentTheme });
      thumbWrap.append(el);
    } catch {
      thumbWrap.classList.add('is-error');
      thumbWrap.append(h('div', { class: 'slide-type-curation-thumb-error', text: '?' }));
    }
    return thumbWrap;
  }

  function createVideoMockup(className) {
    const thumbWrap = h('div', { class: `${className} thumb is-video-mock` });
    const inner = h('div', { class: 'slide-type-curation-video-mock' });
    const frame = h('div', { class: 'slide-type-curation-video-frame' });
    const playBtn = h('div', { class: 'slide-type-curation-video-play' });
    playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    frame.append(playBtn);
    inner.append(frame);
    thumbWrap.append(inner);
    return thumbWrap;
  }

  // ============================================================
  // Curation Cards
  // ============================================================

  function createCurationCard(type, allTypesList) {
    const meta = slideTypeMeta[type];
    const label = meta?.label || type;
    const isEnabled = !disabledTypes.has(type);

    const card = h('div', {
      class: `slide-type-curation-card${isEnabled ? '' : ' is-disabled'}`,
      'data-type': type,
    });

    // Thumbnail — click opens lightbox
    const thumb = createCurationThumbnail(type, 'slide-type-curation-thumb');
    thumb.addEventListener('click', () => openTypePreview(type, allTypesList));
    card.append(thumb);

    // Info bar: label + checkbox
    const info = h('div', { class: 'slide-type-curation-info' });
    const labelEl = h('span', { class: 'slide-type-curation-label', text: label });
    const toggle = h('input', {
      type: 'checkbox',
      checked: isEnabled,
      'aria-label': t('settings.slideTypes.toggleType', 'Toggle {type}', { type: label }),
    });

    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        disabledTypes.delete(type);
        card.classList.remove('is-disabled');
      } else {
        disabledTypes.add(type);
        card.classList.add('is-disabled');
      }
      saveCuration();
    });

    info.append(labelEl, toggle);
    card.append(info);
    return card;
  }

  // ============================================================
  // Lightbox Preview
  // ============================================================

  function openTypePreview(type, allTypesList) {
    let currentIdx = allTypesList.findIndex(entry => entry.type === type);
    if (currentIdx < 0) currentIdx = 0;

    // Backdrop
    const backdrop = h('div', { class: 'slide-type-preview-backdrop' });

    // Modal
    const modal = h('div', { class: 'slide-type-preview-modal' });

    // Header
    const header = h('div', { class: 'slide-type-preview-header' });
    const titleWrap = h('div', { class: 'slide-type-preview-title-wrap' });
    const nameEl = h('span', { class: 'slide-type-preview-name' });
    const keyEl = h('span', { class: 'slide-type-preview-key' });
    titleWrap.append(nameEl, keyEl);

    const navWrap = h('div', { class: 'slide-type-preview-nav' });
    const prevBtn = h('button', {
      class: 'btn btn-secondary btn-sm btn-icon',
      type: 'button',
      'aria-label': t('common.previous', 'Previous'),
      onclick: () => navigate(-1),
    });
    prevBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;

    const counterEl = h('span', { class: 'slide-type-preview-counter' });

    const nextBtn = h('button', {
      class: 'btn btn-secondary btn-sm btn-icon',
      type: 'button',
      'aria-label': t('common.next', 'Next'),
      onclick: () => navigate(1),
    });
    nextBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;

    navWrap.append(prevBtn, counterEl, nextBtn);

    const closeBtn = h('button', {
      class: 'btn btn-secondary btn-sm btn-icon',
      type: 'button',
      'aria-label': t('common.close', 'Close'),
      onclick: close,
    });
    closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

    header.append(titleWrap, navWrap, closeBtn);

    // Stage
    const stage = h('div', { class: 'slide-type-preview-stage' });

    // Footer
    const footer = h('div', { class: 'slide-type-preview-footer' });
    const toggleLabel = h('label', { class: 'slide-type-preview-toggle' });
    const toggleCheckbox = h('input', { type: 'checkbox' });
    const toggleText = h('span', { text: t('settings.slideTypes.enabledInPicker', 'Enabled in picker') });
    toggleLabel.append(toggleCheckbox, toggleText);

    toggleCheckbox.addEventListener('change', () => {
      const entry = allTypesList[currentIdx];
      if (toggleCheckbox.checked) {
        disabledTypes.delete(entry.type);
      } else {
        disabledTypes.add(entry.type);
      }
      // Sync grid card
      const gridCard = curationSection.querySelector(`[data-type="${entry.type}"]`);
      if (gridCard) {
        gridCard.classList.toggle('is-disabled', !toggleCheckbox.checked);
        const gridToggle = gridCard.querySelector('input[type="checkbox"]');
        if (gridToggle) gridToggle.checked = toggleCheckbox.checked;
      }
      saveCuration();
    });

    const dupBtn = h('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: t('settings.slideTypes.duplicateAsCustom', 'Duplicate as custom type'),
      onclick: () => {
        const entry = allTypesList[currentIdx];
        const meta = slideTypeMeta[entry.type];
        close();
        duplicateCoreType(entry.type, meta);
      },
    });

    footer.append(toggleLabel, dupBtn);

    // Assemble
    modal.append(header, stage, footer);
    backdrop.append(modal);

    function renderCurrent() {
      const entry = allTypesList[currentIdx];
      const meta = slideTypeMeta[entry.type];

      nameEl.textContent = meta?.label || entry.type;
      keyEl.textContent = entry.type;
      counterEl.textContent = `${currentIdx + 1} / ${allTypesList.length}`;

      stage.innerHTML = '';
      stage.append(createCurationThumbnail(entry.type, 'slide-type-preview-thumb'));

      toggleCheckbox.checked = !disabledTypes.has(entry.type);
    }

    function navigate(delta) {
      currentIdx = (currentIdx + delta + allTypesList.length) % allTypesList.length;
      renderCurrent();
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') { close(); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { navigate(-1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { navigate(1); e.preventDefault(); }
    }

    function close() {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
    }

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    document.addEventListener('keydown', onKeyDown);
    document.body.append(backdrop);
    renderCurrent();
  }

  return { el, load };
}
