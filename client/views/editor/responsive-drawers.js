/**
 * Responsive drawer/sheet controls for narrow viewports.
 *
 * - Slides drawer: slide-over panel from left at ≤820px
 * - Preview sheet: bottom sheet at ≤600px
 *
 * These elements are hidden via CSS at wider viewports.
 */

import { t } from '../../lib/ui-i18n.js';
import { iconUrl } from '../../../shared/icon-names.js';

const DRAWER_BREAKPOINT = 820;
const SHEET_BREAKPOINT = 600;

/**
 * Creates the responsive drawer/sheet toggle buttons and backdrops.
 * Call detach() when the editor unmounts.
 */
export function createResponsiveDrawers({ h, root } = {}) {
  if (!h || !root) throw new Error('createResponsiveDrawers: h and root required');

  const doc = document.documentElement;

  // ─────────────────────────────────────────────────────────────────────────
  // Slides Drawer (left panel, ≤820px)
  // ─────────────────────────────────────────────────────────────────────────

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
  // Preview Sheet (bottom panel, ≤600px)
  // ─────────────────────────────────────────────────────────────────────────

  const previewSheetBackdrop = h('div', {
    class: 'preview-sheet-backdrop',
    'aria-hidden': 'true',
  });

  const previewSheetToggle = h('button', {
    class: 'preview-sheet-toggle',
    type: 'button',
    title: t('editor.previewSheet.open', 'Open preview'),
    'aria-label': t('editor.previewSheet.open', 'Open preview'),
  });
  previewSheetToggle.append(h('img', { class: 'preview-sheet-icon', src: iconUrl('eye'), alt: '', 'aria-hidden': 'true' }));

  const openPreviewSheet = () => {
    doc.classList.add('is-preview-sheet-open');
    previewSheetToggle.setAttribute('aria-expanded', 'true');
    previewSheetToggle.title = t('editor.previewSheet.close', 'Close preview');
  };

  const closePreviewSheet = () => {
    doc.classList.remove('is-preview-sheet-open');
    previewSheetToggle.setAttribute('aria-expanded', 'false');
    previewSheetToggle.title = t('editor.previewSheet.open', 'Open preview');
  };

  const togglePreviewSheet = () => {
    if (doc.classList.contains('is-preview-sheet-open')) {
      closePreviewSheet();
    } else {
      openPreviewSheet();
    }
  };

  previewSheetToggle.addEventListener('click', togglePreviewSheet);
  previewSheetBackdrop.addEventListener('click', closePreviewSheet);

  // ─────────────────────────────────────────────────────────────────────────
  // Keyboard handling (Escape closes drawers/sheets)
  // ─────────────────────────────────────────────────────────────────────────

  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      if (doc.classList.contains('is-slides-drawer-open')) {
        closeSlidesDrawer();
        e.preventDefault();
      } else if (doc.classList.contains('is-preview-sheet-open')) {
        closePreviewSheet();
        e.preventDefault();
      }
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
  // Window resize: close drawers if viewport becomes wide enough
  // ─────────────────────────────────────────────────────────────────────────

  const handleResize = () => {
    if (window.innerWidth > DRAWER_BREAKPOINT) {
      closeSlidesDrawer();
    }
    if (window.innerWidth > SHEET_BREAKPOINT) {
      closePreviewSheet();
    }
  };

  window.addEventListener('resize', handleResize);

  // ─────────────────────────────────────────────────────────────────────────
  // Mount elements
  // ─────────────────────────────────────────────────────────────────────────

  // Insert backdrops and toggles into the root (editor shell)
  root.append(slidesDrawerBackdrop, slidesDrawerToggle);
  root.append(previewSheetBackdrop, previewSheetToggle);

  // ─────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────

  const detach = () => {
    document.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('click', handleSlideClick);
    window.removeEventListener('resize', handleResize);

    // Remove classes in case they're still applied
    closeSlidesDrawer();
    closePreviewSheet();

    // Remove elements
    try {
      slidesDrawerBackdrop.remove();
      slidesDrawerToggle.remove();
      previewSheetBackdrop.remove();
      previewSheetToggle.remove();
    } catch {
      // ignore
    }
  };

  return {
    detach,
    openSlidesDrawer,
    closeSlidesDrawer,
    toggleSlidesDrawer,
    openPreviewSheet,
    closePreviewSheet,
    togglePreviewSheet,
  };
}