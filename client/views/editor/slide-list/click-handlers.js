/**
 * Slide List Click Handlers
 * Handles click interactions for slide selection
 */

import { normalizeQuery } from './search.js';

/**
 * Attach click handler to a slide item
 */
export function attachClickHandler({
  item,
  slide,
  context,
}) {
  const {
    pres,
    slideListEl,
    getSearchQuery,
    setSelectedSlideId,
    getSelectedSlideIds,
    setSelectedSlideIds,
    clearMultiSelection,
    onMultiSelectionChange,
    editorState,
    rerenderSlideList,
    onAfterSelectSlide,
    getLastClickedSlideId,
    setLastClickedSlideId,
  } = context;

  const s = slide;

  item.addEventListener('click', (e) => {
    const qNow = normalizeQuery(getSearchQuery?.());
    const searchNow = !!qNow;
    const isMeta = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;

    if (isMeta && !searchNow) {
      // Cmd/Ctrl+click: toggle slide in multi-selection
      const current = getSelectedSlideIds?.() || new Set();
      const next = new Set(current);
      if (next.has(s.id)) {
        next.delete(s.id);
      } else {
        next.add(s.id);
      }
      setSelectedSlideIds?.(next);
      setLastClickedSlideId(s.id);
      rerenderSlideList();
      onMultiSelectionChange?.();
    } else if (isShift && !searchNow && getLastClickedSlideId()) {
      // Shift+click: range selection
      const allSlideIds = (pres.slides || []).map((x) => x.id);
      const lastIdx = allSlideIds.indexOf(getLastClickedSlideId());
      const curIdx = allSlideIds.indexOf(s.id);
      if (lastIdx >= 0 && curIdx >= 0) {
        const start = Math.min(lastIdx, curIdx);
        const end = Math.max(lastIdx, curIdx);
        const next = new Set();
        for (let i = start; i <= end; i++) {
          next.add(allSlideIds[i]);
        }
        setSelectedSlideIds?.(next);
        rerenderSlideList();
        onMultiSelectionChange?.();
      }
    } else {
      // Normal click: select single slide, clear multi-selection
      clearMultiSelection?.();
      setSelectedSlideId?.(s.id);
      setLastClickedSlideId(s.id);
      editorState.refreshAll();
      if (searchNow) {
        requestAnimationFrame(() => {
          onAfterSelectSlide?.({ slideId: s.id, query: qNow });
        });
      } else {
        // Keep keyboard navigation anchored in the list.
        requestAnimationFrame(() => {
          const el = slideListEl.querySelector(
            `.list-item.slide-item[data-slide-id="${s.id}"]`
          );
          el?.focus?.();
        });
      }
    }
  });
}
