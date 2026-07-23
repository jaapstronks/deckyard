/**
 * Whole-deck AI review: the deck grid with the AI annotation layer over a
 * freshly generated (or any AI-annotated) deck. Every slide shows why its
 * type was picked, alternatives are swappable, and a multi-selection can be
 * revised as a section ("Adjust section"): the server regenerates the
 * selected range from (section + neighbours + deck summary + feedback + type
 * catalog) and the revision replaces the range in place.
 *
 * Opens automatically after AI deck generation (?aiReview=1) — the deck is
 * already created, so "Discard deck" deletes it (create-then-review model);
 * section revisions apply to the live deck and are undoable via editor undo.
 */
import { t } from '../../../lib/ui-i18n.js';
import { openModal, confirmModal } from '../../../lib/dom/modal.js';
import { toast } from '../../../lib/dom/toast.js';
import { createDeckGridView } from '../deck-grid.js';
import { createAiReviewAnnotations } from '../ai-review-annotations.js';

/**
 * @param {Object} options
 * @param {Function} options.h
 * @param {HTMLElement} options.root
 * @param {Function} options.api
 * @param {Object} options.pres - The live presentation (mutated on revise/swap)
 * @param {Object} options.theme
 * @param {Object} options.SLIDE_TYPES
 * @param {Set} [options.openOverlayClosers]
 * @param {Object} options.editorState - dirtyRefreshAll() after mutations
 * @param {Function} [options.onJumpToSlide] - (slideId) => void
 * @param {boolean} [options.postGeneration] - Just-generated deck: offer
 *   "Discard deck" (delete + navigate back)
 * @param {Function} [options.nav] - Router navigate (for discard)
 */
export function openAiDeckReviewModal({
  h,
  root,
  api,
  pres,
  theme,
  SLIDE_TYPES,
  openOverlayClosers,
  editorState,
  onJumpToSlide,
  postGeneration = false,
  nav,
} = {}) {
  let grid = null;
  let busy = false;
  const lang = pres?.i18n?.active || null;

  const modalApi = openModal(
    h,
    root,
    {
      title: postGeneration
        ? t('editor.deckReview.titleNew', 'Review your generated deck')
        : t('editor.deckReview.title', 'Review deck'),
      hint: t(
        'editor.deckReview.hint',
        'Each slide shows why its type was picked. Click a slide for a closer look; tick one or more to revise that section as a group.'
      ),
      modalClass: 'modal-ai-review',
      onClose: () => grid?.teardown(),
    },
    openOverlayClosers
  );

  const status = h('div', { class: 'help ui-status-line' });

  const { annotationFor } = createAiReviewAnnotations({
    h,
    api,
    SLIDE_TYPES,
    lang,
    setStatus: (text) => {
      status.textContent = text || '';
    },
    // Swapping a type applies to the live deck (undo covers regret).
    replaceSlide: (slide, next) => {
      const i = (pres.slides || []).findIndex(
        (s) => s === slide || (slide.id && s.id === slide.id)
      );
      if (i < 0) return;
      pres.slides[i] = { ...next, id: pres.slides[i].id };
      editorState?.dirtyRefreshAll?.();
      grid.render();
    },
  });

  // --- Selection + section refine ------------------------------------------
  const selectionHint = h('span', { class: 'ai-review-selection-hint' });
  const btnClearSelection = h('button', {
    class: 'btn btn-secondary is-compact',
    type: 'button',
    text: t('editor.deckReview.clearSelection', 'Clear selection'),
    hidden: true,
    onclick: () => grid?.clearSelection(),
  });

  const syncSelectionUi = (ids) => {
    const n = ids.length;
    btnClearSelection.hidden = n === 0;
    btnAdjust.disabled = busy || n === 0;
    if (!n) {
      selectionHint.textContent = t(
        'editor.deckReview.selectHint',
        'Select slides to revise a section.'
      );
      return;
    }
    // The revision spans first..last selected slide, gaps included.
    const idSet = new Set(ids);
    const indices = (pres.slides || [])
      .map((s, i) => (s?.id && idSet.has(s.id) ? i : -1))
      .filter((i) => i >= 0);
    const start = Math.min(...indices) + 1;
    const end = Math.max(...indices) + 1;
    selectionHint.textContent =
      start === end
        ? t('editor.deckReview.selectedOne', 'Slide {n} selected', { n: start })
        : t('editor.deckReview.selectedRange', 'Slides {start}–{end} selected (revised as one section)', {
            start,
            end,
          });
  };

  grid = createDeckGridView({
    h,
    theme,
    SLIDE_TYPES,
    presentationId: pres?.id,
    getSlides: () => pres?.slides || [],
    annotationFor,
    selectable: true,
    previewOnClick: true,
    // The AI's per-slide rationale, shown inside the peek preview too.
    peekNoteFor: (slide) => String(slide?._aiReasoning || '').trim() || null,
    onSelectionChange: syncSelectionUi,
    // Tile click opens the preview; a corner checkbox selects. The peek
    // lightbox offers the jump into the editor.
    onTilePick: (slide) => {
      if (!slide?.id) return;
      modalApi.close();
      onJumpToSlide?.(slide.id);
    },
    tilePickLabel: t('editor.deckGrid.jumpTo', 'Go to slide'),
  });

  const feedbackTa = h('textarea', {
    class: 'form-input',
    rows: '2',
    placeholder: t(
      'editor.deckReview.feedbackPlaceholder',
      'E.g. merge these into one timeline, add per-phase descriptions, shorter texts…'
    ),
  });
  const feedbackWrap = h('div', { class: 'ai-review-feedback stack' }, [
    h('div', {
      class: 'field-label',
      text: t('editor.deckReview.feedbackLabel', 'What should change in the selected section?'),
    }),
    feedbackTa,
  ]);

  const btnAdjust = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    disabled: true,
    text: t('editor.deckReview.adjustSection', 'Adjust section'),
  });

  const setBusy = (value) => {
    busy = value;
    modalApi.setBusy(value);
    btnAdjust.disabled = value || grid.getSelectedIds().length === 0;
    btnDone.disabled = value;
    btnAdjust.classList.toggle('is-loading', value);
    if (btnDiscardDeck) btnDiscardDeck.disabled = value;
  };

  btnAdjust.onclick = async () => {
    if (busy) return;
    const slideIds = grid.getSelectedIds();
    if (!slideIds.length) return;
    const feedback = String(feedbackTa.value || '').trim();
    if (!feedback) {
      status.textContent = t(
        'editor.aiReview.feedbackRequired',
        'First describe what should change.'
      );
      feedbackTa.focus();
      return;
    }
    setBusy(true);
    status.textContent = t('editor.deckReview.revising', 'Revising section…');
    try {
      const resp = await api('/api/ai/refine-section', {
        method: 'POST',
        body: JSON.stringify({
          presentation: {
            title: pres.title,
            theme: pres.theme,
            slides: (pres.slides || []).map((s) => ({
              id: s?.id,
              type: s?.type,
              content: s?.content || {},
            })),
          },
          slideIds,
          feedback,
          ...(lang ? { lang } : {}),
        }),
      });
      const revised = Array.isArray(resp?.slides) ? resp.slides : [];
      const range = resp?.range;
      if (!revised.length || !range || typeof range.start !== 'number') {
        throw new Error(
          t('editor.deckReview.revisionFailed', 'No revised section received (please try again).')
        );
      }
      // Replace the range in the live deck; ids of the revised slides are
      // fresh, so selection/locks on the old ones simply disappear.
      pres.slides.splice(range.start, range.end - range.start + 1, ...revised);
      editorState?.dirtyRefreshAll?.();
      grid.clearSelection();
      feedbackTa.value = '';
      status.textContent = '';
      grid.render();
      toast.success(
        resp?.rationale ||
          t('editor.deckReview.revised', 'Section replaced ({count} slides)', {
            count: revised.length,
          }),
        { id: 'ai-deck-review-revised', durationMs: 7000 }
      );
    } catch (e) {
      status.textContent = String(e?.message || e);
    } finally {
      setBusy(false);
    }
  };

  // --- Footer actions -------------------------------------------------------
  let btnDiscardDeck = null;
  if (postGeneration) {
    btnDiscardDeck = h('button', {
      class: 'btn btn-danger',
      type: 'button',
      text: t('editor.deckReview.discardDeck', 'Discard deck'),
      onclick: async () => {
        if (busy) return;
        const ok = await confirmModal(h, document.body, {
          title: t('editor.deckReview.discardDeck', 'Discard deck'),
          message: t(
            'editor.deckReview.discardConfirm',
            'Delete this generated presentation? It will be moved to the trash.'
          ),
          confirmLabel: t('editor.deckReview.discardDeck', 'Discard deck'),
          danger: true,
        });
        if (!ok) return;
        setBusy(true);
        try {
          await api(`/api/presentations/${encodeURIComponent(pres.id)}`, {
            method: 'DELETE',
          });
          modalApi.close();
          nav?.('/app');
        } catch (e) {
          status.textContent = String(e?.message || e);
          setBusy(false);
        }
      },
    });
  }

  const btnDone = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: postGeneration
      ? t('editor.deckReview.keep', 'Looks good')
      : t('common.close', 'Close'),
    onclick: () => modalApi.close(),
  });

  const toolbar = h('div', { class: 'ai-review-toolbar' }, [
    selectionHint,
    btnClearSelection,
  ]);
  const actions = h('div', { class: 'row is-end modal-actions' }, [
    ...(btnDiscardDeck ? [btnDiscardDeck] : []),
    btnAdjust,
    btnDone,
  ]);

  syncSelectionUi([]);
  modalApi.append(toolbar, grid.el, feedbackWrap, status, actions);
  grid.render();

  return modalApi;
}
