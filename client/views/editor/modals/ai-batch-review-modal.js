/**
 * Batch review for AI-added slides (N≥2): an intermediary step between
 * generation and insertion. Shows the deck grid with an AI annotation layer —
 * the batch rationale, a per-slide "why this type", and swappable alternative
 * types — plus Accept / Adjust / Discard.
 *
 * "Adjust" re-generates from the original request + the prior batch + the
 * user's feedback (server revision mode) and updates the grid in place. The
 * name deliberately differs from the per-slide "Refine" flow.
 */
import { t } from '../../../lib/ui-i18n.js';
import { openModal } from '../../../lib/modal.js';
import { toast } from '../../../lib/toast.js';
import { createDeckGridView } from '../deck-grid.js';
import { createAiReviewAnnotations } from '../ai-review-annotations.js';

/**
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {HTMLElement} options.root - Element to append the modal to
 * @param {Function} options.api - API fetch function
 * @param {Object} options.theme - Resolved theme (truthful previews)
 * @param {Object} options.SLIDE_TYPES - Slide type registry
 * @param {Set} [options.openOverlayClosers]
 * @param {Object} options.batch - { slides, rationale } from /api/ai/append-slides
 * @param {Object} options.request - The original request body (raw, lang,
 *   contentOnly, verbatim, vendor, deck) used to re-run generation on Adjust
 * @param {Function} options.onAccept - (slides) => void, inserts the batch
 * @param {Function} [options.onDiscard] - () => void
 */
export function openAiBatchReviewModal({
  h,
  root,
  api,
  theme,
  SLIDE_TYPES,
  openOverlayClosers,
  batch,
  request,
  onAccept,
  onDiscard,
} = {}) {
  let slides = Array.isArray(batch?.slides) ? [...batch.slides] : [];
  let rationale = String(batch?.rationale || '');
  let busy = false;
  let grid = null;

  const modalApi = openModal(
    h,
    root,
    {
      title: t('editor.aiReview.title', 'Review AI slides'),
      hint: t(
        'editor.aiReview.hint',
        'Nothing has been added yet. Inspect the proposed slides, switch types where useful, then accept or adjust the batch.'
      ),
      modalClass: 'modal-ai-review',
      // The batch only exists in this modal until it's accepted: guard the
      // implicit close paths (Esc, backdrop, the header Close button) with a
      // confirm. The explicit Discard/Accept buttons close directly.
      isDirty: () => true,
      confirmMessage: t(
        'editor.aiReview.closeConfirm',
        'Close the review and discard the generated slides? Nothing has been added to the deck yet.'
      ),
      onClose: (result) => {
        grid?.teardown();
        if (!result?.accepted) onDiscard?.();
      },
    },
    openOverlayClosers
  );

  const rationaleEl = h('div', { class: 'ai-review-rationale' });
  const setRationale = (text) => {
    rationaleEl.textContent = text || '';
    rationaleEl.hidden = !text;
  };
  setRationale(rationale);

  const status = h('div', { class: 'help ui-status-line' });

  // AI layer under each tile (why + swappable alternatives), shared with the
  // whole-deck review. A swap replaces the slide in the local batch only.
  const { annotationFor } = createAiReviewAnnotations({
    h,
    api,
    SLIDE_TYPES,
    lang: request?.lang,
    vendor: request?.vendor,
    setStatus: (text) => {
      status.textContent = text || '';
    },
    replaceSlide: (slide, next) => {
      const i = slides.findIndex((s) => s === slide || (slide.id && s.id === slide.id));
      if (i >= 0) slides[i] = next;
      grid.render();
    },
  });

  grid = createDeckGridView({
    h,
    theme,
    SLIDE_TYPES,
    getSlides: () => slides,
    annotationFor,
  });

  // --- Adjust: feedback textarea + re-generate from prior batch ------------
  const feedbackTa = h('textarea', {
    class: 'form-input',
    rows: '2',
    placeholder: t(
      'editor.aiReview.feedbackPlaceholder',
      'E.g. make it 3 slides, turn the list into a timeline, shorter texts…'
    ),
  });
  const feedbackWrap = h('div', { class: 'ai-review-feedback stack' }, [
    h('div', {
      class: 'field-label',
      text: t('editor.aiReview.feedbackLabel', 'Want something different? Describe it and adjust the batch'),
    }),
    feedbackTa,
  ]);

  const btnDiscard = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('editor.aiReview.discard', 'Discard'),
  });
  const btnAdjust = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('editor.aiReview.adjust', 'Adjust'),
  });
  const btnAccept = h('button', {
    class: 'btn btn-primary',
    type: 'button',
  });
  const syncAcceptLabel = () => {
    btnAccept.textContent = t('editor.aiReview.acceptN', 'Add {count} slides', {
      count: slides.length,
    });
  };
  syncAcceptLabel();

  const setBusy = (value) => {
    busy = value;
    modalApi.setBusy(value);
    btnAdjust.disabled = value;
    btnAccept.disabled = value;
    btnDiscard.disabled = value;
    btnAdjust.classList.toggle('is-loading', value);
  };

  btnDiscard.onclick = () => {
    modalApi.close({ accepted: false });
  };

  btnAccept.onclick = () => {
    if (busy) return;
    const out = slides;
    modalApi.close({ accepted: true });
    onAccept?.(out);
  };

  btnAdjust.onclick = async () => {
    if (busy) return;
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
    status.textContent = t('editor.aiReview.adjusting', 'Adjusting the batch…');
    try {
      const resp = await api('/api/ai/append-slides', {
        method: 'POST',
        body: JSON.stringify({
          ...request,
          priorSlides: slides.map((s) => ({ type: s.type, content: s.content })),
          feedback,
        }),
      });
      const next = Array.isArray(resp?.slides) ? resp.slides : [];
      if (!next.length) {
        status.textContent = t(
          'editor.aiAppend.noneReceived',
          'No slides received (please try again).'
        );
        return;
      }
      slides = next;
      rationale = String(resp?.rationale || '');
      setRationale(rationale);
      feedbackTa.value = '';
      status.textContent = '';
      syncAcceptLabel();
      grid.render();
      toast.info(
        t('editor.aiReview.adjusted', 'Batch updated ({count} slides)', {
          count: slides.length,
        }),
        { id: 'ai-review-adjusted' }
      );
    } catch (e) {
      status.textContent = String(e?.message || e);
    } finally {
      setBusy(false);
    }
  };

  const actions = h('div', { class: 'row is-end modal-actions' }, [
    btnDiscard,
    btnAdjust,
    btnAccept,
  ]);

  modalApi.append(rationaleEl, grid.el, feedbackWrap, status, actions);
  grid.render();

  return modalApi;
}
