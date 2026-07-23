import { openDeckOverviewModal } from './modals/deck-overview-modal.js';
import { openAiDeckReviewModal } from './modals/ai-deck-review-modal.js';

/**
 * Wire the two whole-deck modals the editor opens from the topbar and the
 * post-generation flow: the light-table deck overview and the AI deck review
 * (per-slide rationale + section refine). Both spread nearly the same
 * dependency set and drive the same `jumpToSlide`, so they — and the shared
 * jump — live behind one factory.
 *
 * `rerenderSlideList` / `rerenderEditor` / `rerenderPreview` and
 * `getSlideListEl` come in as indirections (`() => …`) because the controller
 * binds the real renderers and the slide-list element *after* this factory
 * runs; reading them at call time keeps a jump pointed at the live renderers
 * and the mounted list rather than the boot-time stubs.
 *
 * @param {object} ctx
 * @param {Function} ctx.h - hyperscript DOM helper
 * @param {HTMLElement} ctx.root - editor root (overlay mount host)
 * @param {object} ctx.api - API client
 * @param {object} ctx.pres - presentation model
 * @param {object} ctx.theme - active theme
 * @param {object} ctx.SLIDE_TYPES - slide-type registry
 * @param {Function} ctx.openOverlayClosers - overlay registry closer collector
 * @param {object} ctx.editorState - shared editor state (AI review only)
 * @param {object} ctx.nav - router nav (AI review only)
 * @param {Function} ctx.setSelectedSlideId - lock-aware slide selection
 * @param {Function} ctx.rerenderSlideList - repaint the slide list (late-bound indirection)
 * @param {Function} ctx.rerenderEditor - repaint the editor form (late-bound indirection)
 * @param {Function} ctx.rerenderPreview - repaint the preview (late-bound indirection)
 * @param {Function} ctx.getSlideListEl - read the slide-list element (late-bound indirection)
 * @returns {{ jumpToSlide: Function, openDeckOverview: Function, openAiDeckReview: Function }}
 */
export function createDeckReviewOpeners({
  h,
  root,
  api,
  pres,
  theme,
  SLIDE_TYPES,
  openOverlayClosers,
  editorState,
  nav,
  setSelectedSlideId,
  rerenderSlideList,
  rerenderEditor,
  rerenderPreview,
  getSlideListEl,
}) {
  // Jump used by the overview grid and the AI deck review. slideListEl is read
  // lazily (mounted further down, before any click can happen).
  const jumpToSlide = (slideId) => {
    if (!slideId || !pres.slides?.some((s) => s?.id === slideId)) return;
    setSelectedSlideId(slideId);
    rerenderSlideList();
    rerenderEditor();
    rerenderPreview();
    requestAnimationFrame(() => {
      try {
        const active = getSlideListEl()?.querySelector?.('.list-item.is-active');
        active?.scrollIntoView?.({ block: 'nearest' });
      } catch {
        /* ignore */
      }
    });
  };

  // Shared by the topbar button and the "Review" affordance on the AI-added toast.
  const openDeckOverview = () => {
    openDeckOverviewModal({
      h,
      root,
      pres,
      theme,
      SLIDE_TYPES,
      openOverlayClosers,
      onJumpToSlide: jumpToSlide,
    });
  };

  // Whole-deck AI review (per-slide rationale + section refine). Opened
  // automatically after AI generation (?aiReview=1).
  const openAiDeckReview = ({ postGeneration = false } = {}) => {
    openAiDeckReviewModal({
      h,
      root,
      api,
      pres,
      theme,
      SLIDE_TYPES,
      openOverlayClosers,
      editorState,
      onJumpToSlide: jumpToSlide,
      postGeneration,
      nav,
    });
  };

  return { jumpToSlide, openDeckOverview, openAiDeckReview };
}
