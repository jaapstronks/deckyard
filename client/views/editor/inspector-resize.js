import { storage } from '../../lib/storage.js';

const MIN_WIDTH = 320;
const BASE_MAX_WIDTH = 640;

/**
 * The inspector's ceiling. A flat 640px was a sensible cap for a laptop but
 * an arbitrary one on a 34" monitor, where the extra width all fell to the
 * canvas whether the canvas wanted it or not. Scaling with the viewport
 * keeps the old number everywhere it already applied — 28% of 1920px is
 * 537px, still under 640 — and only opens up on genuinely wide screens.
 */
const maxWidth = () =>
  Math.max(BASE_MAX_WIDTH, Math.round((window.innerWidth || 0) * 0.28));

/**
 * Creates a resize handle for the inspector panel with drag-to-resize.
 * The inspector sits on the right of the canvas, so the handle lives on its
 * LEFT edge and dragging left widens the panel (trading canvas width for
 * inspector width). The chosen width is persisted and applied via the
 * --inspector-width CSS variable. Mirrors createSlidesPanelResize.
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {HTMLElement} options.panelEl - The inspector panel element
 * @param {Function} options.isCollapsed - Whether the panel is collapsed
 * @returns {{ handleEl: HTMLElement, applyWidth: Function }}
 */
export function createInspectorResize({ h, panelEl, isCollapsed }) {
  const handleEl = h('div', { class: 'inspector-resize-handle' });
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  const getStoredWidth = () => {
    const stored = storage.get('ps-inspector-width');
    if (stored) {
      const w = parseInt(stored, 10);
      // Clamp rather than reject: a width chosen on a wide monitor should
      // survive as "as wide as this screen allows" when the same profile
      // opens on a laptop, not silently snap back to the default.
      if (Number.isFinite(w) && w >= MIN_WIDTH) {
        return Math.min(w, maxWidth());
      }
    }
    return null;
  };

  const setStoredWidth = (w) => {
    storage.set('ps-inspector-width', w);
  };

  const applyWidth = (w) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(maxWidth(), w));
    document.documentElement.style.setProperty('--inspector-width', `${clamped}px`);
    return clamped;
  };

  const onResizeStart = (e) => {
    if (isCollapsed?.()) return;
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
    // Panel is right of the handle: dragging left (negative delta) widens it.
    const delta = e.clientX - startX;
    applyWidth(startWidth - delta);
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
  // Migrate the pre-inspector storage key once so a user's chosen width survives
  // the rename.
  const legacy = storage.get('ps-editor-panel-width');
  if (legacy && !storage.get('ps-inspector-width')) {
    storage.set('ps-inspector-width', legacy);
  }
  const storedWidth = getStoredWidth();
  if (storedWidth) applyWidth(storedWidth);

  return { handleEl, applyWidth };
}
