import { markdownToSafeHtml } from '../../../shared/markdown.js';
import { toast } from '../../lib/dom/toast.js';
import { t } from '../../lib/ui-i18n.js';
import { normalizeNotes } from './utils.js';

/** How long to wait after the last keystroke before saving. */
const AUTOSAVE_DELAY_MS = 1200;

/**
 * Speaker-notes editing for the companion.
 *
 * The companion is authorized by the live-session id in its join link, so
 * the write goes to the session-scoped endpoint
 * (`PUT /api/live-sessions/:sessionId/notes/:slideId`), never to the deck
 * route the editor uses. The visitor may not be logged in at all.
 *
 * Two things make this more than a textarea:
 *
 * - **The slide moves under you.** The companion follows the presenter, so the
 *   viewed slide can change mid-edit. Unsaved text is flushed for the slide it
 *   belongs to *before* the swap, so notes never land on the wrong slide.
 * - **The deck refreshes under you.** A `deckUpdated` event reloads the deck.
 *   While the buffer is dirty the incoming text is deliberately not applied —
 *   overwriting what someone is typing is worse than showing them a stale
 *   neighbour field. A clean buffer takes the update straight away.
 *
 * Concurrency with the desktop editor is last-write-wins on this one field, by
 * design (docs/reference/notes-companion.md, § Concurrency).
 *
 * @param {Object} options
 * @param {Function} options.api - `api()` from lib/api.js.
 * @param {string} options.sessionId - Present-session id (the capability).
 * @param {Object} options.ui - Named nodes from `buildNotesLayout()`.
 * @param {Function} [options.onSaved] - Called with (slideId, notes) after a save.
 * @returns {{
 *   setSlide: (slide: Object|null) => void,
 *   isDirty: () => boolean,
 *   flush: () => Promise<void>,
 *   destroy: () => void,
 * }}
 */
export function createNotesEditor({ api, sessionId, ui, onSaved } = {}) {
  const {
    notesBody,
    notesEditBtn,
    notesEditor,
    notesTextarea,
    notesSaveBtn,
    notesCancelBtn,
    notesStatus,
  } = ui;

  let slideId = '';
  let stored = '';
  let editing = false;
  let saving = false;
  let timer = null;
  let destroyed = false;

  // The status line always occupies its slot: hiding it would let the save row
  // jump sideways the first time a message appears, and an aria-live region has
  // to be in the DOM before the text lands to be announced at all.
  const setStatus = (text = '') => {
    notesStatus.textContent = text;
  };

  const isDirty = () => editing && notesTextarea.value !== stored;

  const renderBody = () => {
    const html = stored.trim()
      ? markdownToSafeHtml(stored)
      : `<p class="help">${t('notes.noNotes', 'No notes for this slide.')}</p>`;
    notesBody.innerHTML = html;
  };

  const applyEditingState = () => {
    notesBody.hidden = editing;
    notesEditor.hidden = !editing;
    notesEditBtn.setAttribute('aria-expanded', String(editing));
    notesEditBtn.textContent = editing
      ? t('notes.edit.done', 'Done')
      : t('notes.edit.start', 'Edit');
    notesEditBtn.hidden = !slideId;
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  /**
   * Save `value` as the notes of `targetSlideId`. Takes both explicitly so a
   * flush triggered by a slide change still writes to the slide the text was
   * typed on.
   */
  const save = async (targetSlideId, value) => {
    if (!targetSlideId || destroyed) return;
    saving = true;
    setStatus(t('notes.edit.saving', 'Saving...'));
    try {
      await api(
        `/api/live-sessions/${encodeURIComponent(sessionId)}/notes/${encodeURIComponent(targetSlideId)}`,
        { method: 'PUT', body: { notes: value } }
      );
      if (targetSlideId === slideId) {
        stored = value;
        renderBody();
        setStatus(t('notes.edit.saved', 'Saved'));
      }
      onSaved?.(targetSlideId, value);
    } catch (err) {
      const msg =
        err?.statusCode === 423
          ? t('notes.edit.locked', 'This slide is locked — your change was not saved.')
          : err?.statusCode === 429
            ? t('notes.edit.tooFast', 'Too many changes at once — try again in a moment.')
            : t('notes.edit.failed', 'Could not save the notes.');
      toast(msg, { type: 'error', id: 'notes-save' });
      if (targetSlideId === slideId) setStatus(msg);
    } finally {
      saving = false;
    }
  };

  const scheduleSave = () => {
    clearTimer();
    const targetSlideId = slideId;
    timer = setTimeout(() => {
      timer = null;
      if (notesTextarea.value !== stored) void save(targetSlideId, notesTextarea.value);
    }, AUTOSAVE_DELAY_MS);
  };

  /** Write out any pending edit right now (slide change, leaving edit mode). */
  const flush = async () => {
    clearTimer();
    if (!editing || saving) return;
    if (notesTextarea.value === stored) return;
    await save(slideId, notesTextarea.value);
  };

  notesTextarea.addEventListener('input', () => {
    setStatus(t('notes.edit.unsaved', 'Unsaved changes'));
    scheduleSave();
  });

  notesSaveBtn.addEventListener('click', () => {
    clearTimer();
    void save(slideId, notesTextarea.value);
  });

  notesCancelBtn.addEventListener('click', () => {
    clearTimer();
    notesTextarea.value = stored;
    editing = false;
    setStatus('');
    applyEditingState();
  });

  notesEditBtn.addEventListener('click', () => {
    if (editing) {
      void flush().then(() => {
        editing = false;
        setStatus('');
        applyEditingState();
      });
      return;
    }
    editing = true;
    notesTextarea.value = stored;
    setStatus('');
    applyEditingState();
    notesTextarea.focus();
  });

  /**
   * Point the editor at a slide. Called on every render, so it must be cheap
   * and must not disturb a buffer the visitor is typing into.
   *
   * @param {Object|null} slide - The slide now on screen.
   */
  const setSlide = (slide) => {
    const nextId = slide && typeof slide.id === 'string' ? slide.id : '';
    const nextNotes = normalizeNotes(slide?.notes || '');

    if (nextId === slideId) {
      // Same slide, fresh copy from the server: adopt it unless the visitor is
      // mid-edit, in which case their text wins until they save or cancel.
      if (nextNotes !== stored && !isDirty()) {
        stored = nextNotes;
        if (editing) notesTextarea.value = stored;
        renderBody();
      }
      applyEditingState();
      return;
    }

    // The slide changed. Anything unsaved belongs to the previous slide, so
    // write it there before adopting the new one.
    if (isDirty()) void save(slideId, notesTextarea.value);
    clearTimer();

    slideId = nextId;
    stored = nextNotes;
    if (editing) notesTextarea.value = stored;
    setStatus('');
    renderBody();
    applyEditingState();
  };

  return {
    setSlide,
    isDirty,
    flush,
    destroy: () => {
      // Leaving the view with an unsaved buffer would silently drop it, so send
      // it on the way out. Fire-and-forget: teardown is synchronous, and a save
      // that loses the race is no worse than not trying.
      const pending = isDirty() ? { id: slideId, value: notesTextarea.value } : null;
      clearTimer();
      if (pending) void save(pending.id, pending.value);
      destroyed = true;
    },
  };
}
