import { storage } from '../../lib/storage.js';

const MIN_WIDTH = 200;
const BASE_MAX_WIDTH = 500;

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
 * @param {Function} options.h - DOM element factory
 * @param {HTMLElement} options.panelEl - The panel element to resize
 * @param {Function} options.isSlidesCollapsed - Function to check if slides are collapsed
 * @returns {{ handleEl: HTMLElement, applyWidth: Function }}
 */
export function createSlidesPanelResize({ h, panelEl, isSlidesCollapsed }) {
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
    document.documentElement.style.setProperty('--slides-panel-width', `${clamped}px`);
    // Calculate thumb scale: panel width minus padding, borders, and scrollbar gutter divided by slide width (1600)
    // List padding: 8px each side = 16px, Thumb border: 1px each side = 2px, Scrollbar gutter: ~15px
    const thumbWidth = clamped - 16 - 2 - 15;
    const thumbScale = thumbWidth / 1600;
    document.documentElement.style.setProperty('--slides-thumb-scale', thumbScale.toFixed(4));
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