/**
 * Fonts management tab for designers.
 * Lists font families and provides editor for creating/editing them.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { api } from '../../../lib/api.js';
import { toast } from '../../../lib/dom/toast.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { createFontEditor } from '../font-editor/index.js';

const SOURCE_LABELS = {
  upload: 'Upload',
  adobe: 'Adobe',
  monotype: 'Monotype',
  google: 'Google',
};

/**
 * Create the fonts tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {{ el: HTMLElement, load: Function }}
 */
export function createFontsTab({ user } = {}) {
  const el = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-fonts',
    role: 'tabpanel',
  });

  let families = [];

  // Layout containers
  const listSection = h('div', { class: 'font-families-list-section' });
  const editorSection = h('div', { class: 'font-editor-section is-hidden' });

  el.append(listSection, editorSection);

  // ─── Show list view ───────────────────────────────────────
  function showList() {
    listSection.classList.remove('is-hidden');
    editorSection.classList.add('is-hidden');
    editorSection.innerHTML = '';
  }

  // ─── Show editor view ─────────────────────────────────────
  function showEditor(fontFamily = null) {
    listSection.classList.add('is-hidden');
    editorSection.classList.remove('is-hidden');
    editorSection.innerHTML = '';

    const editor = createFontEditor({
      fontFamily,
      onSave: async (saved) => {
        await loadFamilies();
        showList();
      },
      onCancel: () => {
        showList();
      },
      onDelete: async () => {
        await loadFamilies();
        showList();
      },
    });

    editorSection.append(editor.el);
  }

  // ─── Load families from API ───────────────────────────────
  async function loadFamilies() {
    try {
      const result = await api('/api/font-families');
      families = result?.fontFamilies || [];
    } catch {
      families = [];
    }
    renderList();
  }

  // ─── Render the font families list ────────────────────────
  function renderList() {
    listSection.innerHTML = '';

    // Header
    const header = h('div', { class: 'row is-between is-center themes-list-header' });
    header.append(
      h('div', { class: 'stack' }, [
        h('h2', { text: t('fonts.title', 'Fonts') }),
        h('p', {
          class: 'help',
          text: t(
            'fonts.description',
            'Manage custom font families for use in themes. Upload font files, connect Adobe Fonts, fonts.com, or add Google Fonts.'
          ),
        }),
      ])
    );

    const addBtn = h('button', {
      class: 'btn btn-primary',
      type: 'button',
      text: t('fonts.addFamilyCta', '+ Add Font Family'),
      onclick: () => showEditor(null),
    });
    header.append(addBtn);
    listSection.append(header);

    if (families.length === 0) {
      const empty = h('div', { class: 'font-families-empty' });
      empty.append(
        h('p', { text: t('fonts.emptyTitle', 'No custom fonts yet') }),
        h('p', {
          class: 'help',
          text: t(
            'fonts.emptyDescription',
            'Add custom font families to use them in your themes.'
          ),
        })
      );
      listSection.append(empty);
      return;
    }

    // Grid
    const grid = h('div', { class: 'font-families-grid' });

    for (const family of families) {
      const card = h('div', { class: 'card font-family-card' });

      // Header with name and badge
      const cardHeader = h('div', { class: 'font-family-card-header' });

      const cardInfo = h('div', { class: 'font-family-card-info' });
      cardInfo.append(h('h3', { class: 'font-family-card-name', text: family.name }));

      const meta = h('div', { class: 'font-family-card-meta' });
      const badge = h('span', {
        class: 'font-source-badge',
        text: SOURCE_LABELS[family.source] || family.source,
      });
      badge.dataset.source = family.source;
      meta.append(badge);

      const variantCount = family.variants?.length || family.variantCount || 0;
      const variantText = t('fonts.variantCount', '{count} variant(s)', { count: variantCount });
      meta.append(h('span', { text: variantText }));
      meta.append(h('span', { text: family.category }));

      cardInfo.append(meta);
      cardHeader.append(cardInfo);

      // Preview text
      const preview = h('div', { class: 'font-preview-text' });
      preview.textContent = t('fonts.pangram', 'The quick brown fox jumps over the lazy dog');
      loadFontPreview(family, preview);

      // Actions
      const actions = h('div', { class: 'font-family-card-actions' });
      const editBtn = h('button', {
        class: 'btn btn-secondary is-compact',
        type: 'button',
        text: t('common.edit', 'Edit'),
        onclick: () => openEditor(family.id),
      });
      const deleteBtn = h('button', {
        class: 'btn btn-secondary is-compact is-danger',
        type: 'button',
        text: t('common.delete', 'Delete'),
        onclick: () => handleDelete(family),
      });
      actions.append(editBtn, deleteBtn);

      card.append(cardHeader, preview, actions);
      grid.append(card);
    }

    listSection.append(grid);
  }

  // ─── Load font preview for a card ─────────────────────────
  function loadFontPreview(family, previewEl) {
    if (family.source === 'upload') {
      // Inject @font-face rules for uploaded variants
      if (Array.isArray(family.variants) && family.variants.length > 0) {
        const styleId = `font-preview-upload-${family.id}`;
        if (!document.getElementById(styleId)) {
          const rules = family.variants
            .filter((v) => v.url)
            .map(
              (v) => `@font-face {
  font-family: '${family.name}';
  src: url('${v.url}') format('${v.format || 'woff2'}');
  font-weight: ${v.weight || 400};
  font-style: ${v.style || 'normal'};
  font-display: swap;
}`
            )
            .join('\n');
          if (rules) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = rules;
            document.head.appendChild(style);
          }
        }
      }
      previewEl.style.fontFamily = `'${family.name}', ${family.category || 'sans-serif'}`;
    } else if (family.source === 'adobe') {
      const projectId = family.sourceConfig?.projectId;
      if (projectId) {
        const linkId = `typekit-preview-${projectId}`;
        if (!document.getElementById(linkId)) {
          const link = document.createElement('link');
          link.id = linkId;
          link.rel = 'stylesheet';
          link.href = `https://use.typekit.net/${projectId}.css`;
          document.head.appendChild(link);
        }
        previewEl.style.fontFamily = `'${family.name}', ${family.category || 'sans-serif'}`;
      }
    } else if (family.source === 'google') {
      const spec = family.sourceConfig?.spec || family.name;
      const familyName = spec.split(':')[0].trim();
      const linkId = `gf-preview-${familyName.replace(/\s+/g, '-').toLowerCase()}`;
      if (!document.getElementById(linkId)) {
        const link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(familyName)}:wght@400;600;700&display=swap`;
        document.head.appendChild(link);
      }
      previewEl.style.fontFamily = `'${familyName}', ${family.category || 'sans-serif'}`;
    } else if (family.source === 'monotype') {
      const projectId = family.sourceConfig?.projectId;
      if (projectId) {
        const scriptId = `monotype-preview-${projectId}`;
        if (!document.getElementById(scriptId)) {
          const script = document.createElement('script');
          script.id = scriptId;
          script.src = `https://fast.fonts.net/jsapi/${projectId}.js`;
          document.head.appendChild(script);
        }
        previewEl.style.fontFamily = `'${family.name}', ${family.category || 'sans-serif'}`;
      }
    }
  }

  // ─── Open editor with full family data ────────────────────
  async function openEditor(familyId) {
    try {
      const family = await api(`/api/font-families/${familyId}`);
      showEditor(family);
    } catch (err) {
      toast.error(err.message || t('fonts.loadError', 'Failed to load font family.'));
    }
  }

  // ─── Delete family ────────────────────────────────────────
  async function handleDelete(family) {
    const confirmed = await confirmModal(h, document.body, {
      title: t('common.delete', 'Delete'),
      message: t('fonts.confirmDelete', 'Delete "{name}" and all its variants?', {
        name: family.name,
      }),
      confirmLabel: t('common.delete', 'Delete'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(`/api/font-families/${family.id}`, { method: 'DELETE' });
      toast.success(t('fonts.deleted', 'Font family deleted.'));
      await loadFamilies();
    } catch (err) {
      toast.error(err.message || t('fonts.deleteError', 'Failed to delete font family.'));
    }
  }

  // ─── Load function (called when tab becomes active) ───────
  const load = async () => {
    showList();
    await loadFamilies();
  };

  return { el, load };
}
