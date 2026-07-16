/**
 * Responsive drawer controls for narrow viewports.
 *
 * - Slides drawer: slide-over panel from left at ≤820px
 *
 * The old preview bottom sheet (≤600px) is gone: since the responsive
 * convergence (editor-UI fase 4) the canvas is the main column at every
 * width, with the inspector stacked below it, so there is nothing left to
 * summon from a sheet. The toggle is hidden via CSS at wider viewports.
 */

import { t } from '../../lib/ui-i18n.js';

const DRAWER_BREAKPOINT = 820;

/**
 * Creates the responsive slides-drawer toggle button and backdrop.
 * Call detach() when the editor unmounts.
 */
export function createResponsiveDrawers({ h, root } = {}) {
  if (!h || !root) throw new Error('createResponsiveDrawers: h and root required');

  const doc = document.documentElement;

  const slidesDrawerBackdrop = h('div', {
    class: 'slides-drawer-backdrop',
    'aria-hidden': 'true',
  });

  const slidesDrawerToggle = h('button', {
    class: 'slides-drawer-toggle',
    type: 'button',
    title: t('editor.slidesDrawer.open', 'Open slides'),
    'aria-label': t('editor.slidesDrawer.open', 'Open slides'),
    // Using a simple icon - list/menu style
    text: '☰',
  });

  const openSlidesDrawer = () => {
    doc.classList.add('is-slides-drawer-open');
    slidesDrawerToggle.setAttribute('aria-expanded', 'true');
    slidesDrawerToggle.title = t('editor.slidesDrawer.close', 'Close slides');
  };

  const closeSlidesDrawer = () => {
    doc.classList.remove('is-slides-drawer-open');
    slidesDrawerToggle.setAttribute('aria-expanded', 'false');
    slidesDrawerToggle.title = t('editor.slidesDrawer.open', 'Open slides');
  };

  const toggleSlidesDrawer = () => {
    if (doc.classList.contains('is-slides-drawer-open')) {
      closeSlidesDrawer();
    } else {
      openSlidesDrawer();
    }
  };

  slidesDrawerToggle.addEventListener('click', toggleSlidesDrawer);
  slidesDrawerBackdrop.addEventListener('click', closeSlidesDrawer);

  // ─────────────────────────────────────────────────────────────────────────
  // Keyboard handling (Escape closes the drawer)
  // ─────────────────────────────────────────────────────────────────────────

  const handleKeydown = (e) => {
    if (e.key === 'Escape' && doc.classList.contains('is-slides-drawer-open')) {
      closeSlidesDrawer();
      e.preventDefault();
    }
  };

  document.addEventListener('keydown', handleKeydown);

  // ─────────────────────────────────────────────────────────────────────────
  // Close drawer when slide is selected (better mobile UX)
  // ─────────────────────────────────────────────────────────────────────────

  const handleSlideClick = (e) => {
    // Only on narrow viewports
    if (window.innerWidth > DRAWER_BREAKPOINT) return;

    // Check if a slide item was clicked
    const slideItem = e.target.closest?.('.slide-item');
    if (slideItem && doc.classList.contains('is-slides-drawer-open')) {
      // Small delay so the selection visually registers before closing
      setTimeout(closeSlidesDrawer, 150);
    }
  };

  document.addEventListener('click', handleSlideClick);

  // ─────────────────────────────────────────────────────────────────────────
  // Window resize: close the drawer if the viewport becomes wide enough
  // ─────────────────────────────────────────────────────────────────────────

  const handleResize = () => {
    if (window.innerWidth > DRAWER_BREAKPOINT) {
      closeSlidesDrawer();
    }
  };

  window.addEventListener('resize', handleResize);

  // Insert backdrop and toggle into the root (editor shell)
  root.append(slidesDrawerBackdrop, slidesDrawerToggle);

  const detach = () => {
    document.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('click', handleSlideClick);
    window.removeEventListener('resize', handleResize);

    // Remove class in case it's still applied
    closeSlidesDrawer();

    try {
      slidesDrawerBackdrop.remove();
      slidesDrawerToggle.remove();
    } catch {
      // ignore
    }
  };

  return {
    detach,
    openSlidesDrawer,
    closeSlidesDrawer,
    toggleSlidesDrawer,
  };
}
