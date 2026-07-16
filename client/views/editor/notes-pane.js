import { t } from '../../lib/ui-i18n.js';

/**
 * Presenter-notes pane for the inspector rail (chrome re-org stap 2).
 *
 * Replaces the always-visible notes block under the canvas: notes are
 * rarely used and, once written, only matter again while presenting - so
 * they live out of sight in the rail, next to settings and comments.
 *
 * The textarea keeps the seams the old block carried:
 * - `data-collab-field-key="notes"` for presence focus rings, and
 * - the element itself is handed to the live-edits binder / search focus
 *   as `previewNotesTa` (panes are persistent DOM, so the reference holds).
 *
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Object} options.pres - Presentation model
 * @param {Function} options.getSelectedSlideId
 * @param {Function} options.markDirty
 * @param {Function} [options.onOpenQr] - Opens the phone companion (QR) view
 * @param {Function} [options.onRequestClose] - × in the header; dismisses the rail
 * @returns {{ el: HTMLElement, textarea: HTMLTextAreaElement }}
 */
export function createNotesPane({
  h,
  pres,
  getSelectedSlideId,
  markDirty,
  onOpenQr,
  onRequestClose,
} = {}) {
  const el = h('div', { class: 'notes-pane' });

  const header = h('div', { class: 'row spread notes-pane-header' });
  header.append(h('h2', { class: 'editor-form-title', text: t('editor.notes.title', 'Presenter notes') }));

  const headerActions = h('div', { class: 'row notes-pane-header-actions' });
  if (typeof onOpenQr === 'function') {
    headerActions.append(
      h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        text: t('editor.notes.qr', 'Notes (QR)'),
        title: t('editor.companion.title', 'Open speaker notes companion on your phone (QR code).'),
        onclick: () => onOpenQr(),
      })
    );
  }
  if (typeof onRequestClose === 'function') {
    headerActions.append(
      h('button', {
        class: 'btn btn-secondary btn-icon',
        type: 'button',
        text: '×',
        title: t('editor.inspector.hide', 'Hide inspector'),
        'aria-label': t('editor.inspector.hide', 'Hide inspector'),
        onclick: () => onRequestClose(),
      })
    );
  }
  header.append(headerActions);

  const textarea = h('textarea', {
    class: 'form-input notes-pane-input',
    // Collab presence: focus in the notes is reported/decorated under the
    // 'notes' field path (see presence/presence-ui.js). Inert without collab.
    'data-collab-field-key': 'notes',
    placeholder: t(
      'editor.notes.placeholder',
      "Text you write here shows on your phone. Click 'Notes (QR)' to show a QR code for your phone."
    ),
  });
  textarea.addEventListener('input', () => {
    const sid = getSelectedSlideId?.();
    const slide = (pres?.slides || []).find((s) => s?.id === sid);
    if (!slide) return;
    slide.notes = textarea.value;
    markDirty?.();
  });

  const help = h('div', {
    class: 'help',
    text: t('editor.notes.savedPerSlide', 'Saved per slide.'),
  });

  const body = h('div', { class: 'panel-scroll notes-pane-body' });
  body.append(textarea, help);
  el.append(header, body);

  return { el, textarea };
}
