import { t } from '../../lib/ui-i18n.js';
import { chevronDownIcon } from '../../lib/dom/icons.js';

const COLLAPSE_KEY = 'deckyard.notesStrip.collapsed';

/**
 * Presenter-notes strip under the slide preview (Keynote / PowerPoint
 * convention). Replaces the inspector "Notes" pane: notes are not
 * position-bound the way comments are, so they belong with the slide - and
 * the strip fills the otherwise-empty space beneath the 16:9 stage.
 *
 * Collapsible: when collapsed only the header bar shows and the slide reclaims
 * the full canvas height. The collapsed state is remembered across slides and
 * reloads (localStorage).
 *
 * The textarea keeps the seams the old pane carried:
 * - `data-collab-field-key="notes"` for presence focus rings, and
 * - the element itself is handed to the live-edits binder / search focus as
 *   `previewNotesTa` (the strip is persistent DOM, so the reference holds).
 *
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Object} options.pres - Presentation model
 * @param {Function} options.getSelectedSlideId
 * @param {Function} options.markDirty
 * @param {Function} [options.onOpenQr] - Opens the phone companion (QR) view
 * @returns {{ el: HTMLElement, textarea: HTMLTextAreaElement }}
 */
export function createNotesStrip({
  h,
  pres,
  getSelectedSlideId,
  markDirty,
  onOpenQr,
} = {}) {
  // On a narrow screen the strip shares one stacked row with the canvas, and
  // an expanded strip leaves the slide too little height to read. Start
  // collapsed there — the header stays tappable, and an explicit choice is
  // still remembered, so this only decides the first visit.
  let collapsed = window.innerWidth <= 820;
  try {
    const stored = localStorage.getItem(COLLAPSE_KEY);
    if (stored !== null) collapsed = stored === '1';
  } catch {
    /* private mode / storage disabled: keep the width-based default */
  }

  const el = h('div', { class: 'notes-strip' });

  const toggleBtn = h('button', {
    class: 'notes-strip-toggle',
    type: 'button',
    'aria-expanded': String(!collapsed),
  });
  const chevron = chevronDownIcon({ size: 16 });
  chevron.classList.add('notes-strip-chevron');
  toggleBtn.append(
    chevron,
    h('span', { class: 'notes-strip-title', text: t('editor.notes.title', 'Presenter notes') })
  );

  const headerActions = h('div', { class: 'row notes-strip-actions' });
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

  const header = h('div', { class: 'row spread notes-strip-header' }, [toggleBtn, headerActions]);

  const textarea = h('textarea', {
    class: 'form-input notes-strip-input',
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

  const body = h('div', { class: 'notes-strip-body' }, [textarea]);
  el.append(header, body);

  const applyCollapsed = () => {
    el.classList.toggle('is-collapsed', collapsed);
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    toggleBtn.title = collapsed
      ? t('editor.notes.expand', 'Show presenter notes')
      : t('editor.notes.collapse', 'Hide presenter notes');
  };
  applyCollapsed();

  toggleBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
    applyCollapsed();
  });

  // The selected slide's notes are loaded into `textarea.value` by the
  // controller's slide-change path (previewNotesTa), same as the old pane.
  return { el, textarea };
}
