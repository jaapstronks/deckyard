/**
 * Responsive drawers for narrow viewports.
 *
 * - Slides drawer: slide-over panel from the left at ≤768px (`md`), opened
 *   by a floating button.
 * - Inspector drawer: the right-hand rail slides over the canvas below 1024px
 *   (`lg`), opened from the Inspector | Comments tabs in `.rail-head` (D339:
 *   below 1024×700 the canvas keeps the height, the inspector comes to it).
 *
 * Both are one drawer mechanism (`createDrawer`): a class on <html>, Escape
 * as a standing surface, and closing when the viewport grows past its rung.
 * The widths are rungs of the CSS ladder (`docs/reference/css-breakpoints.md`)
 * and match the `@media` blocks in `client/styles/app/editor/20-editor-layout.css`;
 * the queries below are the only place editor JS names a width.
 */

import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom/index.js';
import { icon } from '../../lib/dom/icons.js';
import { takeEscape } from '../../lib/dom/escape.js';
import { hasOpenOverlay } from '../../lib/dom/modal.js';

/** Slides column becomes a drawer (CSS `md` rung). */
export const SLIDES_DRAWER_QUERY = '(max-width: 768px)';

/**
 * The D339 boundary (CSS `lg` rung): below it the inspector is a drawer and
 * the presenter notes start folded.
 */
export const COMPACT_EDITOR_QUERY = '(max-width: 1023px)';

/**
 * Whether a media query matches now; false where `matchMedia` is missing.
 * @param {string} query
 * @returns {boolean}
 */
export function matchesQuery(query) {
  return window.matchMedia?.(query)?.matches === true;
}

/**
 * One off-canvas drawer: open state as a class on <html>, Escape closes it
 * when no layer took the press, and it closes once the viewport no longer
 * matches its query.
 *
 * @param {Object} options
 * @param {string} options.openClass - Class on <html> while open
 * @param {string} options.query - Media query under which the drawer exists
 * @param {Function} [options.onChange] - (open: boolean) => void, after every
 *   open/close and when the viewport crosses the query
 * @returns {{ open: Function, close: Function, toggle: Function, isOpen: Function, isActive: Function, detach: Function }}
 */
function createDrawer({ openClass, query, onChange }) {
  const doc = document.documentElement;
  const isOpen = () => doc.classList.contains(openClass);
  const isActive = () => matchesQuery(query);

  const set = (open) => {
    doc.classList.toggle(openClass, open);
    onChange?.(open);
  };
  const open = () => set(true);
  const close = () => set(false);
  const toggle = () => set(!isOpen());

  // A standing surface: a layer opened inside the drawer (a context menu)
  // takes the press first, and the drawer waits for the next one. A modal
  // sits above the drawer, so while one is open the press is the modal's,
  // even though this listener registered first (B493).
  const handleKeydown = (e) => {
    if (!isOpen()) return;
    if (hasOpenOverlay(document)) return;
    if (takeEscape(e)) close();
  };
  document.addEventListener('keydown', handleKeydown);

  // Crossing the rung either way closes the drawer: wider, it is a column
  // again; narrower, it starts closed so the canvas comes first.
  const media = window.matchMedia?.(query) || null;
  const handleMediaChange = () => close();
  media?.addEventListener?.('change', handleMediaChange);

  const detach = () => {
    document.removeEventListener('keydown', handleKeydown);
    media?.removeEventListener?.('change', handleMediaChange);
    doc.classList.remove(openClass);
  };

  return { open, close, toggle, isOpen, isActive, detach };
}

/**
 * Creates the slides drawer (toggle button + backdrop) and the inspector
 * drawer. Call detach() when the editor unmounts.
 *
 * @param {Object} options
 * @param {HTMLElement} options.root - Editor shell the slides toggle mounts in
 * @param {Function} [options.onInspectorChange] - (open: boolean) => void
 */
export function createResponsiveDrawers({ root, onInspectorChange } = {}) {
  if (!root) throw new Error('createResponsiveDrawers: root required');

  const slidesDrawerBackdrop = h('div', {
    class: 'slides-drawer-backdrop',
    'aria-hidden': 'true',
  });

  const slidesDrawerToggle = h(
    'button',
    {
      class: 'slides-drawer-toggle',
      type: 'button',
      title: t('editor.slidesDrawer.open', 'Open slides'),
      'aria-label': t('editor.slidesDrawer.open', 'Open slides'),
    },
    [icon('menu')],
  );

  const slides = createDrawer({
    openClass: 'is-slides-drawer-open',
    query: SLIDES_DRAWER_QUERY,
    onChange: (open) => {
      slidesDrawerToggle.setAttribute('aria-expanded', String(open));
      slidesDrawerToggle.title = open
        ? t('editor.slidesDrawer.close', 'Close slides')
        : t('editor.slidesDrawer.open', 'Open slides');
    },
  });

  const inspector = createDrawer({
    openClass: 'is-inspector-drawer-open',
    query: COMPACT_EDITOR_QUERY,
    onChange: onInspectorChange,
  });

  slidesDrawerToggle.addEventListener('click', slides.toggle);
  slidesDrawerBackdrop.addEventListener('click', slides.close);

  // Picking a slide in the drawer closes it, after a beat so the selection
  // visibly registers.
  const handleSlideClick = (e) => {
    if (!slides.isActive() || !slides.isOpen()) return;
    if (e.target.closest?.('.slide-item')) setTimeout(slides.close, 150);
  };
  document.addEventListener('click', handleSlideClick);

  root.append(slidesDrawerBackdrop, slidesDrawerToggle);

  const detach = () => {
    document.removeEventListener('click', handleSlideClick);
    slides.detach();
    inspector.detach();
    slidesDrawerBackdrop.remove();
    slidesDrawerToggle.remove();
  };

  return {
    detach,
    openSlidesDrawer: slides.open,
    closeSlidesDrawer: slides.close,
    toggleSlidesDrawer: slides.toggle,
    inspector,
  };
}
