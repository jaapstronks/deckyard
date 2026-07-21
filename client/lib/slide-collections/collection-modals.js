/**
 * Modals for managing slide collections: create/edit, manage membership
 * (reorder + remove), and the "add a slide to a collection" chooser.
 *
 * All copy goes through t(); membership order is edited with the same
 * drag-to-reorder pattern the creation view's compose tray uses.
 */

import { t } from '../ui-i18n.js';
import { h } from '../dom.js';
import { createModal } from '../dom/modal.js';
import { toast } from '../dom/toast.js';

const SCOPES = ['personal', 'team'];

/**
 * Create or edit a collection's name, description and (on create) scope.
 * @param {object} opts
 * @param {HTMLElement} opts.root
 * @param {'create'|'edit'} opts.mode
 * @param {object} [opts.collection] - existing collection (edit mode)
 * @param {string} [opts.scope] - initial scope (create mode)
 * @param {string[]} [opts.seedSlideIds] - members to seed a new collection with
 * @param {object} opts.collectionsApi
 * @param {(collection: object) => void} opts.onSaved
 */
export function openCollectionEditModal({
  root,
  mode = 'create',
  collection = null,
  scope = 'personal',
  seedSlideIds = [],
  collectionsApi,
  onSaved,
}) {
  const isEdit = mode === 'edit';
  const initialScope = isEdit ? collection?.scope || 'personal' : scope;

  const modal = createModal(h, {
    title: isEdit
      ? t('slideLibrary.collections.edit.title', 'Edit collection')
      : t('slideLibrary.collections.new.title', 'New collection'),
    modalClass: 'collection-edit-modal',
    closeOnBackdrop: false,
  });

  const nameInput = h('input', {
    class: 'form-input',
    value: collection?.name || '',
    placeholder: t('slideLibrary.collections.namePlaceholder', 'Collection name'),
    'aria-label': t('slideLibrary.collections.nameLabel', 'Name'),
  });
  const descInput = h('textarea', {
    class: 'form-input',
    rows: '2',
    placeholder: t('slideLibrary.collections.descriptionPlaceholder', 'What is this collection for? (optional)'),
    'aria-label': t('slideLibrary.collections.descriptionLabel', 'Description'),
  });
  descInput.value = collection?.description || '';

  const fields = h('div', { class: 'stack gap-2' }, [
    h('label', { class: 'field-label', text: t('slideLibrary.collections.nameLabel', 'Name') }),
    nameInput,
    h('label', { class: 'field-label', text: t('slideLibrary.collections.descriptionLabel', 'Description') }),
    descInput,
  ]);

  // Scope is fixed once created (personal vs team live in different places).
  let scopeValue = initialScope;
  if (!isEdit) {
    const scopeRow = h('div', { class: 'sb-segmented collection-scope-select' });
    const scopeBtns = new Map();
    for (const s of SCOPES) {
      const btn = h('button', {
        type: 'button',
        class: `sb-segmented-btn ${s === scopeValue ? 'is-active' : ''}`,
        text:
          s === 'team'
            ? t('slideLibrary.scope.team', 'Team')
            : t('slideLibrary.scope.personal', 'Personal'),
        onclick: () => {
          scopeValue = s;
          for (const [key, b] of scopeBtns) b.classList.toggle('is-active', key === s);
        },
      });
      scopeBtns.set(s, btn);
      scopeRow.append(btn);
    }
    fields.append(
      h('label', { class: 'field-label', text: t('slideLibrary.collections.scopeLabel', 'Where') }),
      scopeRow
    );
  }

  const status = h('div', { class: 'help modal-status', text: '' });
  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('common.cancel', 'Cancel'),
    onclick: () => modal.close(),
  });
  const btnSave = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: isEdit ? t('common.save', 'Save') : t('common.create', 'Create'),
  });

  const save = async () => {
    const name = String(nameInput.value || '').trim();
    if (!name) {
      status.textContent = t('slideLibrary.collections.nameRequired', 'Give the collection a name.');
      nameInput.focus();
      return;
    }
    const description = String(descInput.value || '').trim();
    btnSave.disabled = true;
    modal.setBusy(true);
    status.textContent = t('common.saving', 'Saving…');
    try {
      let saved;
      if (isEdit) {
        saved = await collectionsApi.update(collection.scope, collection.id, { name, description });
      } else {
        saved = await collectionsApi.create(scopeValue, {
          name,
          description,
          slideIds: Array.isArray(seedSlideIds) ? seedSlideIds : [],
        });
      }
      modal.close();
      onSaved?.(saved);
    } catch (e) {
      modal.setBusy(false);
      btnSave.disabled = false;
      status.textContent = String(e?.message || e);
    }
  };
  btnSave.addEventListener('click', save);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });

  const actions = h('div', { class: 'row is-end is-mt-8 modal-actions' }, [btnCancel, btnSave]);
  modal.content.append(fields, status, actions);
  modal.show(root);
  setTimeout(() => nameInput.focus(), 0);
}

/**
 * Manage a collection's ordered membership: reorder by drag, remove members.
 * @param {object} opts
 * @param {HTMLElement} opts.root
 * @param {object} opts.collection
 * @param {(id: string) => object|null} opts.resolveItem - id -> library item
 * @param {object} opts.collectionsApi
 * @param {(collection: object) => void} opts.onSaved
 */
export function openManageMembersModal({ root, collection, resolveItem, collectionsApi, onSaved }) {
  // Working copy of the ordered ids; committed on Save.
  let order = Array.isArray(collection?.slideIds) ? collection.slideIds.slice() : [];

  const modal = createModal(h, {
    title: t('slideLibrary.collections.manage.title', 'Manage slides · {name}', {
      name: collection?.name || '',
    }),
    modalClass: 'collection-members-modal',
    closeOnBackdrop: false,
  });

  const listWrap = h('div', { class: 'collection-members-list' });
  const status = h('div', { class: 'help modal-status', text: '' });

  const renderList = () => {
    listWrap.innerHTML = '';
    if (!order.length) {
      listWrap.append(
        h('div', {
          class: 'help',
          text: t('slideLibrary.collections.manage.empty', 'No slides in this collection yet. Add slides from a card’s menu.'),
        })
      );
      return;
    }
    order.forEach((id, index) => {
      const item = resolveItem?.(id) || null;
      const row = h('div', {
        class: `collection-member-row ${item ? '' : 'is-unavailable'}`,
        draggable: 'true',
        'data-id': id,
      });
      const name = item
        ? item.name || item.slideType || t('slideLibrary.preview.untitled', 'Untitled')
        : t('slideLibrary.collections.manage.unavailable', 'Unavailable slide');
      row.append(
        h('span', { class: 'collection-member-order', text: String(index + 1) }),
        h('span', { class: 'collection-member-name', text: name }),
        h('button', {
          type: 'button',
          class: 'collection-member-remove',
          'aria-label': t('common.remove', 'Remove'),
          text: '×',
          onclick: () => {
            order = order.filter((x) => x !== id);
            renderList();
          },
        })
      );

      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === id) return;
        const from = order.indexOf(draggedId);
        const to = order.indexOf(id);
        if (from < 0 || to < 0) return;
        order.splice(from, 1);
        order.splice(to, 0, draggedId);
        renderList();
      });

      listWrap.append(row);
    });
  };

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('common.cancel', 'Cancel'),
    onclick: () => modal.close(),
  });
  const btnSave = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('common.save', 'Save'),
    onclick: async () => {
      btnSave.disabled = true;
      modal.setBusy(true);
      status.textContent = t('common.saving', 'Saving…');
      try {
        const saved = await collectionsApi.update(collection.scope, collection.id, { slideIds: order });
        modal.close();
        onSaved?.(saved);
      } catch (e) {
        modal.setBusy(false);
        btnSave.disabled = false;
        status.textContent = String(e?.message || e);
      }
    },
  });

  const hint = h('div', {
    class: 'help modal-hint',
    text: t('slideLibrary.collections.manage.hint', 'Drag to reorder. This order is used when you start a deck from the collection.'),
  });
  const actions = h('div', { class: 'row is-end is-mt-8 modal-actions' }, [btnCancel, btnSave]);
  modal.content.append(hint, listWrap, status, actions);
  renderList();
  modal.show(root);
}

/**
 * Choose which collection to add a slide to (or create a new one seeded with it).
 * @param {object} opts
 * @param {HTMLElement} opts.root
 * @param {object} opts.item - the library item being added
 * @param {{personal: object[], team: object[]}} opts.collections
 * @param {object} opts.collectionsApi
 * @param {() => void} [opts.onChanged] - called after a successful add/create
 */
export function openAddToCollectionModal({ root, item, collections, collectionsApi, onChanged }) {
  const modal = createModal(h, {
    title: t('slideLibrary.collections.addTo.title', 'Add to collection'),
    modalClass: 'collection-add-modal',
    closeOnBackdrop: true,
  });

  const all = [...(collections?.personal || []), ...(collections?.team || [])];

  const listWrap = h('div', { class: 'collection-add-list' });
  const status = h('div', { class: 'help modal-status', text: '' });

  if (!all.length) {
    listWrap.append(
      h('div', {
        class: 'help',
        text: t('slideLibrary.collections.addTo.none', 'No collections yet. Create one to hold this slide.'),
      })
    );
  }

  for (const col of all) {
    const isMember = Array.isArray(col.slideIds) && col.slideIds.includes(item.id);
    const btn = h('button', {
      class: 'collection-add-item',
      type: 'button',
      disabled: isMember,
    });
    btn.append(
      h('span', { class: 'collection-add-item-name', text: col.name || t('slideLibrary.preview.untitled', 'Untitled') }),
      h('span', {
        class: 'collection-add-item-meta',
        text: isMember
          ? t('slideLibrary.collections.addTo.alreadyIn', 'Already in')
          : (col.scope === 'team'
              ? t('slideLibrary.scope.team', 'Team')
              : t('slideLibrary.scope.personal', 'Personal')),
      })
    );
    btn.addEventListener('click', async () => {
      status.textContent = t('common.saving', 'Saving…');
      try {
        const { added } = await collectionsApi.addSlide(col, item.id);
        modal.close();
        if (added) {
          toast.success(t('slideLibrary.collections.addTo.done', 'Added to “{name}”.', { name: col.name || '' }));
          onChanged?.();
        }
      } catch (e) {
        status.textContent = String(e?.message || e);
      }
    });
    listWrap.append(btn);
  }

  const btnNew = h('button', {
    class: 'btn btn-secondary is-full',
    type: 'button',
    text: t('slideLibrary.collections.addTo.createNew', 'New collection with this slide…'),
    onclick: () => {
      modal.close();
      openCollectionEditModal({
        root,
        mode: 'create',
        scope: item?._scope === 'team' ? 'team' : 'personal',
        seedSlideIds: [item.id],
        collectionsApi,
        onSaved: () => {
          toast.success(t('slideLibrary.collections.created', 'Collection created.'));
          onChanged?.();
        },
      });
    },
  });

  modal.content.append(listWrap, h('div', { class: 'is-mt-8' }, [btnNew]), status);
  modal.show(root);
}
