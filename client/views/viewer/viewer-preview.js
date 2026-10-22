/**
 * Viewer mode preview panel.
 * Large slide display with navigation arrows.
 */

import { attachThumbScale } from '../../lib/slide-runtime/thumb-scale.js';
import {
  cleanupSlideRuntimes,
  mountSlideInto,
} from '../../lib/slide-runtime/slide-render.js';
import { resolveDeckLang } from '../../../shared/i18n-utils.js';
import { t } from '../../lib/ui-i18n.js';
import { createEmptyState } from '../../lib/dom/empty-state.js';
import { h } from '../../lib/dom/index.js';
import { icon } from '../../lib/dom/icons.js';
import { createCommentMarkers } from '../comments/index.js';
import { debugLog } from '../../lib/state/debug.js';

export function createViewerPreview({
  pres,
  theme,
  id,
  getSelectedSlideId,
  setSelectedSlideId,
  commentsApi,
  onMarkerClick,
} = {}) {
  const previewEl = h('div', { class: 'viewer-preview' });

  // Slide container
  const slideContainer = h('div', { class: 'viewer-slide-container' });
  const slideWrap = h('div', { class: 'viewer-slide-wrap thumb' });
  slideContainer.append(slideWrap);

  // Navigation area
  const navEl = h('div', { class: 'viewer-nav' });

  const prevBtn = h(
    'button',
    {
      class: 'btn btn-secondary viewer-nav-btn',
      title: t('viewer.nav.prev', 'Previous slide'),
      'aria-label': t('viewer.nav.prev', 'Previous slide'),
    },
    [icon('arrow-left')],
  );

  const counterEl = h('div', {
    class: 'viewer-counter',
    text: '1 / 1',
  });

  const nextBtn = h(
    'button',
    {
      class: 'btn btn-secondary viewer-nav-btn',
      title: t('viewer.nav.next', 'Next slide'),
      'aria-label': t('viewer.nav.next', 'Next slide'),
    },
    [icon('arrow-right')],
  );

  navEl.append(prevBtn, counterEl, nextBtn);

  previewEl.append(slideContainer, navEl);

  // Attach thumb scaling
  let detachThumbScale = attachThumbScale(slideWrap, { virtualWidth: 1600 });

  // Anchored comments show as pins for every reader, read-only: placing one
  // is the editor's (D355). A click opens the thread where there is a pane.
  const markers = commentsApi
    ? createCommentMarkers({
        containerEl: slideWrap,
        readOnly: true,
        onMarkerClick,
      })
    : null;
  let markersRequest = 0;

  /** Load the pins of the slide shown; a stale answer is dropped. */
  async function refreshMarkers() {
    if (!markers) return;
    const slideId = getSelectedSlideId?.();
    const request = ++markersRequest;
    let comments = [];
    if (slideId) {
      try {
        comments = await commentsApi.listSlideComments(slideId);
      } catch (err) {
        // Comments off (a sandbox example deck) or unreachable: no pins.
        debugLog('[viewer] slide comments for pins unavailable', err);
      }
    }
    if (request === markersRequest) markers.setComments(comments);
  }

  // Navigation handlers
  const navigateSlide = (delta) => {
    const slides = pres?.slides || [];
    const selectedId = getSelectedSlideId?.();
    const currentIndex = slides.findIndex((s) => s.id === selectedId);
    const newIndex = currentIndex + delta;

    if (newIndex >= 0 && newIndex < slides.length) {
      setSelectedSlideId?.(slides[newIndex].id);
    }
  };

  prevBtn.addEventListener('click', () => navigateSlide(-1));
  nextBtn.addEventListener('click', () => navigateSlide(1));

  const rerenderPreview = () => {
    const slides = pres?.slides || [];
    const selectedId = getSelectedSlideId?.();
    const slide = slides.find((s) => s.id === selectedId);
    const currentIndex = slides.findIndex((s) => s.id === selectedId);

    // Update counter
    counterEl.textContent =
      slides.length > 0 ? `${currentIndex + 1} / ${slides.length}` : '0 / 0';

    // Update nav button states
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= slides.length - 1;

    // Render slide
    cleanupSlideRuntimes(slideWrap);
    if (slide) {
      mountSlideInto(slideWrap, slide, {
        theme,
        presentationId: pres?.id,
        renderVia: { kind: 'deck', id: pres?.id },
        lang: resolveDeckLang(pres),
      });
      // The mount replaced the wrap's children; put the pin layer back.
      markers?.reattach();
      refreshMarkers();
    } else {
      slideWrap.replaceChildren();
      slideWrap.append(
        createEmptyState({
          icon: null,
          className: 'empty-state-fill',
          title: t('viewer.noSlides', 'No slides'),
        }),
      );
    }

    // Scroll to selected slide in panel
    requestAnimationFrame(() => {
      try {
        const panel = document.querySelector('.viewer-slides-panel');
        const active = panel?.querySelector?.('.viewer-slide-item.is-active');
        active?.scrollIntoView?.({ block: 'nearest' });
      } catch {
        // ignore
      }
    });
  };

  const detach = () => {
    markers?.detach();
    try {
      detachThumbScale();
    } catch {
      // ignore
    }
    cleanupSlideRuntimes(slideWrap);
  };

  return {
    previewEl,
    // Exposed so keyboard and swipe navigation in the controller go through
    // the same clamping as the ← / → buttons, rather than reimplementing it.
    navigateSlide,
    rerenderPreview,
    refreshMarkers,
    /** Point at a pin on the slide shown ("Show on slide" in the pane). */
    showCommentMarker: (commentId) => Boolean(markers?.flash(commentId)),
    detach,
  };
}
