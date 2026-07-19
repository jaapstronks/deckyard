/**
 * Viewer mode preview panel.
 * Large slide display with navigation arrows.
 */

import { attachThumbScale } from '../../lib/thumb-scale.js';
import { cleanupSlideRuntimes, mountSlideInto } from '../../lib/slide-render.js';
import { t } from '../../lib/ui-i18n.js';

export function createViewerPreview({
  h,
  pres,
  theme,
  id,
  getSelectedSlideId,
  setSelectedSlideId,
  canComment,
  commentsApi,
  user,
} = {}) {
  const previewEl = h('div', { class: 'viewer-preview' });

  // Slide container
  const slideContainer = h('div', { class: 'viewer-slide-container' });
  const slideWrap = h('div', { class: 'viewer-slide-wrap thumb' });
  slideContainer.append(slideWrap);

  // Navigation area
  const navEl = h('div', { class: 'viewer-nav' });

  const prevBtn = h('button', {
    class: 'btn btn-secondary viewer-nav-btn',
    text: '\u2190',
    title: t('viewer.nav.prev', 'Previous slide'),
    'aria-label': t('viewer.nav.prev', 'Previous slide'),
  });

  const counterEl = h('div', {
    class: 'viewer-counter',
    text: '1 / 1',
  });

  const nextBtn = h('button', {
    class: 'btn btn-secondary viewer-nav-btn',
    text: '\u2192',
    title: t('viewer.nav.next', 'Next slide'),
    'aria-label': t('viewer.nav.next', 'Next slide'),
  });

  navEl.append(prevBtn, counterEl, nextBtn);

  previewEl.append(slideContainer, navEl);

  // Attach thumb scaling
  let detachThumbScale = attachThumbScale(slideWrap, { virtualWidth: 1600 });

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
    counterEl.textContent = slides.length > 0
      ? `${currentIndex + 1} / ${slides.length}`
      : '0 / 0';

    // Update nav button states
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= slides.length - 1;

    // Render slide
    cleanupSlideRuntimes(slideWrap);
    if (slide) {
      mountSlideInto(slideWrap, slide, { theme, presentationId: pres?.id });
    } else {
      slideWrap.innerHTML = '';
      const empty = h('div', {
        class: 'viewer-empty',
        text: t('viewer.noSlides', 'No slides'),
      });
      slideWrap.append(empty);
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
    detach,
  };
}