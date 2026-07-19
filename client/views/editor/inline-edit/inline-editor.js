/**
 * WYSIWYG inline editor overlay for the slide preview.
 *
 * Lets users click directly on rendered slide text and type in place, add empty
 * optional fields via ghost affordances, and add/remove repeatable cards - all
 * on top of the existing (form-based) editor, which remains the full-power path.
 *
 * Design notes:
 * - The preview lives in the same document (no iframe), so we attach directly.
 * - `mountSlideInto()` wipes the thumb on every rerender, so all decoration
 *   (ghosts, card buttons, hover class) is re-applied in `refresh()`, which the
 *   controller calls after each mount - the same pattern as comment markers.
 * - Plain string fields are edited in place with contentEditable. To avoid the
 *   rerender wiping an active edit, the controller skips `rerenderPreview()`
 *   while `isEditing()` is true, and commits trigger a *deferred* rerender that
 *   is cancelled if the user immediately starts editing another field.
 * - Markdown fields open a modal with the canonical markdown editor (toolbar +
 *   dimmed backdrop) instead of editing the rendered HTML in place.
 *
 * Only slide types with a descriptor (see ./descriptors.js) and renderer
 * `data-inline-field` attributes participate; everything else is untouched.
 */

import { getInlineDescriptor } from './descriptors.js';
import { getByPath, setByPath, fieldMetaForPath, isEmptyValue } from './field-path.js';
import { computeDrop, resolveMove } from './reorder-geometry.js';
import { createInlineOverlay } from './overlay.js';
import { createInlineCoachMark } from './coach-mark.js';
import { openMediaPopover } from './media-popover.js';
import { openIconPicker } from '../fields/icon-picker-modal.js';
import { installDismissOnOutside } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { createBasicFields } from '../fields/basic.js';
import { createCsvGridEditor } from '../fields/csv-grid.js';
import { getCollectionKey } from '../../../../shared/slide-types/helpers.js';

/**
 * @param {Object} opts
 * @param {Function} opts.h - DOM helper
 * @param {HTMLElement} opts.thumb - the preview slide container (stable element)
 * @param {HTMLElement} [opts.overlayHost] - host for the markdown modal + backdrop
 *   (defaults to the thumb's stage). A larger host (the preview panel) makes the
 *   modal read clearly as a separate mode rather than part of the slide.
 * @param {Function} opts.getSlide - () => current slide object (or undefined)
 * @param {Function} opts.getSlideDef - (type) => SLIDE_TYPES[type]
 * @param {Function} opts.getCanEdit - () => boolean (lock / author gate)
 * @param {Function} opts.markDirty
 * @param {Function} [opts.requestSave]
 * @param {Function} opts.rerenderPreview - full preview remount + refresh()
 * @param {Function} [opts.rerenderEditor] - rebuild the side form (thumb-safe)
 * @param {Function} [opts.convertSlideType] - (toType, {openMedia}) => Promise<boolean>;
 *   runs the shared convert action for the selected slide (descriptor `convert`)
 * @param {Function} [opts.canConvertSlideTo] - (slide, toType) => boolean
 */
export function createInlineEditor({
  h,
  thumb,
  previewStage,
  overlayHost,
  getSlide,
  getSlideDef,
  getCanEdit,
  isCommentAddMode,
  markDirty,
  requestSave,
  rerenderPreview,
  rerenderEditor,
  openImagePicker,
  pres,
  normalizeLang,
  convertSlideType,
  canConvertSlideTo,
} = {}) {
  if (!thumb)
    return {
      refresh() {},
      isEditing: () => false,
      destroy() {},
      openMediaByIndex() {},
    };

  // Sentinel written to a field while a ghost-spawned edit is in progress: it
  // makes the renderer emit the field's real element (correct tag/class/size)
  // while rendering as nothing. Never persisted: commit/cancel replace it.
  const NEW_FIELD_SENTINEL = '\u200B'; // zero-width space

  const mdHost = overlayHost || previewStage || thumb;
  // Reuse the canonical markdown editor (toolbar: bold/italic/link/heading/…).
  const { fieldMarkdown: mdField } = createBasicFields({ h });

  // Affordances render on this unscaled overlay so they stay crisp / real-sized
  // instead of being shrunk with the transform-scaled slide. See overlay.js.
  const overlay = createInlineOverlay({ h, thumb });
  // One-time "click any text to edit" hint, anchored to the slide canvas.
  const coach = createInlineCoachMark({ h, stage: previewStage || thumb.parentElement });
  // field element -> its dashed outline box, for the stronger direct-hover.
  const outlineByField = new WeakMap();
  let hotField = null;
  let repositionRaf = 0;

  /** @type {null | {el:HTMLElement, path:string, meta:Object, original:string, isNew:boolean}} */
  let editing = null;
  let pendingRerenderRaf = 0;
  let closeMarkdownModal = null;
  /** @type {null | {close:Function, reposition:Function}} */
  let mediaPopover = null;

  const slideEl = () => thumb.querySelector('.slide');
  const currentDef = () => {
    const slide = getSlide?.();
    return slide ? getSlideDef?.(slide.type) || null : null;
  };

  // ----------------------------------------------------------------
  // Deferred rerender (so switching fields stays smooth, see header)
  // ----------------------------------------------------------------
  function scheduleCommitRerender() {
    cancelCommitRerender();
    pendingRerenderRaf = requestAnimationFrame(() => {
      pendingRerenderRaf = 0;
      if (editing) return; // a new edit started; leave the DOM alone
      rerenderPreview?.();
    });
  }
  function cancelCommitRerender() {
    if (pendingRerenderRaf) {
      cancelAnimationFrame(pendingRerenderRaf);
      pendingRerenderRaf = 0;
    }
  }

  // ----------------------------------------------------------------
  // Plain-string in-place editing
  // ----------------------------------------------------------------
  function normalizeText(raw, meta) {
    let v = String(raw ?? '').replace(/\s*\n+\s*/g, ' ');
    if (typeof meta?.maxLength === 'number' && v.length > meta.maxLength) {
      v = v.slice(0, meta.maxLength);
    }
    return v;
  }

  function onEditKeydown(e) {
    if (!editing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      editing.el.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editing.cancel = true;
      editing.el.blur();
    }
  }

  function onEditInput() {
    if (!editing) return;
    const { meta } = editing;
    // Enforce single-line + maxLength live without fighting the caret when under.
    if (typeof meta?.maxLength === 'number') {
      const text = editing.el.textContent || '';
      if (text.length > meta.maxLength) {
        editing.el.textContent = text.slice(0, meta.maxLength);
        placeCaretAtEnd(editing.el);
      }
    }
    overlay.reposition(); // keep the active ring on the field as it grows
  }

  function beginTextEdit(el, path, meta, { isNew = false } = {}) {
    if (editing) endTextEdit();
    cancelCommitRerender();
    const slide = getSlide?.();
    if (!slide) return;
    const raw = isNew ? '' : String(getByPath(slide.content, path) ?? '');
    editing = { el, path, meta, original: raw, isNew, cancel: false, slideId: slide.id };
    setHotField(null);
    el.setAttribute('contenteditable', 'plaintext-only');
    el.classList.add('ie-editing');
    // Swap the affordances for a single active ring that tracks this field.
    overlay.clear();
    const ring = overlay.outline(el);
    ring.classList.add('is-active');
    overlay.reposition();
    // Seed with the raw stored value (not the rendered text, which may differ
    // due to transforms like curly quotes or single-line collapsing).
    el.textContent = raw;
    el.addEventListener('keydown', onEditKeydown);
    el.addEventListener('input', onEditInput);
    el.addEventListener('blur', endTextEdit, { once: true });
    el.focus();
    placeCaretAtEnd(el);
  }

  function endTextEdit() {
    if (!editing) return;
    const { el, path, meta, original, isNew, cancel } = editing;
    el.removeEventListener('keydown', onEditKeydown);
    el.removeEventListener('input', onEditInput);
    el.removeAttribute('contenteditable');
    el.classList.remove('ie-editing');
    const done = editing;
    editing = null;

    if (cancel) {
      // Restore and rerender to drop any ghost-spawned placeholder.
      if (isNew) {
        clearSentinel(path);
        scheduleCommitRerender();
      } else {
        el.textContent = original;
        refresh(); // restore affordances the active ring replaced
      }
      return;
    }

    const value = normalizeText(el.textContent, meta);
    // Commit to the slide the edit STARTED on, never the current selection:
    // a collaborator can delete the edited slide mid-edit (live collab), which
    // makes the selection fall back to another slide — resolving via
    // getSlide() here would write this field's text into that other slide.
    const slide = done.slideId
      ? (pres?.slides || []).find((s) => s?.id === done.slideId)
      : getSlide?.();
    if (!slide) {
      // The edited slide is gone (deleted remotely): drop the commit and
      // repaint the canvas, which is still showing the deleted slide.
      rerenderPreview?.();
      return;
    }
    const current = getByPath(slide.content, path);
    // The spawn sentinel counts as "still empty": typing nothing into a fresh
    // field must not dirty/save, just drop back to the ghost.
    const currentVal = current === NEW_FIELD_SENTINEL ? '' : (current ?? '');
    const changed = value !== currentVal;
    if (changed || (isNew && value !== '')) {
      setByPath(slide.content, path, value);
      markDirty?.();
      requestSave?.();
      rerenderEditor?.(); // keep the side form in sync (thumb-safe)
    } else if (current === NEW_FIELD_SENTINEL) {
      clearSentinel(path);
    }
    // Normalize the rendered DOM (transforms, ghost restore) on the next frame.
    if (isNew || changed) scheduleCommitRerender();
    else refresh(); // no change: just restore the affordances
    void done;
  }

  /** Drop a spawn sentinel without dirtying: the field was and stays empty. */
  function clearSentinel(path) {
    const slide = getSlide?.();
    if (slide && getByPath(slide.content, path) === NEW_FIELD_SENTINEL) {
      setByPath(slide.content, path, '');
    }
  }

  // ----------------------------------------------------------------
  // Markdown modal (real editor with toolbar, dimmed backdrop)
  // ----------------------------------------------------------------
  function openMarkdownModal(_anchorEl, path, meta, { isNew = false } = {}) {
    if (editing) endTextEdit();
    dismissMarkdownModal();
    const slide = getSlide?.();
    if (!slide) return;

    const raw = isNew ? '' : String(getByPath(slide.content, path) ?? '');
    const label = fieldLabel(path, meta);
    let latest = raw;

    // Canonical markdown editor: label + toolbar + textarea + help.
    const editorEl = mdField(
      label,
      raw,
      t('editor.markdown.help', 'Supports paragraphs, lists, bold/italic, links, and markdown tables.'),
      (v) => {
        latest = v;
      },
      { maxLength: meta?.maxLength, required: !!meta?.required, showHeading: true }
    );
    // Collab presence: while this modal is open, focus inside it reports the
    // edited field's path, so collaborators see a ring on the matching canvas
    // field (and on their own modal if they have the same field open).
    editorEl.setAttribute('data-collab-field-key', String(path));

    const save = () => {
      if (latest !== raw) {
        setByPath(slide.content, path, latest);
        markDirty?.();
        requestSave?.();
        rerenderEditor?.();
      }
      dismissMarkdownModal();
      rerenderPreview?.();
    };
    const cancel = () => {
      dismissMarkdownModal();
      if (isNew) rerenderPreview?.();
    };

    const closeBtn = h('button', {
      class: 'ie-md-close',
      type: 'button',
      title: t('common.close', 'Close'),
      text: '×',
      onclick: cancel,
    });
    const header = h('div', { class: 'ie-md-header row spread' }, [
      h('div', { class: 'ie-md-mode', text: t('editor.inline.editingField', 'Editing: {label}', { label }) }),
      closeBtn,
    ]);
    const footer = h('div', { class: 'ie-md-footer row spread' }, [
      h('span', { class: 'help', text: t('editor.inline.markdownHint', 'Ctrl/⌘ + Enter to save') }),
      h('div', { class: 'row' }, [
        h('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          text: t('common.cancel', 'Cancel'),
          onclick: cancel,
        }),
        h('button', {
          class: 'btn btn-primary btn-sm',
          type: 'button',
          text: t('common.save', 'Save'),
          onclick: save,
        }),
      ]),
    ]);

    const modal = h('div', { class: 'ie-md-modal' }, [header, editorEl, footer]);
    const backdrop = h('div', { class: 'ie-modal-backdrop' });
    backdrop.addEventListener('click', cancel);

    mdHost.classList.add('is-ie-modal-open');
    mdHost.append(backdrop, modal);

    const detach = installDismissOnOutside({ rootEl: modal, isOpen: () => true, close: cancel });
    closeMarkdownModal = () => {
      detach?.();
      backdrop.remove();
      modal.remove();
      mdHost.classList.remove('is-ie-modal-open');
    };

    const ta = editorEl.querySelector('textarea');
    modal.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    ta?.focus();
  }

  // ----------------------------------------------------------------
  // CSV data modal (grid/raw chart-data editor, same modal chrome)
  // ----------------------------------------------------------------
  function openCsvModal(_anchorEl, path, meta, { isNew = false } = {}) {
    if (editing) endTextEdit();
    dismissMarkdownModal();
    const slide = getSlide?.();
    if (!slide) return;

    const raw = isNew ? '' : String(getByPath(slide.content, path) ?? '');
    const label = fieldLabel(path, meta);
    const chartType = String(slide.content?.chartType || 'bar');
    let latest = raw;

    const { el: editorEl } = createCsvGridEditor({
      h,
      chartType,
      value: raw,
      label,
      onChange: (v) => {
        latest = v;
      },
    });
    editorEl.setAttribute('data-collab-field-key', String(path));

    const save = () => {
      if (latest !== raw) {
        setByPath(slide.content, path, latest);
        markDirty?.();
        requestSave?.();
        rerenderEditor?.();
      }
      dismissMarkdownModal();
      rerenderPreview?.();
    };
    const cancel = () => {
      dismissMarkdownModal();
      if (isNew) rerenderPreview?.();
    };

    const closeBtn = h('button', {
      class: 'ie-md-close',
      type: 'button',
      title: t('common.close', 'Close'),
      text: '×',
      onclick: cancel,
    });
    const header = h('div', { class: 'ie-md-header row spread' }, [
      h('div', {
        class: 'ie-md-mode',
        text: t('editor.inline.editingField', 'Editing: {label}', { label }),
      }),
      closeBtn,
    ]);
    const footer = h('div', { class: 'ie-md-footer row spread' }, [
      h('span', {
        class: 'help',
        text: t('editor.inline.markdownHint', 'Ctrl/⌘ + Enter to save'),
      }),
      h('div', { class: 'row' }, [
        h('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          text: t('common.cancel', 'Cancel'),
          onclick: cancel,
        }),
        h('button', {
          class: 'btn btn-primary btn-sm',
          type: 'button',
          text: t('common.save', 'Save'),
          onclick: save,
        }),
      ]),
    ]);

    const modal = h('div', { class: 'ie-md-modal is-csv' }, [
      header,
      editorEl,
      footer,
    ]);
    const backdrop = h('div', { class: 'ie-modal-backdrop' });
    backdrop.addEventListener('click', cancel);

    mdHost.classList.add('is-ie-modal-open');
    mdHost.append(backdrop, modal);

    const detach = installDismissOnOutside({
      rootEl: modal,
      isOpen: () => true,
      close: cancel,
    });
    closeMarkdownModal = () => {
      detach?.();
      backdrop.remove();
      modal.remove();
      mdHost.classList.remove('is-ie-modal-open');
    };

    modal.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    modal.querySelector('input, textarea')?.focus();
  }

  function dismissMarkdownModal() {
    if (closeMarkdownModal) {
      try {
        closeMarkdownModal();
      } catch {
        /* ignore */
      }
      closeMarkdownModal = null;
    }
  }

  // ----------------------------------------------------------------
  // Ghost affordances (empty optional fields)
  // ----------------------------------------------------------------
  function fieldLabel(path, meta) {
    const key = String(path).split('.').pop();
    return t(`editor.inline.field.${key}`, meta?.label || key);
  }

  /**
   * Resolve a ghost's anchor: `anchors` is an ordered list of
   * `{sel, pos, chip}` fallbacks (first selector found in the DOM wins) so a
   * ghost can target `.header` when it exists and `.slide-inner` when the
   * header itself is omitted. Legacy `{anchor, pos}` still works.
   * @returns {{el:HTMLElement, pos:string, chip:string} | null}
   */
  function resolveGhostAnchor(root, g) {
    const candidates = Array.isArray(g.anchors)
      ? g.anchors
      : [{ sel: g.anchor, pos: g.pos, chip: g.chip }];
    for (const c of candidates) {
      const el = c?.sel ? root.querySelector(c.sel) : null;
      if (el) return { el, pos: c.pos || 'append', chip: c.chip || 'below-start' };
    }
    return null;
  }

  function insertGhosts(root, def, descriptor) {
    const slide = getSlide?.();
    if (!slide) return;
    // Ghosts sharing a `group` show only the first empty one - sequential
    // fields (option1..option10) get a single "+ Option N" instead of a chip
    // per empty slot.
    const seenGroups = new Set();
    for (const g of descriptor.ghosts || []) {
      const value = getByPath(slide.content, g.field);
      if (!isEmptyValue(value)) continue;
      if (g.group) {
        if (seenGroups.has(g.group)) continue;
        seenGroups.add(g.group);
      }
      const meta = fieldMetaForPath(def, g.field);
      // Shared ghost sets (HEADER_GHOSTS) may name fields a type doesn't have.
      if (!meta || !meta.key) continue;
      const anchor = resolveGhostAnchor(root, g);
      if (!anchor) continue;
      // reanchor re-resolves against the CURRENT slide DOM: the spawn path
      // rerenders the preview first, which orphans this refresh's elements.
      placeGhostChip(g.field, meta, anchor, () =>
        resolveGhostAnchor(slideEl() || root, g)
      );
    }
  }

  /**
   * Per-item ghosts: optional item subfields (e.g. a timeline item's
   * description) whose element the renderer omits when empty. For each rendered
   * item (identified by `data-inline-item-index`), if that item's subfield is
   * empty, a chip is anchored to the item element.
   * Shape: `{ list, field, item, within?, pos?, chip?, minIndex? }` where
   * `list` is the primary collection key (aliases resolved via the cards
   * config), `item` the item-element selector, and `within` an optional inner
   * element to spawn into.
   */
  function insertItemGhosts(root, def, descriptor) {
    const slide = getSlide?.();
    if (!slide) return;
    for (const g of descriptor.itemGhosts || []) {
      const listKey = getCollectionKey(
        slide.content,
        g.list,
        descriptor.cards?.fieldAliases || []
      );
      const arr = getByPath(slide.content, listKey);
      if (!Array.isArray(arr)) continue;
      for (const itemEl of root.querySelectorAll(g.item)) {
        const idx = Number(itemEl.getAttribute('data-inline-item-index'));
        if (!Number.isInteger(idx) || !arr[idx]) continue;
        // Some subfields only exist from a given index on (a text-blocks row
        // title renders for rows 2+ only); `minIndex` skips the earlier items.
        if (Number.isInteger(g.minIndex) && idx < g.minIndex) continue;
        const path = `${listKey}.${idx}.${g.field}`;
        if (!isEmptyValue(getByPath(slide.content, path))) continue;
        const meta = fieldMetaForPath(def, `${listKey}.0.${g.field}`);
        const spawnHost = (g.within && itemEl.querySelector(g.within)) || itemEl;
        // The chip is pinned to chipAnchor (the visible card) when set, so it
        // lands on the milestone card rather than the full-height column; the
        // spawned edit still goes into `within`.
        const chipHost = (g.chipAnchor && itemEl.querySelector(g.chipAnchor)) || itemEl;
        const reanchor = () => {
          const freshItem = [...(slideEl()?.querySelectorAll(g.item) || [])].find(
            (el) => Number(el.getAttribute('data-inline-item-index')) === idx
          );
          if (!freshItem) return null;
          return {
            el: (g.chipAnchor && freshItem.querySelector(g.chipAnchor)) || freshItem,
            pos: g.pos || 'append',
            chip: g.chip || 'below-start',
            spawnEl: (g.within && freshItem.querySelector(g.within)) || freshItem,
          };
        };
        placeGhostChip(path, meta, {
          el: chipHost,
          pos: g.pos || 'append',
          chip: g.chip || 'below-start',
          spawnEl: spawnHost,
        }, reanchor);
      }
    }
  }

  function placeGhostChip(path, meta, anchor, reanchor) {
    const kind =
      meta?.type === 'csv'
        ? 'csv'
        : meta?.type === 'markdown'
        ? 'markdown'
        : 'text';
    const chip = h('button', {
      class: 'ie-ghost',
      type: 'button',
      'data-ie-ghost': path,
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        spawnFromGhost(path, reanchor || (() => anchor), meta, kind);
      },
    }, [
      h('span', { class: 'ie-ghost-plus', text: '+', 'aria-hidden': 'true' }),
      h('span', { text: fieldLabel(path, meta) }),
    ]);
    overlay.place(chip, anchor.el, anchor.chip, 8);
  }

  function spawnFromGhost(path, resolveAnchor, meta, kind) {
    // Markdown / CSV edits happen in the modal; no in-slide element is needed.
    if (kind === 'csv') {
      openCsvModal(null, path, meta, { isNew: true });
      return;
    }
    if (kind === 'markdown') {
      openMarkdownModal(null, path, meta, { isNew: true });
      return;
    }
    const slide = getSlide?.();
    if (!slide) return;
    // Let the REAL renderer emit the field element so the edit happens at the
    // field's true tag/class/font-size (a bare spawned <p> renders microscopic
    // - base font inside the scaled slide). The sentinel makes the renderer
    // treat the field as non-empty while showing nothing; commit/cancel in
    // endTextEdit replace it with the typed value or empty.
    setByPath(slide.content, path, NEW_FIELD_SENTINEL);
    rerenderPreview?.();
    const el = slideEl()?.querySelector(`[data-inline-field="${path}"]`);
    if (el) {
      beginTextEdit(el, path, meta, { isNew: true });
      return;
    }
    // Renderer didn't emit the element (no data-inline-field for this path);
    // fall back to spawning a bare editable host at the descriptor anchor,
    // re-resolved against the fresh DOM (the rerender orphaned the old one).
    setByPath(slide.content, path, '');
    rerenderPreview?.();
    const anchor = resolveAnchor?.();
    if (!anchor) return;
    const host = document.createElement('p');
    host.className = 'ie-ghost-input';
    host.setAttribute('data-inline-field', path);
    placeRelative(host, anchor.spawnEl || anchor.el, anchor.pos);
    beginTextEdit(host, path, meta, { isNew: true });
  }

  /**
   * For optional fields that currently HAVE content, add a hover-revealed "clear"
   * affordance. Clearing sets the value to empty, which the renderer omits and
   * the layout reclaims - so the field visibly disappears and its ghost returns.
   * This is the "how do I remove an optional field" answer: it reads as clearing
   * content, not deleting a slot.
   */
  function insertClearButtons(root, def, descriptor) {
    const slide = getSlide?.();
    if (!slide) return;
    for (const g of descriptor.ghosts || []) {
      const meta = fieldMetaForPath(def, g.field);
      if (meta?.required) continue; // required fields can't be cleared away
      if (isEmptyValue(getByPath(slide.content, g.field))) continue; // empty -> ghost
      const el = root.querySelector(`[data-inline-field="${g.field}"]`);
      if (!el) continue;
      const clear = h('button', {
        class: 'ie-clear',
        type: 'button',
        title: t('editor.inline.clearField', 'Clear {label}', { label: fieldLabel(g.field, meta) }),
        text: '×',
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          clearOptionalField(g.field);
        },
      });
      // Pinned to the field's top-right corner on the overlay.
      overlay.place(clear, el, 'top-right', 0);
    }
  }

  function clearOptionalField(path) {
    const slide = getSlide?.();
    if (!slide) return;
    setByPath(slide.content, path, '');
    afterStructuralChange();
  }

  // ----------------------------------------------------------------
  // Card affordances (repeatable items)
  // ----------------------------------------------------------------
  function insertCardControls(root, def, descriptor) {
    const cards = descriptor.cards;
    if (!cards) return;
    const slide = getSlide?.();
    if (!slide) return;
    const listField = (def.fields || []).find((f) => f.key === cards.field) || {};
    // Write to the same array the renderer reads (legacy `steps`/`stages` decks).
    const fieldKey = getCollectionKey(slide.content, cards.field, cards.fieldAliases || []);
    const arr = Array.isArray(getByPath(slide.content, fieldKey))
      ? getByPath(slide.content, fieldKey)
      : [];
    // Dual-model types (icon-card-grid: items[] OR legacy numbered card fields)
    // must not grow an items[] array while the deck still renders from the
    // numbered fields - that would silently switch the renderer's data source.
    if (cards.skipWhenEmpty && arr.length === 0) return;

    insertCardLevel(root, slide, {
      path: fieldKey,
      meta: listField,
      itemSelector: cards.itemSelector,
      addAnchorEl:
        (cards.addAnchor && root.querySelector(cards.addAnchor)) ||
        root.querySelector(cards.container),
      removeAnchor: cards.removeAnchor,
      removePlacement: cards.removePlacement,
      addPlacement: cards.addPlacement,
      addLabelKey: cards.addLabelKey,
      addLabel: cards.addLabel,
      removeLabelKey: cards.removeLabelKey,
      removeLabel: cards.removeLabel,
      reorder: cards.reorder,
      reorderPlacement: cards.reorderPlacement,
    });

    // Nested card level (text-blocks: blocks within rows.{i}) - one card set
    // per parent item element, writing to the `${path}.${i}.${child.field}`
    // array. The child's min/max/itemDefaults come from the nested itemFields
    // schema (fieldMetaForPath already walks `rows.0.blocks`).
    const child = cards.child;
    if (!child) return;
    const childMeta = fieldMetaForPath(def, `${cards.field}.0.${child.field}`);
    for (const parentEl of root.querySelectorAll(cards.itemSelector)) {
      const idx = Number(parentEl.getAttribute('data-inline-item-index'));
      if (!Number.isInteger(idx) || !arr[idx]) continue;
      const childPath = `${fieldKey}.${idx}.${child.field}`;
      insertCardLevel(parentEl, slide, {
        path: childPath,
        meta: childMeta,
        itemSelector: child.itemSelector,
        // The parent item element itself anchors the child "+" chip.
        addAnchorEl: parentEl,
        removeAnchor: child.removeAnchor,
        removePlacement: child.removePlacement,
        addPlacement: child.addPlacement,
        addLabelKey: child.addLabelKey,
        addLabel: child.addLabel,
        removeLabelKey: child.removeLabelKey,
        removeLabel: child.removeLabel,
        reorder: child.reorder,
        reorderPlacement: child.reorderPlacement,
      });
      insertChildGhosts(parentEl, def, cards, idx, childPath);
    }
  }

  /**
   * Add/remove affordances for one repeatable-items level. `scopeEl` bounds the
   * item-element query (the slide root for top-level lists, the parent item
   * element for a nested child list); `path` is the content path of the array.
   */
  function insertCardLevel(scopeEl, slide, {
    path,
    meta,
    itemSelector,
    addAnchorEl,
    removeAnchor,
    removePlacement,
    addPlacement,
    addLabelKey,
    addLabel,
    removeLabelKey,
    removeLabel,
    reorder,
    reorderPlacement,
  }) {
    const min = Number.isFinite(meta?.minItems) ? meta.minItems : 0;
    const max = Number.isFinite(meta?.maxItems) ? meta.maxItems : 99;
    const arr = Array.isArray(getByPath(slide.content, path))
      ? getByPath(slide.content, path)
      : [];

    for (const itemEl of scopeEl.querySelectorAll(itemSelector)) {
      const idx = Number(itemEl.getAttribute('data-inline-item-index'));
      if (!Number.isInteger(idx)) continue;
      // Some item elements are full-height layout columns whose visible card
      // is transform-positioned inside them (timeline). Pin the badges to the
      // visual element (removeAnchor) so they land on the card corners, not
      // the column corners.
      const badgeTarget =
        (removeAnchor && itemEl.querySelector(removeAnchor)) || itemEl;

      if (arr.length > min) {
        const remove = h('button', {
          class: 'ie-card-remove',
          type: 'button',
          title: t(removeLabelKey || 'editor.inline.removeItem', removeLabel || 'Remove item'),
          text: '×',
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeCard(path, idx);
          },
        });
        overlay.place(remove, badgeTarget, removePlacement || 'top-right', 0);
      }

      // Reorder grip (drag handle) on the top-edge middle, clear of the × and
      // of grid neighbours' badges. Lives on the overlay, NOT the card itself
      // - card clicks are for text editing.
      if (arr.length > 1 && reorder !== false) {
        const grip = h('button', {
          class: 'ie-card-grip',
          type: 'button',
          title: t('editor.inline.reorderItem', 'Drag to reorder'),
          text: '⠿',
          onpointerdown: (e) => beginReorder(e, { path, scopeEl, itemSelector, fromIdx: idx }),
          // The button "click" after a drag must never bubble into the slide's
          // click-to-edit routing.
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
          },
        });
        overlay.place(grip, badgeTarget, reorderPlacement || 'top-center', 0);
      }
    }

    if (arr.length < max && addAnchorEl) {
      // The add button is placed against the container by default, or an
      // explicit addAnchor. Its placement is 'bottom-center' unless the
      // descriptor overrides it (e.g. 'right-center' for horizontal layouts
      // whose new item appends to the right); addPlacement may be a function
      // of the slide when it depends on content (process direction).
      const placement =
        typeof addPlacement === 'function'
          ? addPlacement(slide)
          : addPlacement || 'bottom-center';
      const add = h('button', {
        class: 'ie-card-add',
        type: 'button',
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          addCard(path, meta?.itemDefaults || {});
        },
      }, [
        h('span', { class: 'ie-ghost-plus', text: '+', 'aria-hidden': 'true' }),
        h('span', { text: t(addLabelKey || 'editor.inline.addItem', addLabel || 'Add item') }),
      ]);
      overlay.place(add, addAnchorEl, placement, placement === 'bottom-center' ? 10 : 6);
    }
  }

  /**
   * Ghosts for optional subfields of nested child items (a block's title/body
   * inside rows.{i}.blocks.{j}): declared as `cards.child.ghosts`, anchored to
   * the child item element. The spawn goes through the sentinel path, so the
   * renderer emits the field's real element.
   */
  function insertChildGhosts(parentEl, def, cards, parentIdx, childPath) {
    const child = cards.child;
    if (!child?.ghosts?.length) return;
    const slide = getSlide?.();
    if (!slide) return;
    for (const childEl of parentEl.querySelectorAll(child.itemSelector)) {
      const childIdx = Number(childEl.getAttribute('data-inline-item-index'));
      if (!Number.isInteger(childIdx)) continue;
      for (const g of child.ghosts) {
        const path = `${childPath}.${childIdx}.${g.field}`;
        if (!isEmptyValue(getByPath(slide.content, path))) continue;
        const meta = fieldMetaForPath(
          def,
          `${cards.field}.0.${child.field}.0.${g.field}`
        );
        if (!meta || !meta.key) continue;
        const reanchor = () => {
          const freshParent = [...(slideEl()?.querySelectorAll(cards.itemSelector) || [])].find(
            (el) => Number(el.getAttribute('data-inline-item-index')) === parentIdx
          );
          const freshChild = freshParent
            ? [...freshParent.querySelectorAll(child.itemSelector)].find(
                (el) => Number(el.getAttribute('data-inline-item-index')) === childIdx
              )
            : null;
          if (!freshChild) return null;
          return { el: freshChild, pos: g.pos || 'append', chip: g.chip || 'below-start' };
        };
        placeGhostChip(path, meta, {
          el: childEl,
          pos: g.pos || 'append',
          chip: g.chip || 'below-start',
        }, reanchor);
      }
    }
  }

  function addCard(path, itemDefaults) {
    const slide = getSlide?.();
    if (!slide) return;
    let arr = getByPath(slide.content, path);
    if (!Array.isArray(arr)) {
      arr = [];
      setByPath(slide.content, path, arr);
    }
    // Deep clone: itemDefaults may carry nested arrays (a row's starter
    // blocks) that must not be shared with the schema object.
    arr.push(structuredClone(itemDefaults));
    afterStructuralChange();
  }

  function removeCard(path, idx) {
    const slide = getSlide?.();
    const arr = slide ? getByPath(slide.content, path) : null;
    if (!Array.isArray(arr)) return;
    arr.splice(idx, 1);
    afterStructuralChange();
  }

  function moveCard(path, from, to) {
    const slide = getSlide?.();
    const arr = slide ? getByPath(slide.content, path) : null;
    if (!Array.isArray(arr) || from === to) return;
    if (!arr[from] || to < 0 || to >= arr.length) return;
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    afterStructuralChange();
  }

  /**
   * Pointer-based drag from a grip: measure the level's item rects once (the
   * slide doesn't rerender mid-drag), snap the pointer to the nearest
   * insertion gap (reorder-geometry.js) and show an indicator line there;
   * pointerup commits the array move. Pointer capture keeps the events on the
   * grip, so nothing leaks into click-to-edit. Esc cancels.
   */
  function beginReorder(e, { path, scopeEl, itemSelector, fromIdx }) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    const thumbRect = thumb.getBoundingClientRect();
    const items = [...scopeEl.querySelectorAll(itemSelector)]
      .filter((el) => Number.isInteger(Number(el.getAttribute('data-inline-item-index'))))
      .sort(
        (a, b) =>
          Number(a.getAttribute('data-inline-item-index')) -
          Number(b.getAttribute('data-inline-item-index'))
      );
    if (items.length < 2) return;
    const rects = items.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - thumbRect.left, top: r.top - thumbRect.top, width: r.width, height: r.height };
    });

    const indicator = h('div', { class: 'ie-drop-indicator' });
    overlay.layer.appendChild(indicator);
    thumb.classList.add('is-ie-dragging');
    grip.classList.add('is-dragging');
    grip.setPointerCapture?.(e.pointerId);

    let drop = null;
    const onMove = (ev) => {
      drop = computeDrop(rects, { x: ev.clientX - thumbRect.left, y: ev.clientY - thumbRect.top });
      if (!drop) return;
      const line = drop.line;
      const s = indicator.style;
      if (line.orientation === 'v') {
        s.left = `${line.x - 1.5}px`;
        s.top = `${line.y}px`;
        s.width = '3px';
        s.height = `${line.length}px`;
      } else {
        s.left = `${line.x}px`;
        s.top = `${line.y - 1.5}px`;
        s.width = `${line.length}px`;
        s.height = '3px';
      }
    };
    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish(false);
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    function finish(commit) {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      indicator.remove();
      thumb.classList.remove('is-ie-dragging');
      grip.classList.remove('is-dragging');
      if (commit && drop) {
        const to = resolveMove(fromIdx, drop.index);
        if (to !== fromIdx) moveCard(path, fromIdx, to);
      }
    }
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
  }

  function afterStructuralChange() {
    cancelCommitRerender();
    markDirty?.();
    requestSave?.();
    rerenderEditor?.();
    rerenderPreview?.();
  }

  // ----------------------------------------------------------------
  // Media popover (per-item image + alt + extra fields, e.g. LinkedIn)
  // ----------------------------------------------------------------
  /**
   * Decorate item photos: a dashed outline (so they read as editable) plus an
   * "+ Add image" hint centered on empty ones. Filled photos get a "Change
   * image" chip. The click itself is routed in onThumbClickCapture.
   */
  function insertMediaAffordances(root, _def, descriptor) {
    const media = descriptor.media;
    if (!media || typeof openImagePicker !== 'function') return;
    for (const photo of root.querySelectorAll(media.photoSelector)) {
      outlineByField.set(photo, overlay.outline(photo));
      const isEmpty = photo.classList.contains('is-empty');
      const chip = h('button', {
        class: 'ie-media-hint',
        type: 'button',
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          openMediaFor(photo);
        },
      }, [
        h('span', { class: 'ie-ghost-plus', text: '+', 'aria-hidden': 'true' }),
        h('span', {
          text: isEmpty
            ? t('editor.inline.media.addImage', 'Add image')
            : t('editor.inline.media.changeImage', 'Change image'),
        }),
      ]);
      overlay.place(chip, photo, 'center', 0);
    }
  }

  /**
   * Open the media popover on the photo element with the given
   * data-inline-photo index in the CURRENT slide DOM. Used by the convert
   * flow: after "+ Add image" converts a text slide, the fresh placeholder
   * gets the popover right away. No-op when the element isn't there (e.g. an
   * async server-rendered custom type) - the placeholder itself stays
   * clickable.
   */
  function openMediaByIndex(idx) {
    const el = slideEl()?.querySelector(`[data-inline-photo="${idx}"]`);
    if (el) openMediaFor(el);
  }

  function openMediaFor(photoEl) {
    const slide = getSlide?.();
    const descriptor = slide
      ? getInlineDescriptor(slide.type, getSlideDef?.(slide.type))
      : null;
    const media = descriptor?.media;
    if (!slide || !media || typeof openImagePicker !== 'function') return;
    const idx = Number(photoEl.getAttribute('data-inline-photo'));
    if (!Number.isInteger(idx)) return;

    // Array mode: mutate the item at `idx` in `list`. Flat mode (no `list`):
    // mutate slide.content directly, substituting `{n}` -> idx in the field keys
    // (single-image types use plain keys with idx 0; content-columns templates
    // col{n}Image / col{n}Alt off the 1-based column number).
    let member;
    let imageField;
    let altField;
    let extraFields;
    if (media.list) {
      const arr = getByPath(slide.content, media.list);
      if (!Array.isArray(arr)) return;
      // Renderers may draw placeholder cells beyond the current array (e.g.
      // image-text rows padding to their cell count); create the item the
      // popover will mutate in place.
      while (arr.length <= idx) arr.push({});
      member = arr[idx];
      imageField = media.imageField;
      altField = media.altField;
      extraFields = media.extraFields;
    } else {
      member = slide.content;
      const sub = (s) => String(s).replace('{n}', String(idx));
      imageField = sub(media.imageField);
      altField = sub(media.altField);
      extraFields = (media.extraFields || []).map((f) => ({ ...f, key: sub(f.key) }));
    }

    dismissMediaPopover();
    const onEdit = () => {
      markDirty?.();
      requestSave?.();
      rerenderEditor?.();
    };
    mediaPopover = openMediaPopover({
      h,
      host: mdHost,
      anchorEl: photoEl,
      member,
      slide,
      config: {
        title: t('editor.inline.media.title', 'Image'),
        imageField,
        altField,
        extraFields,
      },
      openImagePicker,
      pres,
      normalizeLang,
      onChange: onEdit,
      onVisualChange: () => {
        onEdit();
        rerenderPreview?.(); // image/LinkedIn changed → the card relayouts
        const fresh = slideEl()?.querySelector(`[data-inline-photo="${idx}"]`);
        if (fresh) mediaPopover?.reposition(fresh);
      },
      onClose: () => {
        mediaPopover = null;
      },
    });
  }

  // ----------------------------------------------------------------
  // Type-switch affordances (descriptor `convert`: add/remove image area)
  // ----------------------------------------------------------------
  /**
   * The "add an image" / "remove the image area" intents surface here; the
   * type switch underneath runs through the controller's shared convert
   * action. Both affordances are gated on the convert seam actually
   * supporting the switch for this slide, so forks with custom types only
   * get them where the mapping exists.
   */
  function insertConvertAffordances(root, _def, descriptor) {
    const conv = descriptor.convert;
    if (!conv || typeof convertSlideType !== 'function') return;
    const slide = getSlide?.();
    if (!slide) return;

    const add = conv.addMedia;
    if (add?.toType && canConvertSlideTo?.(slide, add.toType)) {
      const anchor = resolveGhostAnchor(root, add);
      if (anchor) {
        const chip = h('button', {
          class: 'ie-ghost',
          type: 'button',
          'data-ie-convert': add.toType,
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            convertSlideType(add.toType, { openMedia: true });
          },
        }, [
          h('span', { class: 'ie-ghost-plus', text: '+', 'aria-hidden': 'true' }),
          h('span', { text: t('editor.inline.media.addImage', 'Add image') }),
        ]);
        overlay.place(chip, anchor.el, anchor.chip, 8);
      }
    }

    const rem = conv.removeMedia;
    if (rem?.toType && rem.selector && canConvertSlideTo?.(slide, rem.toType)) {
      for (const el of root.querySelectorAll(rem.selector)) {
        const btn = h('button', {
          class: 'ie-clear',
          type: 'button',
          'data-ie-convert': rem.toType,
          title: t(
            'editor.inline.media.removeImageArea',
            'Remove image area (becomes a text slide)'
          ),
          text: '×',
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            convertSlideType(rem.toType);
          },
        });
        overlay.place(btn, el, 'top-right', 0);
      }
    }
  }

  // ----------------------------------------------------------------
  // Icon picker (per-icon, e.g. icon-card-grid card icons)
  // ----------------------------------------------------------------
  /**
   * Decorate icon elements tagged `data-inline-icon` with a dashed outline so
   * they read as editable, like text fields. The click itself is routed in
   * onThumbClickCapture; the picker is the canonical modal, so no in-slide
   * popover lifecycle is needed here.
   */
  function insertIconAffordances(root, _def, descriptor) {
    const icons = descriptor.icons;
    if (!icons?.selector) return;
    for (const el of root.querySelectorAll(icons.selector)) {
      outlineByField.set(el, overlay.outline(el));
    }
  }

  function openIconFor(iconEl) {
    const slide = getSlide?.();
    const descriptor = slide
      ? getInlineDescriptor(slide.type, getSlideDef?.(slide.type))
      : null;
    const icons = descriptor?.icons;
    if (!slide || !icons) return;
    const path = iconEl.getAttribute('data-inline-icon');
    if (!path) return;
    const current = getByPath(slide.content, path);
    openIconPicker({
      current: typeof current === 'string' ? current : '',
      onSelect: (name) => {
        setByPath(slide.content, path, name);
        try {
          icons.afterWrite?.(slide);
        } catch {
          /* mirror sync is best-effort; the primary write already landed */
        }
        afterStructuralChange(); // dirty + save + form rebuild + preview remount
      },
    });
  }

  function dismissMediaPopover() {
    if (mediaPopover) {
      try {
        mediaPopover.close();
      } catch {
        /* ignore */
      }
      mediaPopover = null;
    }
  }

  // ----------------------------------------------------------------
  // Public: decorate the freshly-mounted slide
  // ----------------------------------------------------------------
  function refresh() {
    if (editing) return; // decoration happens on clean mounts only
    const root = slideEl();
    overlay.clear();
    if (!root) return;
    thumb.classList.remove('is-inline-edit');
    restoreThumbTitle();
    if (!getCanEdit?.()) return;
    const slide = getSlide?.();
    const def = slide ? getSlideDef?.(slide.type) : null;
    const descriptor = slide ? getInlineDescriptor(slide.type, def) : null;
    if (!def || !descriptor) return; // opt-in only
    thumb.classList.add('is-inline-edit');
    // Clicking an editable slide edits text; it does NOT open the lightbox, so
    // the thumb's "Click to open larger preview" tooltip would be wrong here.
    suppressThumbTitle();

    // A dashed outline over every editable field (Keynote-style discoverability).
    for (const el of root.querySelectorAll('[data-inline-field]')) {
      outlineByField.set(el, overlay.outline(el));
    }
    insertGhosts(root, def, descriptor);
    insertItemGhosts(root, def, descriptor);
    insertClearButtons(root, def, descriptor);
    insertCardControls(root, def, descriptor);
    insertMediaAffordances(root, def, descriptor);
    insertIconAffordances(root, def, descriptor);
    insertConvertAffordances(root, def, descriptor);

    // Measure now, then again after layout settles (fonts/images can reflow).
    overlay.reposition();
    scheduleReposition();

    // First inline-editable slide the user sees gets a one-time edit hint.
    coach.maybeShow();
  }

  function suppressThumbTitle() {
    if (thumb.getAttribute('title')) {
      thumb.dataset.ieSavedTitle = thumb.getAttribute('title');
      thumb.removeAttribute('title');
    }
  }

  function restoreThumbTitle() {
    if (thumb.dataset.ieSavedTitle) {
      thumb.setAttribute('title', thumb.dataset.ieSavedTitle);
      delete thumb.dataset.ieSavedTitle;
    }
  }

  function scheduleReposition() {
    if (repositionRaf) cancelAnimationFrame(repositionRaf);
    repositionRaf = requestAnimationFrame(() => {
      repositionRaf = 0;
      overlay.reposition();
    });
  }

  // ----------------------------------------------------------------
  // Hover: reveal outlines on slide-hover, strengthen the one under the cursor
  // ----------------------------------------------------------------
  function setHotField(el) {
    if (hotField === el) return;
    if (hotField) outlineByField.get(hotField)?.classList.remove('is-hot');
    hotField = el;
    if (hotField) outlineByField.get(hotField)?.classList.add('is-hot');
  }

  function onThumbPointerMove(e) {
    if (editing) return;
    const t = e.target;
    const fieldEl = t && t.closest ? t.closest('[data-inline-field], [data-inline-icon]') : null;
    setHotField(fieldEl && thumb.contains(fieldEl) ? fieldEl : null);
  }

  function onThumbPointerLeave() {
    setHotField(null);
  }

  thumb.addEventListener('pointermove', onThumbPointerMove);
  thumb.addEventListener('pointerleave', onThumbPointerLeave);

  // ----------------------------------------------------------------
  // Click routing (capture phase so we pre-empt the lightbox handler)
  // ----------------------------------------------------------------
  function onThumbClickCapture(e) {
    if (!getCanEdit?.()) return;
    // Placing a positioned comment? Yield entirely: don't preventDefault or
    // stopPropagation, so the click bubbles to the comment-markers handler on
    // the same element and the pin lands wherever the user clicked - including
    // over editable text, which would otherwise start a text edit instead.
    if (isCommentAddMode?.()) return;
    const target = e.target;
    if (!target || !target.closest) return;
    // Our own affordance buttons manage themselves; just block the lightbox.
    if (target.closest('.ie-ghost, .ie-card-add, .ie-card-remove, .ie-clear, .ie-media-hint')) {
      coach.dismiss();
      e.preventDefault();
      return;
    }
    // Clicks inside the active edit are for the caret.
    if (editing && editing.el.contains(target)) return;

    // Card icons open the icon-picker modal.
    const iconEl = target.closest('[data-inline-icon]');
    if (iconEl && thumb.contains(iconEl)) {
      coach.dismiss();
      e.preventDefault();
      e.stopPropagation();
      openIconFor(iconEl);
      return;
    }

    // Item photos open the media popover (image + alt + extra fields).
    const photoEl = target.closest('[data-inline-photo]');
    if (photoEl && thumb.contains(photoEl)) {
      coach.dismiss();
      e.preventDefault();
      e.stopPropagation();
      openMediaFor(photoEl);
      return;
    }

    const fieldEl = target.closest('[data-inline-field]');
    if (!fieldEl || !thumb.contains(fieldEl)) return;
    coach.dismiss();
    e.preventDefault();
    e.stopPropagation();

    const def = currentDef();
    if (!def) return;
    const path = fieldEl.getAttribute('data-inline-field');
    const meta = fieldMetaForPath(def, path);
    const kind =
      meta?.type === 'csv'
        ? 'csv'
        : meta?.type === 'markdown' || fieldEl.dataset.inlineKind === 'markdown'
        ? 'markdown'
        : 'text';
    if (kind === 'csv') openCsvModal(fieldEl, path, meta);
    else if (kind === 'markdown') openMarkdownModal(fieldEl, path, meta);
    else beginTextEdit(fieldEl, path, meta);
  }

  thumb.addEventListener('click', onThumbClickCapture, true);

  function isEditing() {
    return !!editing || !!closeMarkdownModal;
  }

  function destroy() {
    thumb.removeEventListener('click', onThumbClickCapture, true);
    thumb.removeEventListener('pointermove', onThumbPointerMove);
    thumb.removeEventListener('pointerleave', onThumbPointerLeave);
    if (repositionRaf) cancelAnimationFrame(repositionRaf);
    overlay.destroy();
    coach.destroy();
    cancelCommitRerender();
    dismissMarkdownModal();
    dismissMediaPopover();
    restoreThumbTitle();
    if (editing) {
      try {
        editing.el.removeEventListener('keydown', onEditKeydown);
        editing.el.removeEventListener('input', onEditInput);
        editing.el.removeAttribute('contenteditable');
        clearSentinel(editing.path);
      } catch {
        /* ignore */
      }
      editing = null;
    }
  }

  return { refresh, isEditing, destroy, openMediaByIndex };
}

// --------------------------------------------------------------------
// Small DOM utilities
// --------------------------------------------------------------------
function placeCaretAtEnd(el) {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* ignore */
  }
}

function placeRelative(node, anchor, pos) {
  switch (pos) {
    case 'prepend':
      anchor.prepend(node);
      break;
    case 'before':
      anchor.before(node);
      break;
    case 'after':
      anchor.after(node);
      break;
    case 'append':
    default:
      anchor.append(node);
      break;
  }
}
