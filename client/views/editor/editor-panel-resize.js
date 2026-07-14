import { storage } from '../../lib/storage.js';

const MIN_WIDTH = 320;
const MAX_WIDTH = 640;

/**
 * Creates a resize handle for the editor (form) panel with drag-to-resize.
 * Dragging trades form width for slide-canvas width; the chosen width is
 * persisted and applied via the --editor-panel-width CSS variable.
 * Mirrors createSlidesPanelResize.
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {HTMLElement} options.panelEl - The editor panel element
 * @param {Function} options.isFormCollapsed - Whether the panel is collapsed
 * @returns {{ handleEl: HTMLElement, applyWidth: Function }}
 */
export function createEditorPanelResize({ h, panelEl, isFormCollapsed }) {
  const handleEl = h('div', { class: 'editor-panel-resize-handle' });
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  const getStoredWidth = () => {
    const stored = storage.get('ps-editor-panel-width');
    if (stored) {
      const w = parseInt(stored, 10);
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) return w;
    }
    return null;
  };

  const setStoredWidth = (w) => {
    storage.set('ps-editor-panel-width', w);
  };

  const applyWidth = (w) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
    document.documentElement.style.setProperty('--editor-panel-width', `${clamped}px`);
    return clamped;
  };

  const onResizeStart = (e) => {
    if (isFormCollapsed?.()) return;
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
    const finalWidth = panelEl.getBoundingClientRect().width;
    setStoredWidth(Math.round(finalWidth));
  };

  handleEl.addEventListener('mousedown', onResizeStart);

  // Apply stored width on init; without a stored value the CSS default applies.
  const storedWidth = getStoredWidth();
  if (storedWidth) applyWidth(storedWidth);

  return { handleEl, applyWidth };
}
