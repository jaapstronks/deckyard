/**
 * Deck overview ("light table") modal: a grid of every slide in the deck with
 * truthful thumbnails. Click a tile to jump to that slide in the editor;
 * the magnifier opens a larger preview. No AI involved — the AI review modals
 * are this grid plus an annotation layer (see deck-grid.js).
 */
import { t } from '../../../lib/ui-i18n.js';
import { openModal } from '../../../lib/dom/modal.js';
import { createDeckGridView } from '../deck-grid.js';

/**
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {HTMLElement} options.root - Element to append the modal to
 * @param {Object} options.pres - The presentation (slides read live)
 * @param {Object} options.theme - Resolved theme
 * @param {Object} options.SLIDE_TYPES - Slide type registry
 * @param {Set} [options.openOverlayClosers] - Overlay registry for cleanup
 * @param {Function} options.onJumpToSlide - (slideId) => void
 */
export function openDeckOverviewModal({
  h,
  root,
  pres,
  theme,
  SLIDE_TYPES,
  openOverlayClosers,
  onJumpToSlide,
} = {}) {
  const count = (pres?.slides || []).length;

  // Torn down via onClose so every close path (button, Esc, backdrop) cleans
  // up the grid's observers and slide runtimes.
  let grid = null;
  const modalApi = openModal(
    h,
    root,
    {
      title: t('editor.deckGrid.title', 'Slide overview'),
      hint: t(
        'editor.deckGrid.hint',
        'All {count} slides at a glance. Click a slide to jump to it in the editor.',
        { count }
      ),
      modalClass: 'modal-deck-grid',
      onClose: () => grid?.teardown(),
    },
    openOverlayClosers
  );

  grid = createDeckGridView({
    h,
    theme,
    SLIDE_TYPES,
    presentationId: pres?.id,
    getSlides: () => pres?.slides || [],
    onTilePick: (slide) => {
      modalApi.close();
      if (slide?.id) onJumpToSlide?.(slide.id);
    },
    tilePickLabel: t('editor.deckGrid.jumpTo', 'Go to slide'),
  });

  modalApi.append(grid.el);
  grid.render();

  return modalApi;
}
