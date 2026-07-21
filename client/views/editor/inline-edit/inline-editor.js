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
 * - Markdown fields edit their RENDERED HTML in place (rich contenteditable,
 *   editing-surfaces text phase) and commit through the HTML→markdown
 *   serializer — but only when the round-trip gate proves the serializer can
 *   faithfully reproduce this content (canInlineEditMarkdown). Content that
 *   fails the gate (tables, code, math, renderer edge cases) keeps the modal
 *   with the canonical raw-markdown editor.
 *
 * Only slide types with a descriptor (see ./descriptors.js) and renderer
 * `data-inline-field` attributes participate; everything else is untouched.
 */

import { getInlineDescriptor } from './descriptors.js';
import { getByPath, setByPath, fieldMetaForPath, isEmptyValue } from './field-path.js';
import { computeDrop, resolveMove } from './reorder-geometry.js';
import { createInlineOverlay } from './overlay.js';
import { createInlineCoachMark } from './coach-mark.js';
import { openIconPicker } from '../fields/icon-picker-modal.js';
import { uploadFile } from '../image-library/upload.js';
import { installDismissOnOutside } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/toast.js';
import { createBasicFields } from '../fields/basic.js';
import { createCsvGridEditor } from '../fields/csv-grid.js';
import { getCollectionKey } from '../../../../shared/slide-types/helpers.js';
import { markdownToSafeHtml } from '../../../../shared/markdown.js';
import {
  serializeMarkdownDom,
  canInlineEditMarkdown,
} from '../../../lib/markdown-serialize.js';
import { promptModal } from '../../../lib/modal.js';
import { createSelectionToolbar } from './selection-toolbar.js';
import { slideLinkUrl } from './selection-toolbar-logic.js';

/**
 * @param {Object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} [opts.api] - fetch wrapper; used to upload dropped image files
 * @param {boolean} [opts.uploadsEnabled] - whether drag & drop image upload onto
 *   empty placeholders is available (mirrors `features.disableUploads`)
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
 * @param {Function} [opts.onOpenElementSettings] - (element) => void; selects the
 *   canvas element and opens the inspector settings pane on its element tab.
 *   The doorway to everything settable for an element: a single click on an
 *   image opens its "This image" tab directly (no on-image chip)
 * @param {Function} [opts.onSelectElement] - (element|null) => void; sets the
 *   selection-aware inspector's current element ({kind:'image'|'card', idx}) or
 *   clears it. Selecting rebuilds the inspector with the element tab active; it
 *   only becomes visible if the settings pane is already open
 */
export function createInlineEditor({
  h,
  api,
  uploadsEnabled = false,
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
  onOpenElementSettings,
  onSelectElement,
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

  /** Rich (markdown) commit value: keep newlines, only cap the length. */
  function normalizeRichValue(raw, meta) {
    let v = String(raw ?? '');
    if (typeof meta?.maxLength === 'number' && v.length > meta.maxLength) {
      v = v.slice(0, meta.maxLength);
    }
    return v;
  }

  /**
   * Blur commits the edit — except while the link modal has focus on
   * purpose: `suspendBlur` bridges that one excursion (openLinkPrompt) so
   * the edit survives it, mirroring the comment composer's snapshot trick.
   */
  function onEditBlur() {
    if (editing?.suspendBlur) return;
    endTextEdit();
  }

  function onEditKeydown(e) {
    if (!editing) return;
    if (editing.rich) {
      // Multi-line rich edit: Enter makes a new paragraph/list item (browser
      // default), Cmd/Ctrl+Enter commits, Escape cancels, Cmd/Ctrl+B/I toggle
      // the two inline styles the dialect can store.
      if (e.key === 'Escape') {
        e.preventDefault();
        editing.cancel = true;
        editing.el.blur();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        editing.el.blur();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        document.execCommand('bold');
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        document.execCommand('italic');
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      editing.el.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editing.cancel = true;
      editing.el.blur();
    }
  }

  /** Rich edits accept plain text only on paste (formatting comes from the
   *  dialect, not from whatever HTML the clipboard carries). */
  function onRichPaste(e) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text) document.execCommand('insertText', false, text);
  }

  /**
   * Toolbar link flow. Opening the modal moves focus (which collapses the
   * live selection AND would blur-commit the edit), so this: snapshots the
   * Range first, suspends the blur-commit for the excursion, and after the
   * modal closes re-focuses the field and re-asserts the snapshot — the
   * modal's own focus restore leaves a fresh caret at position 0 (the
   * PR #167 lesson), so the restore must run after it, hence the rAF.
   * The URL is gated by slideLinkUrl (http/https only): the serializer
   * degrades any other scheme to bare text, so it is rejected up front.
   */
  async function openLinkPrompt() {
    if (!editing?.rich) return;
    const ed = editing;
    const el = ed.el;
    const sel = document.getSelection?.();
    const live = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!live || live.collapsed || !el.contains(live.startContainer)) return;
    const snapshot = live.cloneRange();
    const selected = live.toString();
    ed.suspendBlur = true;
    try {
      const url = await promptModal(h, mdHost, {
        title: t('editor.inline.link.title', 'Add link'),
        message: t('editor.inline.link.message', 'Link "{text}" to:', {
          text: selected.length > 40 ? `${selected.slice(0, 40)}…` : selected,
        }),
        placeholder: 'https://',
        validate: (value) =>
          slideLinkUrl(value)
            ? null
            : t('editor.inline.link.invalid', 'Use an http:// or https:// address'),
      });
      await new Promise((r) => requestAnimationFrame(r));
      if (editing !== ed) return; // the edit ended while the modal was open
      el.focus();
      if (el.contains(snapshot.startContainer)) {
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(snapshot);
        const safe = slideLinkUrl(url || '');
        if (safe) document.execCommand('createLink', false, safe);
      }
      ed.toolbar?.update();
    } finally {
      if (editing === ed) ed.suspendBlur = false;
    }
  }

  function onEditInput() {
    if (!editing) return;
    const { meta } = editing;
    // Enforce single-line + maxLength live without fighting the caret when
    // under. Never for rich edits: assigning textContent would flatten the
    // block HTML (headings, lists, bold) to one text node — the commit-time
    // cap in normalizeRichValue covers the limit instead.
    if (!editing.rich && typeof meta?.maxLength === 'number') {
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
    el.addEventListener('blur', onEditBlur);
    el.focus();
    placeCaretAtEnd(el);
  }

  /**
   * In-place rich edit for a markdown field: the element keeps its RENDERED
   * HTML (it already is the value's rendering) and the commit serializes the
   * edited DOM back to dialect markdown. Only entered through the round-trip
   * gate (canInlineEditMarkdown), so serialization is proven faithful for
   * this content before any edit can happen.
   */
  function beginRichEdit(el, path, meta, { isNew = false } = {}) {
    if (editing) endTextEdit();
    cancelCommitRerender();
    const slide = getSlide?.();
    if (!slide) return;
    const raw = isNew ? '' : String(getByPath(slide.content, path) ?? '');
    editing = {
      el, path, meta, original: raw, isNew, cancel: false, slideId: slide.id,
      rich: true, originalHtml: el.innerHTML,
    };
    setHotField(null);
    el.setAttribute('contenteditable', 'true');
    el.classList.add('ie-editing', 'ie-editing-rich');
    overlay.clear();
    const ring = overlay.outline(el);
    ring.classList.add('is-active');
    overlay.reposition();
    // A ghost-spawned field renders only the spawn sentinel; start blank.
    if (isNew) el.innerHTML = '';
    // "Did the user change anything?" is judged against the serialization of
    // the UNTOUCHED render, not the stored raw: the serializer normalizes
    // (list renumbering, whitespace), so comparing against the raw would make
    // a click-in-click-out dirty the deck without an actual edit.
    editing.baseline = serializeMarkdownDom(el);
    el.addEventListener('keydown', onEditKeydown);
    el.addEventListener('input', onEditInput);
    el.addEventListener('paste', onRichPaste);
    el.addEventListener('blur', onEditBlur);
    // Selection-bound formatting (bold/italic/link/list) above the selection.
    // Rich edits only: plain-text fields cannot store formatting.
    editing.toolbar = createSelectionToolbar({
      h,
      layer: overlay.layer,
      thumb,
      editEl: el,
      onLinkRequest: openLinkPrompt,
    });
    el.focus();
    placeCaretAtEnd(el);
  }

  function endTextEdit() {
    if (!editing) return;
    const { el, path, meta, original, isNew, cancel, rich, originalHtml } = editing;
    editing.toolbar?.destroy();
    el.removeEventListener('keydown', onEditKeydown);
    el.removeEventListener('input', onEditInput);
    el.removeEventListener('paste', onRichPaste);
    el.removeEventListener('blur', onEditBlur);
    el.removeAttribute('contenteditable');
    el.classList.remove('ie-editing', 'ie-editing-rich');
    const done = editing;
    editing = null;

    if (cancel) {
      // Restore and rerender to drop any ghost-spawned placeholder.
      if (isNew) {
        clearSentinel(path);
        scheduleCommitRerender();
      } else if (rich) {
        el.innerHTML = originalHtml;
        refresh();
      } else {
        el.textContent = original;
        refresh(); // restore affordances the active ring replaced
      }
      return;
    }

    const value = rich
      ? normalizeRichValue(serializeMarkdownDom(el), meta)
      : normalizeText(el.textContent, meta);
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
    const changed = rich ? value !== (done.baseline ?? '') : value !== currentVal;
    if (changed || (isNew && value !== '')) {
      setByPath(slide.content, path, value);
      markDirty?.();
      requestSave?.();
      rerenderEditor?.(); // keep the side form in sync (thumb-safe)
    } else if (current === NEW_FIELD_SENTINEL) {
      clearSentinel(path);
    }
    // Normalize the rendered DOM (transforms, ghost restore) on the next
    // frame. A rich edit always repaints: even a no-op commit can leave
    // contenteditable artifacts (<b> instead of <strong>, <div> wrappers)
    // that serialize identically but differ from the canonical render.
    if (isNew || changed || rich) scheduleCommitRerender();
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
    // CSV edits happen in the modal; no in-slide element is needed.
    if (kind === 'csv') {
      openCsvModal(null, path, meta, { isNew: true });
      return;
    }
    if (kind === 'markdown') {
      // Same sentinel flow as plain text: let the renderer emit the real
      // field element, then edit it in place (rich). A fresh field is empty,
      // so the round-trip gate is trivially satisfied.
      const slide = getSlide?.();
      if (!slide) return;
      setByPath(slide.content, path, NEW_FIELD_SENTINEL);
      rerenderPreview?.();
      const el = slideEl()?.querySelector(`[data-inline-field="${path}"]`);
      if (el) {
        beginRichEdit(el, path, meta, { isNew: true });
        return;
      }
      // Renderer didn't emit the element for this path: modal fallback.
      setByPath(slide.content, path, '');
      rerenderPreview?.();
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
   * Decorate item photos with a dashed outline (so they read as editable).
   *
   * Empty slots get a centered "+ Add image" chip - they have nothing to
   * occlude, so an affordance in the middle is fine. Filled images get NO
   * control on the image itself (it would cover exactly what the user is
   * judging): they are replaced by double-clicking, hinted by a small,
   * non-interactive corner label on hover. A single click selects the image
   * and opens its "This image" inspector tab (routed in onThumbClickCapture),
   * which carries the explicit Replace / alt / fit / focus controls.
   */
  function insertMediaAffordances(root, _def, descriptor) {
    const media = descriptor.media;
    if (!media || typeof openImagePicker !== 'function') return;
    for (const photo of root.querySelectorAll(media.photoSelector)) {
      const outlineBox = overlay.outline(photo);
      outlineByField.set(photo, outlineBox);
      const isEmpty = photo.classList.contains('is-empty');
      if (isEmpty) {
        const chip = h('button', {
          class: 'ie-media-hint',
          type: 'button',
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            openPickerForPhoto(photo);
          },
        }, [
          h('span', { class: 'ie-ghost-plus', text: '+', 'aria-hidden': 'true' }),
          h('span', { text: t('editor.inline.media.addImage', 'Add image') }),
        ]);
        overlay.place(chip, photo, 'center', 0);
        // Drag an image file straight from the desktop onto an empty placeholder.
        // Empty-only: replacing a filled image goes through the picker (double-
        // click / inspector). The chip is a separate drop target because it
        // overlays the placeholder.
        if (uploadsEnabled && typeof api === 'function') {
          wireImageDrop([photo, chip], photo, outlineBox);
        }
      } else {
        // Non-interactive hover hint (pointer-events: none in CSS) so the click
        // still lands on the image itself. No control ON the image.
        const hint = h('div', {
          class: 'ie-replace-hint',
          'aria-hidden': 'true',
          text: t('editor.inline.media.dblClickReplace', 'Double-click to replace'),
        });
        overlay.place(hint, photo, 'inset-bottom-right', 8);
      }
    }
  }

  // ----------------------------------------------------------------
  // Drag & drop image upload onto empty canvas placeholders
  // ----------------------------------------------------------------
  /** True only for an external file drag (not an internal card-reorder drag,
   *  which carries `text/plain`). Guards against hijacking reorder drops. */
  function isFileDrag(e) {
    const types = e.dataTransfer?.types;
    return !!types && Array.from(types).includes('Files');
  }

  /**
   * Wire dragenter/over/leave/drop on the given elements so dropping an image
   * file uploads it and attaches it to `photo`'s slot. `els` share one depth
   * counter so the highlight doesn't flicker when the cursor crosses between the
   * placeholder and its centered chip; `outlineBox` gets the drop highlight.
   */
  function wireImageDrop(els, photo, outlineBox) {
    let depth = 0;
    const setActive = (on) => outlineBox?.classList.toggle('is-drop-active', !!on);
    for (const el of els) {
      el.addEventListener('dragenter', (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        depth += 1;
        setActive(true);
      });
      el.addEventListener('dragover', (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('dragleave', (e) => {
        if (!isFileDrag(e)) return;
        depth = Math.max(0, depth - 1);
        if (depth === 0) setActive(false);
      });
      el.addEventListener('drop', (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth = 0;
        setActive(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) handleDroppedImage(photo, file);
      });
    }
  }

  /** Upload a dropped file and write its URL onto the placeholder's image field,
   *  through the same dirty/save/rerender path as a popover pick. */
  async function handleDroppedImage(photoEl, file) {
    if (!file.type?.startsWith('image/')) {
      toast(t('editor.inline.media.dropInvalid', 'That is not an image file.'), {
        type: 'error',
      });
      return;
    }
    const target = resolveMediaTarget(photoEl);
    if (!target) return;
    // Long-lived "Uploading…" toast; dismissed explicitly on completion (there
    // is no infinite duration, so cap it well past a realistic upload).
    const uploading = toast(t('imageLibrary.uploading', 'Uploading…'), { durationMs: 60000 });
    try {
      const { url } = await uploadFile(api, file);
      if (!url) throw new Error('no url');
      target.member[target.imageField] = url;
      // Raw uploads carry no provider metadata, so clear any stale ImageKit id
      // and leave alt empty for the user to fill or AI-generate.
      delete target.member.imagekitFileId;
      markDirty?.();
      requestSave?.();
      rerenderEditor?.();
      rerenderPreview?.();
    } catch {
      toast(t('editor.inline.media.dropFailed', 'Upload failed. Please try again.'), {
        type: 'error',
      });
    } finally {
      uploading?.dismiss?.();
    }
  }

  /**
   * Open the image picker on the photo element with the given data-inline-photo
   * index in the CURRENT slide DOM. Used by the convert flow: after "+ Add
   * image" converts a text slide, the fresh placeholder opens the picker right
   * away. No-op when the element isn't there (e.g. an async server-rendered
   * custom type) - the placeholder itself stays clickable.
   */
  function openMediaByIndex(idx) {
    const el = slideEl()?.querySelector(`[data-inline-photo="${idx}"]`);
    if (el) openPickerForPhoto(el);
  }

  /**
   * Resolve the slide member + field keys a photo placeholder writes to, shared
   * by the image picker (openPickerForPhoto) and the drag & drop upload handler.
   *
   * Array mode: mutate the item at `idx` in `list`. Flat mode (no `list`):
   * mutate slide.content directly, substituting `{n}` -> idx in the field keys
   * (single-image types use plain keys with idx 0; content-columns templates
   * col{n}Image / col{n}Alt off the 1-based column number).
   *
   * @returns {{slide, media, idx, member, imageField, altField, extraFields}|null}
   */
  function resolveMediaTarget(photoEl) {
    const slide = getSlide?.();
    const descriptor = slide
      ? getInlineDescriptor(slide.type, getSlideDef?.(slide.type))
      : null;
    const media = descriptor?.media;
    if (!slide || !media || typeof openImagePicker !== 'function') return null;
    const idx = Number(photoEl.getAttribute('data-inline-photo'));
    if (!Number.isInteger(idx)) return null;

    let member;
    let imageField;
    let altField;
    let extraFields;
    if (media.list) {
      const arr = getByPath(slide.content, media.list);
      if (!Array.isArray(arr)) return null;
      // Renderers may draw placeholder cells beyond the current array (e.g.
      // image-text rows padding to their cell count); create the item we mutate
      // in place.
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
    return { slide, media, idx, member, imageField, altField, extraFields };
  }

  // The element a canvas interaction selects, for the selection-aware
  // inspector. Only types with an element tab participate; a click that maps to
  // nothing selectable clears the selection (back to slide-only).
  function elementForCardPath(path) {
    const slide = getSlide?.();
    if (!slide) return null;
    if (slide.type === 'icon-card-grid-slide') {
      const m = /^items\.(\d+)(?:\.|$)/.exec(String(path || ''));
      if (m) return { kind: 'card', idx: Number(m[1]) };
    }
    return null;
  }

  /**
   * Set or replace a photo's image straight from the canvas: open the shared
   * image picker (library / upload / ImageKit) on the resolved target and write
   * the pick. Alt, fit, focus and delete all live in the inspector's "This
   * image" tab now, so this is purely the pick step. After a pick the element
   * is selected and its inspector tab opened, so the just-added image's other
   * settings are one glance away.
   */
  function openPickerForPhoto(photoEl) {
    const target = resolveMediaTarget(photoEl);
    if (!target) return;
    const { slide, idx, member, imageField, altField } = target;
    const activeLang = normalizeLang?.(pres?.i18n?.active) || 'nl';
    openImagePicker({
      title: t('editor.image.libraryTitle', 'Images'),
      docId: pres?.id || '',
      context: {
        presentationTitle: typeof pres?.title === 'string' ? pres.title : '',
        slideId: slide?.id || '',
        slideType: slide?.type || '',
        slideTitle:
          slide?.content && typeof slide.content.title === 'string' ? slide.content.title : '',
      },
      onPick: (picked) => {
        member[imageField] = picked?.url || '';
        // Keep the provider id in lock-step with the URL (see applyPickMeta).
        if (picked?.providerId) member.imagekitFileId = picked.providerId;
        else delete member.imagekitFileId;
        // Seed alt from the pick's active-language metadata (or single seed),
        // but never clobber an alt the user already wrote.
        const alts = picked?.alts && typeof picked.alts === 'object' ? picked.alts : null;
        const seed = (alts ? alts[activeLang] : picked?.alt) || '';
        if (altField && !String(member[altField] || '').trim() && seed) {
          member[altField] = seed;
        }
        markDirty?.();
        requestSave?.();
        rerenderEditor?.();
        rerenderPreview?.();
        // Show where the rest of this image's settings live.
        onOpenElementSettings?.({ kind: 'image', idx });
      },
    });
  }

  // ----------------------------------------------------------------
  // Focal-point drag (descriptor `focus`)
  // ----------------------------------------------------------------
  // A handle on each filled, cropped image sets the crop focus
  // (object-position) by direct manipulation, replacing a trip to the 3x3 grid
  // in the inspector. The handle updates the image live during the drag; the
  // model write + save happens on pointerup (same dirty/save path as the
  // popover), with no rerender mid-drag - the inline style already reflects it.
  const clampPct = (n) => Math.max(0, Math.min(100, n));
  const focusNum = (v) => {
    if (v === '' || v == null) return 50;
    const n = Number(v);
    return Number.isFinite(n) ? clampPct(n) : 50;
  };

  /**
   * Resolve where a photo's focal point reads/writes: reuse resolveMediaTarget
   * for the member object + index, then the descriptor's `focus` knob for the
   * field keys, the crop mode, and (optionally) the effective initial value.
   * @returns {{idx:number, member:Object, xKey:string, yKey:string,
   *   cropMode:string, initial:{x:number, y:number}}|null}
   */
  function resolveFocusTarget(photoEl) {
    const base = resolveMediaTarget(photoEl);
    if (!base) return null;
    const slide = getSlide?.();
    const descriptor = slide
      ? getInlineDescriptor(slide.type, getSlideDef?.(slide.type))
      : null;
    const focus = descriptor?.focus;
    if (!focus) return null;
    const { idx, member, media } = base;
    const sub = (s) => (media.list ? s : String(s).replace('{n}', String(idx)));
    const xKey = sub(focus.xField);
    const yKey = sub(focus.yField);
    const cropMode =
      typeof focus.cropMode === 'function' ? focus.cropMode(slide, idx) : 'cover';
    const raw =
      typeof focus.get === 'function'
        ? focus.get(slide, idx)
        : { x: member[xKey], y: member[yKey] };
    return {
      idx,
      member,
      xKey,
      yKey,
      cropMode,
      initial: { x: focusNum(raw?.x), y: focusNum(raw?.y) },
    };
  }

  /** A draggable focal point on each filled image whose current mode crops. */
  function insertFocusAffordances(root, _def, descriptor) {
    if (!descriptor.focus || !descriptor.media?.photoSelector) return;
    for (const photo of root.querySelectorAll(descriptor.media.photoSelector)) {
      if (photo.classList.contains('is-empty')) continue; // filled images only
      const ft = resolveFocusTarget(photo);
      if (!ft || ft.cropMode !== 'cover') continue; // crop focus only
      const pt = overlay.focusPoint(photo, ft.initial);
      pt.title = t('editor.inline.focus.hint', 'Drag to set image focus');
      wireFocusDrag(pt, photo, ft);
    }
  }

  function wireFocusDrag(pt, photo, ft) {
    let dragging = false;
    // object-position lives on the <img>. Some types tag the wrapper as the
    // photo element (content-columns' .cc-image div holds the img inside), so
    // resolve the actual image for the live style; the wrapper still gives the
    // rect for pointer mapping (the img fills it).
    const styleTarget =
      photo.tagName === 'IMG' ? photo : photo.querySelector('img') || photo;
    const toPct = (e) => {
      const r = photo.getBoundingClientRect();
      return {
        x: clampPct(((e.clientX - r.left) / (r.width || 1)) * 100),
        y: clampPct(((e.clientY - r.top) / (r.height || 1)) * 100),
      };
    };
    const apply = ({ x, y }) => {
      pt.dataset.fx = String(x);
      pt.dataset.fy = String(y);
      pt.setAttribute('aria-valuetext', `${Math.round(x)}% ${Math.round(y)}%`);
      overlay.reposition();
      styleTarget.style.objectPosition = `${x}% ${y}%`;
    };
    const commit = () => {
      ft.member[ft.xKey] = Math.round(focusNum(pt.dataset.fx));
      ft.member[ft.yKey] = Math.round(focusNum(pt.dataset.fy));
      markDirty?.();
      requestSave?.();
    };
    pt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      pt.classList.add('is-dragging');
      try {
        pt.setPointerCapture(e.pointerId);
      } catch {
        /* pointer capture is best-effort */
      }
    });
    pt.addEventListener('pointermove', (e) => {
      if (dragging) apply(toPct(e));
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      pt.classList.remove('is-dragging');
      try {
        pt.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      commit();
    };
    pt.addEventListener('pointerup', end);
    pt.addEventListener('pointercancel', end);
    // Keyboard: arrows nudge (Shift = fine 1%, else 5%), Home centers. Writes +
    // saves per keypress; no rerender, so focus stays on the handle for repeats.
    pt.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 1 : 5;
      let x = focusNum(pt.dataset.fx);
      let y = focusNum(pt.dataset.fy);
      switch (e.key) {
        case 'ArrowLeft': x -= step; break;
        case 'ArrowRight': x += step; break;
        case 'ArrowUp': y -= step; break;
        case 'ArrowDown': y += step; break;
        case 'Home': x = 50; y = 50; break;
        default: return;
      }
      e.preventDefault();
      e.stopPropagation();
      apply({ x: clampPct(x), y: clampPct(y) });
      commit();
    });
    // A tap on the handle must not bubble to the image click (select + open tab).
    pt.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  // Fit (Cover/Contain) and the per-image "Settings" doorway used to live on
  // the image itself (a floating pill + a chip). Both moved into the inspector's
  // "This image" element tab: fit is a discrete choice (inspector material), and
  // a single click on the image now opens that tab directly, so no chip is
  // needed. Nothing renders ON the image except the focal-point handle (direct
  // manipulation) and the empty-slot "+ Add image" affordance.

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
    onSelectElement?.(elementForCardPath(path));
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
    // Dual-model types (logo-wall, team-cards) canonicalize to their array form
    // before decorating, so the media popover / card affordances always have a
    // stable array to write to. Idempotent and non-dirtying (the rendered
    // output is unchanged); an actual edit is what marks the deck dirty.
    if (typeof descriptor.ensure === 'function' && slide?.content) {
      try {
        descriptor.ensure(slide.content);
      } catch {
        /* canonicalization is best-effort; decoration still proceeds */
      }
    }
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
    insertFocusAffordances(root, def, descriptor);
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
    if (target.closest('.ie-ghost, .ie-card-add, .ie-card-remove, .ie-clear, .ie-media-hint, .ie-focus-point, .ie-sel-toolbar')) {
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

    // Item photos: a single click selects the image and opens its "This image"
    // inspector tab (Replace / alt / fit / focus all live there). An empty slot
    // has nothing to settle on yet, so it opens the picker straight away.
    // Replacing a filled image is the double-click (see onThumbDblClick).
    const photoEl = target.closest('[data-inline-photo]');
    if (photoEl && thumb.contains(photoEl)) {
      coach.dismiss();
      e.preventDefault();
      e.stopPropagation();
      if (photoEl.classList.contains('is-empty')) {
        openPickerForPhoto(photoEl);
      } else {
        const target2 = resolveMediaTarget(photoEl);
        onOpenElementSettings?.({ kind: 'image', idx: target2 ? target2.idx : 0 });
      }
      return;
    }

    const fieldEl = target.closest('[data-inline-field]');
    if (!fieldEl || !thumb.contains(fieldEl)) {
      // A click on a non-element area of the slide clears the selection.
      onSelectElement?.(null);
      return;
    }
    coach.dismiss();
    e.preventDefault();
    e.stopPropagation();

    const def = currentDef();
    if (!def) return;
    const path = fieldEl.getAttribute('data-inline-field');
    // Editing a card's text selects that card; any other text clears selection.
    onSelectElement?.(elementForCardPath(path));
    const meta = fieldMetaForPath(def, path);
    const kind =
      meta?.type === 'csv'
        ? 'csv'
        : meta?.type === 'markdown' || fieldEl.dataset.inlineKind === 'markdown'
        ? 'markdown'
        : 'text';
    if (kind === 'csv') openCsvModal(fieldEl, path, meta);
    else if (kind === 'markdown') openMarkdownEdit(fieldEl, path, meta);
    else beginTextEdit(fieldEl, path, meta);
  }

  /**
   * Markdown field entry: edit in place when the serializer provably
   * round-trips this content; otherwise the canonical raw-markdown modal
   * (tables, code, math, renderer edge cases).
   */
  function openMarkdownEdit(fieldEl, path, meta) {
    const slide = getSlide?.();
    const raw = slide ? String(getByPath(slide.content, path) ?? '') : '';
    if (canInlineEditMarkdown(raw, markdownToSafeHtml)) {
      beginRichEdit(fieldEl, path, meta);
    } else {
      openMarkdownModal(fieldEl, path, meta);
    }
  }

  thumb.addEventListener('click', onThumbClickCapture, true);

  // Double-click a filled image to replace it: the fast path that keeps the
  // slide clear of on-image controls. (Single click selects + opens the tab.)
  function onThumbDblClick(e) {
    if (!getCanEdit?.()) return;
    if (isCommentAddMode?.()) return;
    const target = e.target;
    if (!target || !target.closest) return;
    if (target.closest('.ie-focus-point')) return; // handled by the focal point
    const photoEl = target.closest('[data-inline-photo]');
    if (photoEl && thumb.contains(photoEl) && !photoEl.classList.contains('is-empty')) {
      e.preventDefault();
      e.stopPropagation();
      openPickerForPhoto(photoEl);
    }
  }
  thumb.addEventListener('dblclick', onThumbDblClick, true);

  function isEditing() {
    return !!editing || !!closeMarkdownModal;
  }

  function destroy() {
    thumb.removeEventListener('click', onThumbClickCapture, true);
    thumb.removeEventListener('dblclick', onThumbDblClick, true);
    thumb.removeEventListener('pointermove', onThumbPointerMove);
    thumb.removeEventListener('pointerleave', onThumbPointerLeave);
    if (repositionRaf) cancelAnimationFrame(repositionRaf);
    overlay.destroy();
    coach.destroy();
    cancelCommitRerender();
    dismissMarkdownModal();
    restoreThumbTitle();
    if (editing) {
      try {
        editing.toolbar?.destroy();
        editing.el.removeEventListener('keydown', onEditKeydown);
        editing.el.removeEventListener('input', onEditInput);
        editing.el.removeEventListener('paste', onRichPaste);
        editing.el.removeEventListener('blur', onEditBlur);
        editing.el.removeAttribute('contenteditable');
        editing.el.classList.remove('ie-editing', 'ie-editing-rich');
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
