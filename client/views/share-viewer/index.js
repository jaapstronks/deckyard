/**
 * Share link viewer - allows external users to view presentations via share tokens.
 * Handles token validation, password prompts, permission-based access, and guest verification.
 *
 * This is the public seam for the share-viewer view; the concern modules
 * (topbar, auto-advance, error-display, guest-join, password-form,
 * viewer-comments) sit beside it in this folder.
 */

import { h } from '../../lib/dom.js';
import { spinner } from '../../lib/dom/spinner.js';
import { api } from '../../lib/api.js';
import { loadThemeById } from '../../lib/theme/theme.js';
import { attachThumbScale } from '../../lib/slide-runtime/thumb-scale.js';
import {
  cleanupSlideRuntimes,
  renderSlideElement,
} from '../../lib/slide-runtime/slide-render.js';
import { resolveDeckLang } from '../../../shared/i18n-utils.js';
import { t } from '../../lib/ui-i18n.js';
import { createEmptyState } from '../../lib/dom/empty-state.js';
import {
  createAnalyticsTracker,
  isAnalyticsEnabled,
} from '../../lib/format/analytics-tracker.js';

// Extracted components
import { renderPasswordPrompt } from './password-form.js';
import { renderError } from './error-display.js';
import { createVideoLayer } from '../../lib/slide-runtime/video-layer.js';
import { attachSwipeNavigation } from '../../lib/dom/swipe-nav.js';
import { buildShareViewerTopbar } from './topbar.js';
import { createGuestVerifyNotice } from './guest-verify-notice.js';
import { setupShareAutoAdvance } from './auto-advance.js';

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
  /**
   * The `?guest_error=` code the verification redirect came back with, held
   * until the viewer is built so the banner can sit inside the deck chrome.
   * Cleared on dismissal so a re-render does not resurrect it.
   * @type {string|null}
   */
  let guestVerifyError = null;

  // Validate the token first
  try {
    let data;
    try {
      data = await api(`/api/share/${encodeURIComponent(token)}`);
    } catch (err) {
      if (!err?.statusCode) throw err; // network failure: generic path below
      // renderError branches on err.code as a machine code (map lookup +
      // the `=== 'revoked'` blockquote gate), so pass the code, not the
      // human message. The custom revocation text rides along in err.body.
      renderError(shell, err.code, {
        message: err.body?.message || null,
        presentationTitle: err.body?.presentationTitle || null,
      });
      return cleanup;
    }

    if (data.requiresPassword) {
      renderPasswordPrompt(shell, token, data, async (verifiedData) => {
        shareLink = verifiedData;
        await renderDeck(verifiedData.presentation);
      });
      return cleanup;
    }

    // No password required - verify and load
    let verifyData;
    try {
      verifyData = await api(`/api/share/${encodeURIComponent(token)}/verify`, {
        method: 'POST',
        body: {},
      });
    } catch (err) {
      if (!err?.statusCode) throw err; // network failure: generic path below
      renderError(shell, err.code);
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
      // Held for renderViewer(), which puts it on screen. The parameter is
      // stripped in the same breath so a reload — or anything else that reads
      // the querystring later — cannot raise the banner a second time.
      guestVerifyError = urlParams.get('guest_error');
      window.history.replaceState({}, '', window.location.pathname);
    }

    await renderDeck(verifyData.presentation);
  } catch (err) {
    renderError(
      shell,
      err.message || t('share.error.loadLink', 'Failed to load share link'),
    );
  }

  /**
   * Render the deck that came back with `verify`.
   *
   * The deck rides on the verify response rather than being fetched from
   * `/api/presentations/:id`: that route is id-addressed and sits behind the
   * login gate, so an anonymous visitor holding a perfectly valid share link
   * got a 401 and this view rendered "Failed to load presentation". The share
   * token is the authorization here, and `verify` is the call that establishes
   * it.
   *
   * @param {Object|null} deck - Viewer-safe deck from the verify response.
   */
  async function renderDeck(deck) {
    shell.innerHTML = '';

    const loading = h('div', { class: 'share-viewer-loading' }, [
      spinner('lg'),
      h('div', {
        class: 'share-viewer-loading-text',
        text: t('share.loading', 'Loading presentation…'),
      }),
    ]);
    shell.append(loading);

    try {
      presentation = deck || null;

      if (!presentation) {
        throw new Error(t('share.error.notFound', 'Link Not Found'));
      }

      // Load theme
      theme = await loadThemeById(presentation.theme);

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
        shell,
        err.message ||
          t('share.error.loadPresentation', 'Failed to load presentation'),
      );
    }
  }

  /**
   * Release everything renderViewer() binds — the teardown half of this view.
   *
   * `cleanup()` calls it when the route unmounts, and renderViewer() calls it
   * before binding anything, so a second pass can never stack a second
   * document-level keydown handler on top of the first: two handlers sharing
   * currentSlideIndex means one arrow press advances two slides and
   * double-counts the view in analytics.
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

    const { topbar, commentsSection, openJoinPrompt } = buildShareViewerTopbar({
      presentation,
      shareLink,
      guestSession,
      token,
      prefillEmail,
      shell,
      getCurrentSlideId: () => {
        const slides = presentation.slides || [];
        return slides[currentSlideIndex]?.id || null;
      },
      analyticsTracker,
      onAnalyticsErased: () => {
        analyticsTracker = null;
      },
    });

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

    const nav = h('div', { class: 'share-viewer-nav' });
    const prevBtn = h('button', {
      class: 'btn btn-secondary share-viewer-nav-btn',
      text: '←',
    });
    const slideCounter = h('div', {
      class: 'share-viewer-counter',
      text: '1 / 1',
    });
    const nextBtn = h('button', {
      class: 'btn btn-secondary share-viewer-nav-btn',
      text: '→',
    });
    nav.append(prevBtn, slideCounter, nextBtn);

    // Auto-advance setup (skip entirely in pacing mode — pacing is presenter-only)
    autoAdvanceInstance = setupShareAutoAdvance({
      presentation,
      stage,
      onAdvance: () => navigateSlide(1),
      onLoopReset: () => {
        currentSlideIndex = 0;
        updateSlide(slideWrap, slideCounter);
        videoLayer?.updatePosition();
      },
    });

    prevBtn.addEventListener('click', () => navigateSlide(-1));
    nextBtn.addEventListener('click', () => navigateSlide(1));

    // Keyboard navigation
    const handleKeydown = (e) => {
      // Don't navigate when typing in comment input
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')
        return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        navigateSlide(-1);
      } else if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowDown' ||
        e.key === ' '
      ) {
        navigateSlide(1);
      }
    };
    document.addEventListener('keydown', handleKeydown);

    // The verification-failure banner sits between the deck chrome and the
    // slide: the link is valid and the deck is readable — only the identity
    // step failed, so it annotates the view instead of replacing it.
    if (guestVerifyError) {
      shell.append(
        topbar,
        createGuestVerifyNotice({
          code: guestVerifyError,
          signedInAs: guestSession?.authenticated
            ? guestSession.name || guestSession.email
            : null,
          onRequestNewLink: openJoinPrompt,
          onDismiss: () => {
            guestVerifyError = null;
          },
        }),
      );
    } else {
      shell.append(topbar);
    }
    shell.append(stage, nav);

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
        createEmptyState({
          icon: null,
          className: 'empty-state-fill',
          title: t('share.noSlides', 'No slides'),
        }),
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
      lang: resolveDeckLang(presentation),
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
    guestSession = await api(
      `/api/share/${encodeURIComponent(token)}/guest/me`,
    );
  } catch {
    guestSession = null;
  }
}
