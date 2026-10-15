import { t } from '../../lib/ui-i18n.js';
import { icon } from '../../lib/dom/icons.js';
import { h } from '../../lib/dom/index.js';
import { storage } from '../../lib/storage.js';
import { COMPACT_EDITOR_QUERY, matchesQuery } from './responsive-drawers.js';

const COLLAPSE_KEY = 'deckyard.notesStrip.collapsed';
const SESSION_OPEN_KEY = 'deckyard.notesStrip.openedThisSession';

/**
 * Presenter-notes strip under the slide preview (Keynote / PowerPoint
 * convention). Replaces the inspector "Notes" pane: notes are not
 * position-bound the way comments are, so they belong with the slide - and
 * the strip fills the otherwise-empty space beneath the 16:9 stage.
 *
 * Collapsible: when collapsed only the header bar shows and the slide reclaims
 * the full canvas height. On a wide screen the collapsed state is remembered
 * across slides and reloads (localStorage). Below the D339 boundary the canvas
 * needs the height, so the strip starts folded there unless it was opened in
 * this browser session (sessionStorage) - crossing the boundary re-applies it.
 *
 * The textarea keeps the seams the old pane carried:
 * - `data-collab-field-key="notes"` for presence focus rings, and
 * - the element itself is handed to the live-edits binder / search focus as
 *   `previewNotesTa` (the strip is persistent DOM, so the reference holds).
 *
 * @param {Object} options
 * @param {Object} options.pres - Presentation model
 * @param {Function} options.getSelectedSlideId
 * @param {Function} options.markDirty
 * @param {Function} [options.onOpenQr] - Opens the phone companion (QR) view
 * @returns {{ el: HTMLElement, textarea: HTMLTextAreaElement, detach: Function }}
 */
export function createNotesStrip({
  pres,
  getSelectedSlideId,
  markDirty,
  onOpenQr,
} = {}) {
  // Session flag: "opened in this session" (D339). sessionStorage access can
  // throw (storage disabled), so both helpers swallow that.
  const openedThisSession = () => {
    try {
      return sessionStorage.getItem(SESSION_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  };
  const setOpenedThisSession = (opened) => {
    try {
      if (opened) sessionStorage.setItem(SESSION_OPEN_KEY, '1');
      else sessionStorage.removeItem(SESSION_OPEN_KEY);
      // eslint-disable-next-line no-restricted-syntax -- storage disabled: the strip still toggles, it only forgets the choice
    } catch {
      /* ignore */
    }
  };

  const collapsedForWidth = () =>
    matchesQuery(COMPACT_EDITOR_QUERY)
      ? !openedThisSession()
      : storage.getBool(COLLAPSE_KEY, false);

  let collapsed = collapsedForWidth();

  const el = h('div', { class: 'notes-strip' });

  const toggleBtn = h('button', {
    class: 'notes-strip-toggle',
    type: 'button',
    'aria-expanded': String(!collapsed),
  });
  const chevron = icon('chevron-down', {
    size: 16,
    className: 'notes-strip-chevron',
  });
  toggleBtn.append(
    chevron,
    h('span', {
      class: 'notes-strip-title',
      text: t('editor.notes.title', 'Presenter notes'),
    }),
  );

  const headerActions = h('div', { class: 'row notes-strip-actions' });
  if (typeof onOpenQr === 'function') {
    headerActions.append(
      h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        text: t('editor.notes.qr', 'Notes (QR)'),
        title: t(
          'editor.companion.title',
          'Open speaker notes companion on your phone (QR code).',
        ),
        onclick: () => onOpenQr(),
      }),
    );
  }

  const header = h('div', { class: 'row spread notes-strip-header' }, [
    toggleBtn,
    headerActions,
  ]);

  const textarea = h('textarea', {
    class: 'form-input notes-strip-input',
    // Collab presence: focus in the notes is reported/decorated under the
    // 'notes' field path (see presence/presence-ui.js). Inert without collab.
    'data-collab-field-key': 'notes',
    placeholder: t(
      'editor.notes.placeholder',
      "Text you write here shows on your phone. Click 'Notes (QR)' to show a QR code for your phone.",
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
    if (matchesQuery(COMPACT_EDITOR_QUERY)) setOpenedThisSession(!collapsed);
    else storage.setBool(COLLAPSE_KEY, collapsed);
    applyCollapsed();
  });

  const media = window.matchMedia?.(COMPACT_EDITOR_QUERY) || null;
  const handleMediaChange = () => {
    collapsed = collapsedForWidth();
    applyCollapsed();
  };
  media?.addEventListener?.('change', handleMediaChange);

  const detach = () => {
    media?.removeEventListener?.('change', handleMediaChange);
  };

  // The selected slide's notes are loaded into `textarea.value` by the
  // controller's slide-change path (previewNotesTa), same as the old pane.
  return { el, textarea, detach };
}
