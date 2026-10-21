import { storage } from '../../lib/storage.js';
import { h } from '../../lib/dom/index.js';

const MIN_WIDTH = 200;
const BASE_MAX_WIDTH = 500;
/** Authored slide width; `.thumb .slide` renders at this size, then scales. */
const SLIDE_WIDTH_PX = 1600;

/**
 * The slides panel's ceiling. Like the inspector's, a flat cap meant a very
 * wide screen could not buy bigger slide thumbnails with the space it had
 * going spare. 20% of 1920px is 384px, under the old 500, so nothing changes
 * below roughly a 2500px-wide display.
 */
const maxWidth = () =>
  Math.max(BASE_MAX_WIDTH, Math.round((window.innerWidth || 0) * 0.2));

/**
 * Creates a resize handle for the slides panel with drag-to-resize functionality.
 * @param {Object} options
 * @param {HTMLElement} options.panelEl - The panel element to resize
 * @param {Function} options.isSlidesCollapsed - Function to check if slides are collapsed
 * @returns {{ handleEl: HTMLElement, applyWidth: Function }}
 */
export function createSlidesPanelResize({ panelEl, isSlidesCollapsed }) {
  const handleEl = h('div', { class: 'slides-panel-resize-handle' });
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  const getStoredWidth = () => {
    const stored = storage.get('ps-slides-panel-width');
    if (stored) {
      const w = parseInt(stored, 10);
      // Clamp rather than reject, so a width chosen on a wide monitor
      // degrades gracefully instead of resetting on a smaller one.
      if (Number.isFinite(w) && w >= MIN_WIDTH) {
        return Math.min(w, maxWidth());
      }
    }
    return null;
  };

  const setStoredWidth = (w) => {
    storage.set('ps-slides-panel-width', w);
  };

  const applyWidth = (w) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(maxWidth(), w));
    document.documentElement.style.setProperty(
      '--slides-panel-width',
      `${clamped}px`,
    );
    return clamped;
  };

  const onResizeStart = (e) => {
    if (isSlidesCollapsed?.()) return;
    e.preventDefault();
    isResizing = true;
    startX = e.clientX;
    startWidth = panelEl.getBoundingClientRect().width;
    handleEl.classList.add('is-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  };

  const onResizeMove = (e) => {
    if (!isResizing) return;
    const delta = e.clientX - startX;
    applyWidth(startWidth + delta);
  };

  const onResizeEnd = () => {
    if (!isResizing) return;
    isResizing = false;
    handleEl.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
    // Store the final width
    const finalWidth = panelEl.getBoundingClientRect().width;
    setStoredWidth(Math.round(finalWidth));
  };

  handleEl.addEventListener('mousedown', onResizeStart);

  // Apply stored width on init (or default if none stored)
  const storedWidth = getStoredWidth();
  // Default width matches --ps-slides-expanded-width (200px)
  applyWidth(storedWidth || 200);

  return { handleEl, applyWidth };
}

/**
 * Keeps `--slides-thumb-scale` in step with the width a list thumbnail really
 * gets. The dragged panel width does not say that: below 769px the panel is
 * a drawer whose width is a token (B810), and padding, number gutter and
 * scrollbar sit between the two. So the rendered thumbnail is measured and
 * nothing else sets the scale. The observer fires on the list's own size
 * changes, which covers dragging the edge, the drawer layout, a viewport
 * resize and the first render of the slides.
 * @param {HTMLElement} listEl - The slide list holding `.thumb-mini` cards
 * @returns {() => void} Disconnects the observer
 */
export function watchSlidesThumbScale(listEl) {
  if (typeof ResizeObserver === 'undefined') return () => {};
  let applied = '';
  const sync = () => {
    // A collapsed rail hides the thumbnails and an empty deck has none; keep
    // the last scale so expanding again does not flash a wrong size.
    const width = listEl.querySelector('.thumb.thumb-mini')?.clientWidth || 0;
    if (!width) return;
    const scale = (width / SLIDE_WIDTH_PX).toFixed(4);
    if (scale === applied) return;
    applied = scale;
    document.documentElement.style.setProperty('--slides-thumb-scale', scale);
  };
  const observer = new ResizeObserver(sync);
  observer.observe(listEl);
  return () => observer.disconnect();
}
