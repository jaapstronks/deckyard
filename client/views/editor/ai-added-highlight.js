/**
 * "Just added by AI" feedback: transiently highlights freshly inserted slide
 * rows in the slide list, scrolls the first one into view, and fires an
 * "Added N slides" toast with an optional Review action. Pure client-side;
 * works for every AI entry point that inserts slides.
 */
import { t } from '../../lib/ui-i18n.js';
import { toast } from '../../lib/dom/toast.js';

// Matches the ai-new-flash animation duration in 17-deck-grid.css, plus a
// little slack so the class is removed only after the fade completes.
const HIGHLIGHT_MS = 5600;

const cssEsc = (s) =>
  typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(String(s))
    : String(s).replace(/["\\]/g, '\\$&');

/**
 * @param {Object} options
 * @param {string[]} options.slideIds - Ids of the slides that were inserted
 * @param {Function} [options.onReview] - Adds a "Review" action to the toast
 */
export function highlightAiInsertedSlides({ slideIds = [], onReview = null } = {}) {
  const ids = (slideIds || []).filter(Boolean);
  if (!ids.length) return;

  // The slide list re-renders asynchronously after dirtyRefreshAll; wait two
  // frames so the fresh rows exist before tagging them.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      let firstRow = null;
      for (const id of ids) {
        const row = document.querySelector(
          `.list-item.slide-item[data-slide-id="${cssEsc(id)}"]`
        );
        if (!row) continue;
        row.classList.add('is-ai-new');
        if (!firstRow) firstRow = row;
        setTimeout(() => {
          try {
            row.classList.remove('is-ai-new');
          } catch {
            // ignore
          }
        }, HIGHLIGHT_MS);
      }
      firstRow?.scrollIntoView?.({ block: 'nearest' });
    })
  );

  const message =
    ids.length === 1
      ? t('editor.aiAppend.addedOne', 'Added 1 slide')
      : t('editor.aiAppend.addedN', 'Added {count} slides', { count: ids.length });
  toast.success(message, {
    id: 'ai-append-added',
    durationMs: 6500,
    ...(typeof onReview === 'function'
      ? { action: { label: t('editor.aiAppend.review', 'Review'), onClick: onReview } }
      : {}),
  });
}
