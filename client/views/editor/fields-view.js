/**
 * Fields: the second working posture on a slide's content, as a form (D335,
 * B703).
 *
 * The canvas is for shaping a slide, this form for writing and checking it:
 * every content field in schema order, Tab from one to the next, empty
 * optional fields present as fields, item lists as rows, chart data as a
 * summary with "Edit data…", presenter notes last.
 *
 * One form, two contexts ({@link FIELDS_CONTEXTS}); the context decides the
 * form surface (editor-form/surfaces.js):
 *
 * - `deck`: the deck editor's canvas column. The inspector stands beside it and
 *   is the one home of every setting, so the form carries content only (the
 *   `fields` surface). The head counts the slide and leads back to the canvas.
 * - `library`: the slide-library editor (single-slide-editor.js). No canvas
 *   and no inspector stand beside it, so the form is the slide's one editing
 *   surface there and carries the settings too (the `library` surface).
 *
 * A slide head sits on top: a small live preview, the slide number, the title
 * field and, in the deck, the way back to the canvas. A click on the preview
 * goes back to the canvas at the field that was clicked. The head folds away
 * to give the form the height; that choice is remembered.
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
 * The contexts the Fields form runs in, as one declared table: the view reads
 * a context's row and never branches on its name.
 *
 * - `surface`: the editor-form surface the host renders the form on.
 * - `canvas`: there is a canvas to go back to ("Edit on canvas →" and a
 *   clickable preview).
 * - `counter`: the head shows "Slide n of N".
 *
 * @type {Readonly<Record<string, Readonly<{surface: string, canvas: boolean,
 *   counter: boolean}>>>}
 */
export const FIELDS_CONTEXTS = Object.freeze({
  deck: Object.freeze({ surface: 'fields', canvas: true, counter: true }),
  library: Object.freeze({ surface: 'library', canvas: false, counter: false }),
});

/**
 * Keep the inspector in step with edits made in the Fields form beside it.
 *
 * A field can stand in both forms: the inspector keeps a type's URL fields
 * (the Website of an end slide) while the Fields form carries all content.
 * The inspector is a rendered form, so an edit in the Fields form left it
 * showing the value from before the edit (B875). `schedule()` re-renders it
 * once typing pauses, unless the inspector holds the focus - the same rule
 * {@link createFieldsView}'s `sync()` applies the other way round.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.inspectorEl - the inspector's form mount
 * @param {() => void} opts.rerender - re-renders the inspector form
 * @param {number} [opts.delayMs] - the typing pause to wait for
 * @returns {{ schedule: () => void, detach: () => void }}
 */
export function createInspectorFollower({
  inspectorEl,
  rerender,
  delayMs = 120,
}) {
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (inspectorEl.contains(document.activeElement)) return;
      rerender();
    }, delayMs);
  };
  const detach = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return { schedule, detach };
}

/**
 * @param {Object} opts
 * @param {'deck'|'library'} [opts.context] - where the form runs
 * @param {Object} opts.pres - the presentation model (live reference)
 * @param {() => string|null} opts.getSelectedSlideId
 * @param {() => Object} [opts.getTheme] - the current theme, for the preview
 * @param {Object} [opts.renderVia] - how the preview resolves its theme;
 *   defaults to the deck (`{ kind: 'deck', id: pres.id }`)
 * @param {(slideId: string) => ('author'|'other'|null)} [opts.getSlideLockKind]
 *   - the editor's state-driven lock seam; a locked slide's form is inert
 * @param {(formMount: HTMLElement, hooks: { surface: string,
 *   refreshPreview: Function, onRendered: Function }) => Function}
 *   opts.createFormRenderer - builds the form on `formMount`, on the surface
 *   the context names, and returns its rerender function. The host makes it
 *   from createRerenderEditor, so the view reuses the exact form machinery of
 *   the inspector.
 * @param {(fieldKey: string|null) => void} [opts.onEditOnCanvas] - switch the
 *   column to the canvas, at this field when one is named (a context with a
 *   canvas only)
 * @param {HTMLElement} [opts.notesEl] - the presenter-notes strip; it moves
 *   into the form while the view shows and back when it hides
 * @returns {{ el: HTMLElement, show: () => void, hide: (home?: HTMLElement)
 *   => void, isShown: () => boolean, sync: () => void, refreshPreview: ()
 *   => void, detach: () => void }}
 */
export function createFieldsView({
  context = 'deck',
  pres,
  getSelectedSlideId,
  getTheme,
  renderVia = null,
  getSlideLockKind,
  createFormRenderer,
  onEditOnCanvas,
  notesEl = null,
}) {
  const ctx = Object.hasOwn(FIELDS_CONTEXTS, context)
    ? FIELDS_CONTEXTS[context]
    : null;
  if (!ctx) throw new Error(`Unknown Fields context: ${context}`);

  let shown = false;
  let renderedSlideId = null;
  let renderOwed = false;
  let previewRaf = 0;
  let detachScale = null;

  // ---- Slide head: preview | number, title, back to canvas | fold ----
  const thumb = h('div', { class: 'thumb fields-view-thumb' });
  // With a canvas to go back to, the preview is a button; without one it is
  // a picture of the slide.
  const previewBtn = ctx.canvas
    ? h(
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
            onEditOnCanvas?.(
              fieldEl?.getAttribute('data-inline-field') || null,
            );
          },
        },
        [thumb],
      )
    : h('div', { class: 'fields-view-preview is-static' }, [thumb]);
  const counter = h('span', { class: 'fields-view-counter' });
  counter.hidden = !ctx.counter;
  const titleSlot = h('div', { class: 'fields-view-title-slot' });
  const canvasBtn = ctx.canvas
    ? h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm fields-view-to-canvas',
        text: t('editor.fieldsView.toCanvas', 'Edit on canvas →'),
        onclick: () => onEditOnCanvas?.(null),
      })
    : null;
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
    ...(canvasBtn ? [h('div', { class: 'row' }, [canvasBtn])] : []),
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
      class: `fields-view is-${context}`,
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
        renderVia: renderVia || { kind: 'deck', id: pres?.id },
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
    surface: ctx.surface,
    refreshPreview,
    onRendered: liftTitle,
  });

  function render() {
    renderOwed = false;
    const slide = currentSlide();
    renderedSlideId = slide?.id || null;
    if (!slide) {
      formMount.replaceChildren();
      titleSlot.replaceChildren();
      return;
    }
    if (ctx.counter) {
      const idx = pres.slides.indexOf(slide);
      counter.textContent = t(
        'editor.fieldsView.counter',
        'Slide {n} of {total}',
        {
          n: String(idx + 1),
          total: String(pres.slides.length),
        },
      );
    }
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
   * take the caret away). A skipped render is owed, not dropped: it runs once
   * the focus leaves the form, or a remote reorder would stay on screen in
   * the old order for good (DY-781).
   */
  function sync() {
    if (!shown) return;
    const typingHere = el.contains(document.activeElement);
    if (getSelectedSlideId?.() !== renderedSlideId || !typingHere) {
      render();
    } else {
      renderOwed = true;
      refreshPreview();
    }
  }

  // Focus may just be moving between fields inside the form.
  el.addEventListener('focusout', () => {
    if (!renderOwed) return;
    setTimeout(() => {
      if (shown && renderOwed && !el.contains(document.activeElement)) render();
    }, 0);
  });

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
