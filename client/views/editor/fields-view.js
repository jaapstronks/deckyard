/**
 * Fields: the second working posture on a slide's content, as a form in the
 * canvas column (D335, B703 PR 2).
 *
 * The canvas is for shaping a slide, this form for writing and checking it:
 * every content field in schema order, Tab from one to the next, empty
 * optional fields present as fields, item lists as rows, chart data as a
 * summary with "Edit data…", presenter notes last. Settings never render here
 * (the `bulk` surface carries `fields: 'content'`); the inspector beside the
 * column stays their one home.
 *
 * A slide head sits on top: a small live preview, the slide number, the title
 * field and the way back to the canvas. A click on the preview goes back to
 * the canvas at the field that was clicked. The head folds away to give the
 * form the height; that choice is remembered.
 *
 * The view owns no selection: the slide list, the keyboard and undo move the
 * selection through the editor's seams, and the controller calls `sync()`
 * whenever its own form rerenders.
 */

import { mountSlideInto } from '../../lib/slide-runtime/slide-render.js';
import { attachThumbScaleContain } from '../../lib/slide-runtime/thumb-scale.js';
import { resolveDeckLang } from '../../../shared/i18n-utils.js';
import { storage } from '../../lib/storage.js';
import { icon } from '../../lib/dom/icons.js';
import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom/index.js';

const HEAD_COLLAPSED_KEY = 'deckyard.fieldsView.headCollapsed';

/**
 * @param {Object} opts
 * @param {Object} opts.pres - the presentation model (live reference)
 * @param {() => string|null} opts.getSelectedSlideId
 * @param {() => Object} [opts.getTheme] - the current theme, for the preview
 * @param {(slideId: string) => ('author'|'other'|null)} [opts.getSlideLockKind]
 *   - the editor's state-driven lock seam; a locked slide's form is inert
 * @param {(formMount: HTMLElement, hooks: { refreshPreview: Function,
 *   onRendered: Function }) => Function} opts.createFormRenderer - builds the
 *   form on `formMount` and returns its rerender function. The controller
 *   makes it from createRerenderEditor on the `bulk` surface, so the view
 *   reuses the exact form machinery of the inspector.
 * @param {(fieldKey: string|null) => void} opts.onEditOnCanvas - switch the
 *   column to the canvas, at this field when one is named
 * @param {HTMLElement} [opts.notesEl] - the presenter-notes strip; it moves
 *   into the form while the view shows and back when it hides
 * @returns {{ el: HTMLElement, show: () => void, hide: (home?: HTMLElement)
 *   => void, isShown: () => boolean, sync: () => void, refreshPreview: ()
 *   => void, detach: () => void }}
 */
export function createFieldsView({
  pres,
  getSelectedSlideId,
  getTheme,
  getSlideLockKind,
  createFormRenderer,
  onEditOnCanvas,
  notesEl = null,
}) {
  let shown = false;
  let renderedSlideId = null;
  let previewRaf = 0;
  let detachScale = null;

  // ---- Slide head: preview | number, title, back to canvas | fold ----
  const thumb = h('div', { class: 'thumb fields-view-thumb' });
  const previewBtn = h(
    'button',
    {
      type: 'button',
      class: 'fields-view-preview',
      title: t('editor.fieldsView.previewTitle', 'Edit this on the canvas'),
      'aria-label': t(
        'editor.fieldsView.previewTitle',
        'Edit this on the canvas',
      ),
      onclick: (ev) => {
        const fieldEl = ev.target?.closest?.('[data-inline-field]');
        onEditOnCanvas(fieldEl?.getAttribute('data-inline-field') || null);
      },
    },
    [thumb],
  );
  const counter = h('span', { class: 'fields-view-counter' });
  const titleSlot = h('div', { class: 'fields-view-title-slot' });
  const canvasBtn = h('button', {
    type: 'button',
    class: 'btn btn-secondary btn-sm fields-view-to-canvas',
    text: t('editor.fieldsView.toCanvas', 'Edit on canvas →'),
    onclick: () => onEditOnCanvas(null),
  });
  const foldBtn = h('button', {
    type: 'button',
    class: 'ghost-icon-btn fields-view-fold',
    onclick: () => setHeadCollapsed(!headCollapsed),
  });
  const meta = h('div', { class: 'stack fields-view-meta' }, [
    h('div', { class: 'row is-between fields-view-meta-row' }, [
      counter,
      foldBtn,
    ]),
    titleSlot,
    h('div', { class: 'row' }, [canvasBtn]),
  ]);
  const head = h('header', { class: 'fields-view-head' }, [previewBtn, meta]);

  const lockedNote = h('div', { class: 'fields-view-locked-note' });
  lockedNote.hidden = true;
  const formMount = h('div', { class: 'fields-view-form' });
  const notesSlot = h('div', { class: 'fields-view-notes' });
  const sheet = h('div', { class: 'fields-view-sheet' }, [
    head,
    lockedNote,
    formMount,
    notesSlot,
  ]);
  const el = h(
    'section',
    {
      class: 'fields-view',
      'aria-label': t('editor.canvasTabs.fields', 'Fields'),
    },
    [sheet],
  );
  el.hidden = true;

  let headCollapsed = storage.getBool(HEAD_COLLAPSED_KEY, false);
  function setHeadCollapsed(next) {
    headCollapsed = !!next;
    storage.setBool(HEAD_COLLAPSED_KEY, headCollapsed);
    applyHeadCollapsed();
  }
  function applyHeadCollapsed() {
    head.classList.toggle('is-collapsed', headCollapsed);
    previewBtn.hidden = headCollapsed;
    const label = headCollapsed
      ? t('editor.fieldsView.showPreview', 'Show slide preview')
      : t('editor.fieldsView.hidePreview', 'Hide slide preview');
    foldBtn.title = label;
    foldBtn.setAttribute('aria-label', label);
    foldBtn.setAttribute('aria-expanded', headCollapsed ? 'false' : 'true');
    foldBtn.replaceChildren(
      icon(headCollapsed ? 'chevron-down' : 'chevron-up', { size: 16 }),
    );
  }
  applyHeadCollapsed();

  const currentSlide = () =>
    pres.slides.find((s) => s.id === getSelectedSlideId?.()) || null;

  // ---- Live preview: static, follows every keystroke ----
  function refreshPreview() {
    if (!shown || previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0;
      const slide = currentSlide();
      if (!slide) return;
      mountSlideInto(thumb, slide, {
        theme: getTheme?.(),
        presentationId: pres?.id,
        renderVia: { kind: 'deck', id: pres?.id },
        lang: resolveDeckLang(pres),
      });
    });
  }

  // The title field heads the form beside the preview. The form renders it
  // in schema order like any field; after every render (also the form's own,
  // after a structural edit) it moves into the head.
  function liftTitle() {
    const titleEl = formMount.querySelector(
      ':scope > .editor-form > [data-collab-field-key="title"]',
    );
    titleSlot.replaceChildren(...(titleEl ? [titleEl] : []));
    titleSlot.hidden = !titleEl;
  }

  const rerenderForm = createFormRenderer(formMount, {
    refreshPreview,
    onRendered: liftTitle,
  });

  function render() {
    const slide = currentSlide();
    renderedSlideId = slide?.id || null;
    if (!slide) {
      formMount.replaceChildren();
      titleSlot.replaceChildren();
      return;
    }
    const idx = pres.slides.indexOf(slide);
    counter.textContent = t(
      'editor.fieldsView.counter',
      'Slide {n} of {total}',
      {
        n: String(idx + 1),
        total: String(pres.slides.length),
      },
    );
    // A locked slide (author lock, or another editor holding it) reads but
    // does not take input; the same seam gates the canvas.
    const lockKind = getSlideLockKind?.(slide.id) || null;
    el.classList.toggle('is-locked', !!lockKind);
    lockedNote.hidden = !lockKind;
    lockedNote.textContent =
      lockKind === 'author'
        ? t('editor.authorLocked.banner', 'This slide is locked by the author')
        : lockKind
          ? t(
              'editor.slideLocked.banner',
              'This slide is being edited by someone else',
            )
          : '';
    rerenderForm();
    refreshPreview();
  }

  /**
   * Catch up with the editor after it rerendered its own form: a different
   * slide always renders; the same slide renders unless the user is typing in
   * this form (their keystrokes are the latest truth, and a rebuild would
   * take the caret away).
   */
  function sync() {
    if (!shown) return;
    const typingHere = el.contains(document.activeElement);
    if (getSelectedSlideId?.() !== renderedSlideId || !typingHere) render();
    else refreshPreview();
  }

  function show() {
    if (shown) return;
    shown = true;
    el.hidden = false;
    if (notesEl) notesSlot.append(notesEl);
    detachScale = attachThumbScaleContain(thumb, {
      containerEl: previewBtn,
      padding: 0,
    });
    render();
  }

  /** @param {HTMLElement} [home] - where the notes strip goes back to */
  function hide(home) {
    if (!shown) return;
    shown = false;
    el.hidden = true;
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    detachScale?.();
    detachScale = null;
    if (notesEl && home) home.append(notesEl);
    renderedSlideId = null;
  }

  return {
    el,
    show,
    hide,
    isShown: () => shown,
    sync,
    refreshPreview,
    detach: () => hide(),
  };
}
