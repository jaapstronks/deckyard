/**
 * Share link viewer - allows external users to view presentations via share tokens.
 * Handles token validation, password prompts, permission-based access, and guest verification.
 */

import { h } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { loadThemeById } from '../lib/theme/theme.js';
import { attachThumbScale } from '../lib/slide-runtime/thumb-scale.js';
import { cleanupSlideRuntimes, renderSlideElement } from '../lib/slide-runtime/slide-render.js';
import { createUiModeSwitcher } from './ui-mode-switcher.js';
import { t } from '../lib/ui-i18n.js';
import { createCommentsApi } from './editor/comments-api.js';
import { createAnalyticsTracker, isAnalyticsEnabled } from '../lib/format/analytics-tracker.js';

// Extracted components
import { renderPasswordPrompt } from './share-viewer/password-form.js';
import { renderError, getPermissionLabel } from './share-viewer/error-display.js';
import { renderGuestJoinPrompt } from './share-viewer/guest-join.js';
import { createShareViewerCommentsSection } from './share-viewer/viewer-comments.js';
import { createVideoLayer } from '../lib/slide-runtime/video-layer.js';
import { createAutoAdvance } from './presenter/auto-advance.js';
import { attachSwipeNavigation } from '../lib/dom/swipe-nav.js';
import { getSlideEffectiveDuration, DEFAULT_ADVANCE_INTERVAL_SECONDS } from '../../shared/slide-timing.js';

// Guest session state
let guestSession = null;

/**
 * Render the share viewer for a given token.
 * @param {HTMLElement} root - Root element to render into
 * @param {string} token - The share token
 * @param {Object} options - Options
 * @returns {Function|null} - Cleanup function
 */
export async function renderShareViewer(root, token) {
  document.documentElement.classList.add('is-share-viewer');

  // Extract email from URL for pre-filling guest join form
  const urlParams = new URL(location.href).searchParams;
  const prefillEmail = (urlParams.get('email') || '').trim();

  const shell = h('div', { class: 'share-viewer-shell' });
  root.append(shell);

  // State
  let shareLink = null;
  let presentation = null;
  let theme = null;
  let currentSlideIndex = 0;
  let detachThumb = () => {};
  let detachSwipe = () => {};
  let keydownHandler = null;
  let analyticsTracker = null;
  let videoLayer = null;
  let autoAdvanceInstance = null;

  // Validate the token first
  try {
    const resp = await fetch(`/api/share/${encodeURIComponent(token)}`);
    const data = await resp.json();

    if (!resp.ok) {
      // Pass additional error data for revoked links
      const errorData = {
        message: data.message || null,
        presentationTitle: data.presentationTitle || null,
      };
      renderError(h, shell, data.error, errorData);
      return cleanup;
    }

    if (data.requiresPassword) {
      renderPasswordPrompt(h, shell, token, data, async (verifiedData) => {
        shareLink = verifiedData.shareLink || verifiedData;
        await loadAndRenderPresentation();
      });
      return cleanup;
    }

    // No password required - verify and load
    const verifyResp = await fetch(`/api/share/${encodeURIComponent(token)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const verifyData = await verifyResp.json();

    if (!verifyResp.ok) {
      renderError(h, shell, verifyData.error);
      return cleanup;
    }

    shareLink = verifyData;

    // Check for guest session
    await checkGuestSession(token);

    // Handle URL parameters from verification redirect
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('guest_verified') === 'true') {
      // Remove URL parameters
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (urlParams.get('guest_error')) {
      const errorCode = urlParams.get('guest_error');
      // Remove URL parameters
      window.history.replaceState({}, '', window.location.pathname);
      // Show error but continue loading
      console.warn('Guest verification error:', errorCode);
    }

    await loadAndRenderPresentation();
  } catch (err) {
    renderError(h, shell, err.message || t('share.error.loadLink', 'Failed to load share link'));
  }

  async function loadAndRenderPresentation() {
    shell.innerHTML = '';

    const loading = h('div', { class: 'share-viewer-loading' }, [
      h('div', { class: 'spinner' }),
      h('div', { class: 'share-viewer-loading-text', text: t('share.loading', 'Loading presentation...') }),
    ]);
    shell.append(loading);

    try {
      // Fetch the presentation
      const presResp = await api(`/api/presentations/${shareLink.presentationId}`);
      presentation = presResp;

      if (!presentation) {
        throw new Error(t('share.error.notFound', 'Presentation not found'));
      }

      // Load theme
      theme = await loadThemeById(presentation.theme);

      // Make presentation ID globally available for lead capture forms
      window.__PRESENTATION_ID__ = presentation.id;

      // Initialize analytics tracking
      if (isAnalyticsEnabled(presentation)) {
        analyticsTracker = createAnalyticsTracker({
          presentationId: presentation.id,
          sourceType: 'share_link',
          sourceId: token,
          viewerEmail: guestSession?.email || null,
          viewerType: guestSession?.authenticated ? 'guest' : 'anonymous',
        });
        analyticsTracker.start();
      }

      shell.innerHTML = '';
      renderViewer();
    } catch (err) {
      shell.innerHTML = '';
      renderError(
        h,
        shell,
        err.message || t('share.error.loadPresentation', 'Failed to load presentation')
      );
    }
  }

  /**
   * Release everything renderViewer() binds. It re-runs after a guest joins
   * the discussion (which wipes shell and rebuilds), so without this each
   * pass stacked another document-level keydown handler on top of the last —
   * two handlers sharing currentSlideIndex means one arrow press advances two
   * slides and double-counts the view in analytics.
   */
  function detachViewerListeners() {
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
    try {
      detachSwipe();
    } catch {}
    detachSwipe = () => {};
    try {
      detachThumb();
    } catch {}
    detachThumb = () => {};
  }

  function renderViewer() {
    detachViewerListeners();

    const topbar = h('div', { class: 'share-viewer-topbar' });

    const titleEl = h('div', { class: 'share-viewer-title', text: presentation.title || 'Presentation' });
    const permissionBadge = h('div', {
      class: `share-viewer-permission share-viewer-permission--${shareLink.permission}`,
      text: getPermissionLabel(shareLink.permission),
    });

    const controls = h('div', { class: 'share-viewer-controls' });

    // Add guest join button if permission allows commenting.
    // Share links are only ever issued as 'view' or 'comment' (see the create
    // form in share-modal); there is no guest-editing flow, so 'edit' is not
    // handled here.
    const canComment = shareLink.permission === 'comment';

    // Comments toggle button (shown when guest is authenticated and can comment)
    let commentsToggleBtn = null;
    let commentsSection = null;
    let commentsApi = null;

    if (canComment && guestSession?.authenticated) {
      commentsApi = createCommentsApi({ api, presentationId: presentation.id });

      commentsToggleBtn = h('button', {
        class: 'btn btn-secondary share-viewer-comments-toggle',
        text: t('comments.title', 'Comments'),
      });

      // Create comments section (initially hidden)
      commentsSection = createShareViewerCommentsSection({
        h,
        commentsApi,
        presentation,
        guestSession,
        getCurrentSlideId: () => {
          const slides = presentation.slides || [];
          return slides[currentSlideIndex]?.id || null;
        },
      });

      commentsToggleBtn.addEventListener('click', () => {
        commentsSection.toggle();
        commentsToggleBtn.classList.toggle('is-active', commentsSection.isVisible());
      });

      controls.append(commentsToggleBtn);
    }

    if (canComment) {
      const guestStatusEl = h('div', { class: 'share-viewer-guest-status' });

      if (guestSession?.authenticated) {
        // Show logged in status
        const guestName = guestSession.name || guestSession.email;
        const guestInfo = h('div', { class: 'share-viewer-guest-info' }, [
          h('span', { class: 'share-viewer-guest-avatar', text: guestName.charAt(0).toUpperCase() }),
          h('span', { class: 'share-viewer-guest-name', text: guestName }),
        ]);
        guestStatusEl.append(guestInfo);
      } else {
        // Show join button
        const joinBtn = h('button', {
          class: 'btn btn-secondary share-viewer-join-btn',
          text: t('share.guest.join', 'Join discussion'),
        });
        joinBtn.addEventListener('click', () => {
          renderGuestJoinPrompt(h, shell, token, shareLink.permission, async () => {
            // Refresh guest session and re-render
            await checkGuestSession(token);
            shell.innerHTML = '';
            renderViewer();
          }, prefillEmail);
        });
        guestStatusEl.append(joinBtn);
      }

      controls.append(guestStatusEl);
    }

    const uiMode = createUiModeSwitcher({ h, className: 'share-viewer-ui-mode' });
    controls.append(uiMode.el);

    topbar.append(titleEl, permissionBadge, controls);

    const stage = h('div', { class: 'share-viewer-stage' });
    const slideWrap = h('div', { class: 'share-viewer-slide thumb' });
    stage.append(slideWrap);

    // Create video layer if live video is enabled
    const liveVideo = presentation?.settings?.liveVideo;
    if (liveVideo?.enabled && liveVideo?.streamUrl) {
      videoLayer = createVideoLayer({
        containerEl: stage,
        getCurrentSlide: () => {
          const slides = presentation.slides || [];
          return slides[currentSlideIndex] || null;
        },
      });
      videoLayer.setConfig(liveVideo);
    }

    // Auto-advance setup (skip entirely in pacing mode — pacing is presenter-only)
    const autoAdvanceCfg = presentation?.settings?.autoAdvance;
    const autoAdvanceMode = autoAdvanceCfg?.mode === 'pacing' ? 'pacing' : 'auto';
    const autoAdvanceEnabled = !!autoAdvanceCfg?.enabled && autoAdvanceMode === 'auto';
    if (autoAdvanceEnabled) {
      const barEl = h('div', { class: 'auto-advance-bar' });
      const barFill = h('div', { class: 'auto-advance-bar-fill' });
      barEl.append(barFill);
      barEl.hidden = autoAdvanceCfg?.showCountdown === false;
      stage.append(barEl);

      // Per-slide duration lookup
      const getSlideInterval = (idx) => {
        const slides = presentation.slides || [];
        return getSlideEffectiveDuration(slides[idx], autoAdvanceCfg?.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS);
      };

      autoAdvanceInstance = createAutoAdvance({
        onAdvance: () => navigateSlide(1),
        onTick: (progress) => {
          barFill.style.width = `${(progress * 100).toFixed(1)}%`;
        },
        onStateChange: (s) => {
          barEl.classList.toggle('is-paused', s === 'paused');
        },
        onLoopComplete: () => {
          currentSlideIndex = 0;
          updateSlide(slideWrap, slideCounter);
          videoLayer?.updatePosition();
          autoAdvanceInstance?.onSlideChanged(0, (presentation.slides || []).length);
        },
      });
      autoAdvanceInstance.configure({
        intervalSeconds: autoAdvanceCfg?.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS,
        loop: !!autoAdvanceCfg?.loop,
        mode: 'auto',
        getSlideInterval,
      });
    }

    const nav = h('div', { class: 'share-viewer-nav' });
    const prevBtn = h('button', { class: 'btn btn-secondary share-viewer-nav-btn', text: '←' });
    const slideCounter = h('div', { class: 'share-viewer-counter', text: '1 / 1' });
    const nextBtn = h('button', { class: 'btn btn-secondary share-viewer-nav-btn', text: '→' });
    nav.append(prevBtn, slideCounter, nextBtn);

    prevBtn.addEventListener('click', () => navigateSlide(-1));
    nextBtn.addEventListener('click', () => navigateSlide(1));

    // Keyboard navigation
    const handleKeydown = (e) => {
      // Don't navigate when typing in comment input
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        navigateSlide(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        navigateSlide(1);
      }
    };
    document.addEventListener('keydown', handleKeydown);

    shell.append(topbar, stage, nav);

    // Add comments section below navigation if available
    if (commentsSection) {
      shell.append(commentsSection.el);
    }

    detachThumb = attachThumbScale(slideWrap, { virtualWidth: 1600 });

    // Initial render
    updateSlide(slideWrap, slideCounter);

    // Start auto-advance after initial slide
    if (autoAdvanceInstance) {
      const slides = presentation.slides || [];
      autoAdvanceInstance.onSlideChanged(0, slides.length);
      autoAdvanceInstance.start();
    }

    function navigateSlide(delta) {
      const slides = presentation.slides || [];
      const newIndex = currentSlideIndex + delta;
      if (newIndex >= 0 && newIndex < slides.length) {
        currentSlideIndex = newIndex;
        updateSlide(slideWrap, slideCounter);
        videoLayer?.updatePosition();
        // Reset auto-advance timer on manual navigation
        autoAdvanceInstance?.onSlideChanged(currentSlideIndex, slides.length);
        // Refresh comments when slide changes if visible
        if (commentsSection?.isVisible()) {
          commentsSection.refresh();
        }
      }
    }

    // Swipe navigation on the stage only — the comments list below it scrolls,
    // and a swipe there should never change the slide.
    detachSwipe = attachSwipeNavigation(stage, {
      onPrev: () => navigateSlide(-1),
      onNext: () => navigateSlide(1),
    });

    keydownHandler = handleKeydown;
  }

  function updateSlide(slideWrap, slideCounter) {
    const slides = presentation.slides || [];
    const slide = slides[currentSlideIndex];

    if (!slide) {
      slideWrap.innerHTML = '';
      slideWrap.append(
        h('div', { class: 'share-viewer-empty', text: t('share.noSlides', 'No slides') })
      );
      return;
    }

    slideCounter.textContent = `${currentSlideIndex + 1} / ${slides.length}`;

    // Track slide view
    if (analyticsTracker?.isTracking()) {
      analyticsTracker.trackSlide(slide.id, currentSlideIndex);
    }

    cleanupSlideRuntimes(slideWrap);
    slideWrap.innerHTML = '';

    const slideEl = renderSlideElement(slide, {
      mode: 'thumb',
      theme,
      presentationId: presentation.id,
    });

    slideWrap.append(slideEl);
  }

  function cleanup() {
    document.documentElement.classList.remove('is-share-viewer');
    detachViewerListeners();
    cleanupSlideRuntimes(shell);
    videoLayer?.destroy();
    videoLayer = null;
    try {
      autoAdvanceInstance?.destroy?.();
    } catch {}
    autoAdvanceInstance = null;
    // Clean up analytics tracker
    if (analyticsTracker) {
      analyticsTracker.destroy();
      analyticsTracker = null;
    }
  }

  return cleanup;
}

/**
 * Check for an existing guest session.
 * @param {string} token - The share token
 */
async function checkGuestSession(token) {
  try {
    guestSession = await api(`/api/share/${encodeURIComponent(token)}/guest/me`);
  } catch {
    guestSession = null;
  }
}