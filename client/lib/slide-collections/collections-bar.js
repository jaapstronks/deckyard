/**
 * Collections bar — the management surface shown above the slide library grid
 * in the sidebar view. Lists personal + team collections and drives their
 * create / rename / delete / manage-membership modals.
 *
 * Membership (adding a slide) is initiated from a library card's more-menu; the
 * host wires that to `openAddTo(item)` here so the chooser stays in one place.
 */

import { t } from '../ui-i18n.js';
import { h } from '../dom.js';
import { confirmModal } from '../modal.js';
import { toast } from '../toast.js';
import { createCollectionsApi } from './api.js';
import {
  openCollectionEditModal,
  openManageMembersModal,
  openAddToCollectionModal,
} from './collection-modals.js';

/**
 * @param {object} opts
 * @param {Function} opts.api - API client
 * @param {HTMLElement} opts.root - modal mount root (document.body typically)
 * @returns {{ el: HTMLElement, refresh: Function, openAddTo: Function }}
 */
export function createCollectionsBar({ api, root }) {
  const collectionsApi = createCollectionsApi({ api });

  const el = h('section', { class: 'collections-bar', 'aria-label': t('slideLibrary.collections.title', 'Collections') });
  const headerRow = h('div', { class: 'collections-bar-header' });
  const listWrap = h('div', { class: 'collections-bar-list' });
  el.append(headerRow, listWrap);

  let collections = { personal: [], team: [] };
  // Lazily-built id -> library item index for the manage-members modal.
  let slideIndex = null;

  const buildSlideIndex = async () => {
    if (slideIndex) return slideIndex;
    slideIndex = new Map();
    for (const scope of ['personal', 'team']) {
      try {
        const r = await api(`/api/slide-library/${scope}`);
        for (const it of Array.isArray(r?.items) ? r.items : []) {
          if (it?.id && !slideIndex.has(it.id)) slideIndex.set(it.id, { ...it, _scope: scope });
        }
      } catch {
        // Ignore; unresolved members degrade gracefully in the modal.
      }
    }
    return slideIndex;
  };

  const afterChange = async () => {
    slideIndex = null; // membership may have shifted; rebuild on next manage
    await refresh();
  };

  const renderHeader = () => {
    headerRow.innerHTML = '';
    headerRow.append(
      h('h3', { class: 'collections-bar-title', text: t('slideLibrary.collections.title', 'Collections') }),
      h('button', {
        class: 'btn btn-secondary is-compact',
        type: 'button',
        text: t('slideLibrary.collections.new', 'New collection'),
        onclick: () =>
          openCollectionEditModal({
            root,
            mode: 'create',
            collectionsApi,
            onSaved: () => {
              toast.success(t('slideLibrary.collections.created', 'Collection created.'));
              afterChange();
            },
          }),
      })
    );
  };

  const renderChip = (col) => {
    const chip = h('div', { class: 'collection-chip', 'data-id': col.id });
    const main = h('button', {
      class: 'collection-chip-main',
      type: 'button',
      title: t('slideLibrary.collections.manageTitle', 'Manage slides'),
      onclick: async () => {
        const index = await buildSlideIndex();
        openManageMembersModal({
          root,
          collection: col,
          resolveItem: (id) => index.get(id) || null,
          collectionsApi,
          onSaved: () => {
            toast.success(t('common.saved', 'Saved'));
            afterChange();
          },
        });
      },
    });
    main.append(h('span', { class: 'collection-chip-name', text: col.name || t('slideLibrary.preview.untitled', 'Untitled') }));
    if (col.scope === 'team') {
      main.append(h('span', { class: 'collection-chip-badge', text: t('slideLibrary.scope.team', 'Team') }));
    }
    main.append(
      h('span', {
        class: 'collection-chip-count',
        text: String(col.slideCount ?? (Array.isArray(col.slideIds) ? col.slideIds.length : 0)),
      })
    );

    const actions = h('div', { class: 'collection-chip-actions' });
    actions.append(
      h('button', {
        class: 'collection-chip-action',
        type: 'button',
        title: t('slideLibrary.collections.rename', 'Rename'),
        'aria-label': t('slideLibrary.collections.rename', 'Rename'),
        text: '✎',
        onclick: () =>
          openCollectionEditModal({
            root,
            mode: 'edit',
            collection: col,
            collectionsApi,
            onSaved: () => afterChange(),
          }),
      }),
      h('button', {
        class: 'collection-chip-action is-danger',
        type: 'button',
        title: t('common.delete', 'Delete'),
        'aria-label': t('common.delete', 'Delete'),
        text: '×',
        onclick: async () => {
          const ok = await confirmModal(h, root, {
            title: t('slideLibrary.collections.delete.title', 'Delete collection'),
            message: t('slideLibrary.collections.delete.confirm', 'Delete “{name}”? The slides themselves are not deleted.', { name: col.name || '' }),
            confirmLabel: t('common.delete', 'Delete'),
            danger: true,
          });
          if (!ok) return;
          try {
            await collectionsApi.remove(col.scope, col.id);
            toast.success(t('slideLibrary.collections.deleted', 'Collection deleted.'));
            afterChange();
          } catch (e) {
            toast.error(String(e?.message || e));
          }
        },
      })
    );

    chip.append(main, actions);
    return chip;
  };

  const renderList = () => {
    listWrap.innerHTML = '';
    const all = [...(collections.personal || []), ...(collections.team || [])];
    if (!all.length) {
      listWrap.append(
        h('div', {
          class: 'help collections-bar-empty',
          text: t('slideLibrary.collections.empty', 'Group reusable slides into a named, ordered collection to start decks from.'),
        })
      );
      return;
    }
    for (const col of all) listWrap.append(renderChip(col));
  };

  const render = () => {
    renderHeader();
    renderList();
  };

  async function refresh() {
    try {
      collections = await collectionsApi.listAll();
    } catch {
      collections = { personal: [], team: [] };
    }
    render();
  }

  /**
   * Open the "add this slide to a collection" chooser (called from a card menu).
   * @param {object} item - library item (may carry a `_scope` hint)
   */
  function openAddTo(item) {
    openAddToCollectionModal({
      root,
      item,
      collections,
      collectionsApi,
      onChanged: () => afterChange(),
    });
  }

  render();
  return { el, refresh, openAddTo };
}
