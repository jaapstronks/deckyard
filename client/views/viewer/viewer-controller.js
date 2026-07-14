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
    setSelectedSlideId: (newId) => {
      selectedSlideId = newId;
      rerenderSlideList();
      rerenderPreview();
    },
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
    setSelectedSlideId: (newId) => {
      selectedSlideId = newId;
      rerenderSlideList();
      rerenderPreview();
    },
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
          selectedSlideId = slideId;
          rerenderSlideList();
          rerenderPreview();
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

  // Keyboard navigation
  const handleKeydown = (e) => {
    // Don't navigate when typing in inputs
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    const slides = pres.slides || [];
    const currentIndex = slides.findIndex((s) => s.id === selectedSlideId);

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentIndex > 0) {
        selectedSlideId = slides[currentIndex - 1].id;
        rerenderSlideList();
        rerenderPreview();
      }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault();
      if (currentIndex < slides.length - 1) {
        selectedSlideId = slides[currentIndex + 1].id;
        rerenderSlideList();
        rerenderPreview();
      }
    }
  };
  document.addEventListener('keydown', handleKeydown);

  const detach = () => {
    document.removeEventListener('keydown', handleKeydown);
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