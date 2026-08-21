/**
 * Markdown-edit modal for the inline editor.
 *
 * The canvas offers two ways to edit a rich field: in-place (contenteditable,
 * for markdown simple enough to round-trip) and — for anything richer — this
 * centered modal with the canonical markdown editor (toolbar + textarea). The
 * modal is a self-contained concern: it owns its open element, its outside-click
 * dismissal, and its single "currently open" handle; the inline editor only
 * routes to it (openMarkdownEdit picks in-place vs. modal) and reads isOpen().
 *
 * Split out of inline-editor.js (B10 P4 seam), behaviour-preserving.
 *
 * @param {object} deps
 * @param {Function} deps.h - DOM builder.
 * @param {HTMLElement} deps.mdHost - element the modal + backdrop mount into.
 * @param {Function} deps.mdField - canonical markdown field factory (label,
 *   value, help, onChange, opts) -> element.
 * @param {() => (object|null)} deps.getSlide - current slide accessor.
 * @param {(path: string|string[], meta: object) => string} deps.fieldLabel -
 *   human label for a field path.
 * @param {() => void} deps.endActiveTextEdit - close any in-place edit first.
 * @param {() => void} [deps.markDirty] - mark the deck dirty.
 * @param {() => void} [deps.requestSave] - request a debounced save.
 * @param {() => void} [deps.rerenderEditor] - re-render the editor form.
 * @param {() => void} [deps.rerenderPreview] - re-render the slide preview.
 * @returns {{ open: Function, dismiss: Function, isOpen: () => boolean }}
 */

import { getByPath, setByPath } from './field-path.js';
import { installDismissOnOutside } from '../../../lib/dom.js';
import { createOverlay } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';

export function createMarkdownEditModal({
  h,
  mdHost,
  mdField,
  getSlide,
  fieldLabel,
  endActiveTextEdit,
  markDirty,
  requestSave,
  rerenderEditor,
  rerenderPreview,
}) {
  // The teardown for the currently-open modal, or null when none is open.
  let closeMarkdownModal = null;

  function dismiss() {
    if (closeMarkdownModal) {
      try {
        closeMarkdownModal();
      } catch {
        /* ignore */
      }
      closeMarkdownModal = null;
    }
  }

  /**
   * Open the markdown modal for a field. Any in-place edit is committed first,
   * and any already-open modal is dismissed.
   *
   * @param {string|string[]} path - field path in slide.content.
   * @param {object} meta - field metadata (maxLength, required).
   * @param {object} [opts]
   * @param {boolean} [opts.isNew] - editing a ghost-spawned empty field.
   */
  function open(path, meta, { isNew = false } = {}) {
    endActiveTextEdit();
    dismiss();
    const slide = getSlide?.();
    if (!slide) return;

    const raw = isNew ? '' : String(getByPath(slide.content, path) ?? '');
    const label = fieldLabel(path, meta);
    let latest = raw;

    // Canonical markdown editor: label + toolbar + textarea + help.
    const editorEl = mdField(
      label,
      raw,
      t(
        'editor.markdown.help',
        'Supports paragraphs, lists, bold/italic, links, code, math, and markdown tables.',
      ),
      (v) => {
        latest = v;
      },
      {
        maxLength: meta?.maxLength,
        required: !!meta?.required,
        showHeading: true,
      },
    );
    // Collab presence: while this modal is open, focus inside it reports the
    // edited field's path, so collaborators see a ring on the matching canvas
    // field (and on their own modal if they have the same field open).
    editorEl.setAttribute('data-collab-field-key', String(path));

    // Saving and cancelling both end in overlay.close(); only the cancel path
    // re-renders the preview for a ghost-spawned field, so the teardown needs
    // to know which one it is.
    let saved = false;
    const save = () => {
      saved = true;
      if (latest !== raw) {
        setByPath(slide.content, path, latest);
        markDirty?.();
        requestSave?.();
        rerenderEditor?.();
      }
      dismiss();
      rerenderPreview?.();
    };
    const cancel = () => dismiss();

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

    const modal = h('div', { class: 'ie-md-modal' }, [
      header,
      editorEl,
      footer,
    ]);
    let detach = null;
    const overlay = createOverlay({
      backdropClass: 'ie-md-backdrop',
      surface: modal,
      onClose: () => {
        detach?.();
        detach = null;
        mdHost.classList.remove('is-ie-modal-open');
        closeMarkdownModal = null;
        if (!saved && isNew) rerenderPreview?.();
      },
    });

    mdHost.classList.add('is-ie-modal-open');
    overlay.show(mdHost);

    detach = installDismissOnOutside({
      rootEl: modal,
      isOpen: () => overlay.isOpen(),
      close: cancel,
    });
    closeMarkdownModal = () => overlay.close();

    const ta = editorEl.querySelector('textarea');
    modal.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    ta?.focus();
  }

  return {
    open,
    dismiss,
    isOpen: () => !!closeMarkdownModal,
  };
}
