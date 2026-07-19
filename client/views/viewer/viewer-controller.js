/**
 * Viewer mode controller for view/comment permission users.
 * Provides a read-only presentation viewer with optional commenting capability.
 */

import { h } from '../../lib/dom.js';
import { loadThemeById } from '../../lib/theme.js';
import { createViewerTopbar } from './viewer-topbar.js';
import { createViewerSlidesPanel } from './viewer-slides-panel.js';
import { createViewerPreview } from './viewer-preview.js';
import { createCommentsPanel } from '../editor/comments-panel.js';
import { createCommentsApi } from '../editor/comments-api.js';
import { api } from '../../lib/api.js';
import { initPresentationI18n } from '../editor/bootstrap.js';
import { syncSlideIdInUrl } from '../editor/slide-url.js';
import { attachSwipeNavigation } from '../../lib/swipe-nav.js';

export async function createViewerController({
  root,
  id,
  nav,
  user,
  permission,
  pres,
} = {}) {
  if (!root) throw new Error('createViewerController: root is required');
  if (!id) throw new Error('createViewerController: id is required');
  if (!pres) throw new Error('createViewerController: pres is required');

  // Handle i18n initialization
  const startUrl = new URL(location.href);
  const initialLang = startUrl.searchParams.get('lang');
  initPresentationI18n({ pres, initialLang });

  // Load theme
  const theme = await loadThemeById(pres?.theme);

  // Handle initial slide from URL
  const initialSlideId =
    startUrl.searchParams.get('slideId') ||
    startUrl.searchParams.get('s') ||
    '';
  let selectedSlideId = pres.slides?.[0]?.id || null;
  if (initialSlideId && Array.isArray(pres?.slides)) {
    const exists = pres.slides.some((s) => s?.id === initialSlideId);
    if (exists) selectedSlideId = initialSlideId;
  }

  // Comments state (only for comment permission)
  const canComment = permission === 'comment';
  let commentsPanel = null;
  let setCommentsBadgeFn = () => {};
  let slideCommentCounts = {};

  // Create comments API for comment permission users
  const commentsApi = canComment
    ? createCommentsApi({ api, presentationId: id })
    : null;

  // Create the shell
  const shell = h('div', { class: 'viewer-shell' });

  // Rerenders
  let rerenderSlideList = () => {};
  let rerenderPreview = () => {};

  // Single selection path (viewer counterpart of the editor's
  // setSelectedSlideIdWithLock): update state, mirror it in the URL, rerender.
  const selectSlide = (newId) => {
    selectedSlideId = newId;
    syncSlideIdInUrl(newId);
    rerenderSlideList();
    rerenderPreview();
  };

  // Topbar
  const topbarApi = createViewerTopbar({
    h,
    nav,
    pres,
    id,
    permission,
    onToggleComments: canComment ? () => commentsPanel?.toggle?.() : null,
    setCommentsBadge: canComment ? (fn) => { setCommentsBadgeFn = fn; } : null,
  });
  shell.append(topbarApi.topbarEl);

  // Layout container for slides panel + preview
  const layout = h('div', { class: 'viewer-layout' });

  // Slides panel (read-only thumbnail navigation)
  const slidesPanel = createViewerSlidesPanel({
    h,
    pres,
    theme,
    getSelectedSlideId: () => selectedSlideId,
    setSelectedSlideId: selectSlide,
    getSlideCommentCount: (slideId) => slideCommentCounts?.[slideId] || 0,
  });
  layout.append(slidesPanel.panelEl);

  // Preview area
  const previewApi = createViewerPreview({
    h,
    pres,
    theme,
    id,
    getSelectedSlideId: () => selectedSlideId,
    setSelectedSlideId: selectSlide,
    canComment,
    commentsApi,
    user,
  });
  layout.append(previewApi.previewEl);

  shell.append(layout);

  // Comments panel (only for comment permission)
  if (canComment) {
    commentsPanel = createCommentsPanel({
      h,
      api,
      toast: { info: () => {}, error: () => {}, success: () => {} },
      presentationId: id,
      pres,
      user,
      getSelectedSlideId: () => selectedSlideId,
      onCommentCountChange: (count) => setCommentsBadgeFn?.(count),
      onSlideCommentCountsChange: (counts) => {
        slideCommentCounts = counts || {};
        try {
          rerenderSlideList?.();
        } catch {
          // ignore
        }
      },
      onJumpToSlide: (slideId) => {
        if (slideId && pres.slides?.some((s) => s?.id === slideId)) {
          selectSlide(slideId);
        }
      },
    });
    shell.append(commentsPanel.panelEl);

    // Load initial comments
    commentsPanel.loadComments?.().catch(() => {});
    commentsPanel.startPolling?.();
  }

  root.append(shell);

  // Assign rerenders
  rerenderSlideList = slidesPanel.rerenderSlideList;
  rerenderPreview = previewApi.rerenderPreview;

  // Initial render
  rerenderSlideList();
  rerenderPreview();

  // Scroll to initial slide if specified
  if (initialSlideId) {
    requestAnimationFrame(() => {
      try {
        const active = slidesPanel.panelEl.querySelector?.('.viewer-slide-item.is-active');
        active?.scrollIntoView?.({ block: 'nearest' });
      } catch {
        // ignore
      }
    });
  }

  /** Move `delta` slides from the current one, clamped to the deck. */
  const navigateSlide = (delta) => {
    const slides = pres.slides || [];
    const currentIndex = slides.findIndex((s) => s.id === selectedSlideId);
    const next = currentIndex + delta;
    if (currentIndex < 0 || next < 0 || next >= slides.length) return;
    selectSlide(slides[next].id);
  };

  // Keyboard navigation
  const handleKeydown = (e) => {
    // Don't navigate when typing in inputs
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      navigateSlide(-1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault();
      navigateSlide(1);
    }
  };
  document.addEventListener('keydown', handleKeydown);

  // Swipe navigation on the preview only — the slides panel and comments
  // pane scroll, and a swipe there should not change the slide.
  const detachSwipe = attachSwipeNavigation(previewApi.previewEl, {
    onPrev: () => navigateSlide(-1),
    onNext: () => navigateSlide(1),
  });

  const detach = () => {
    document.removeEventListener('keydown', handleKeydown);
    try {
      detachSwipe?.();
    } catch {
      // ignore
    }
    try {
      topbarApi.detach?.();
    } catch {
      // ignore
    }
    try {
      slidesPanel.detach?.();
    } catch {
      // ignore
    }
    try {
      previewApi.detach?.();
    } catch {
      // ignore
    }
    if (commentsPanel) {
      try {
        commentsPanel.stopPolling?.();
      } catch {
        // ignore
      }
    }
  };

  return { detach };
}