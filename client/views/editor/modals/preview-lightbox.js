import { createOverlay } from '../../../lib/dom/modal.js';
import { icon } from '../../../lib/dom/icons.js';
import { t } from '../../../lib/ui-i18n.js';
import {
  createAnchoredCommentDetail,
  createAnchoredComposer,
  createCommentMarkers,
} from '../../comments/index.js';
import { h } from '../../../lib/dom/index.js';
import { takeEscape } from '../../../lib/dom/escape.js';

export function createPreviewLightbox({
  root,
  pres,
  theme,
  lockDocumentScroll,
  attachThumbScale,
  attachThumbScaleContain,
  renderSlideElement,
  getSelectedSlideId,
  // Comment support
  commentsApi,
  getAnchoredComposerSupport,
  onCommentAdded,
  // Navigation support
  onNavigate,
} = {}) {
  let rerenderPreviewLightbox = null;

  const rerenderIfOpen = () => {
    if (typeof rerenderPreviewLightbox !== 'function') return;
    try {
      rerenderPreviewLightbox();
    } catch {
      // ignore
    }
  };

  const open = () => {
    const selectedSlideId = getSelectedSlideId?.();
    const slide = (pres?.slides || []).find((s) => s?.id === selectedSlideId);
    if (!slide) return;

    const unlockScroll = lockDocumentScroll?.();
    const modal = h('div', {
      class: 'modal ps-modal preview-lightbox-modal',
    });
    // Escape is layered here (comment detail → pin mode → close), so the
    // overlay only owns the backdrop, the focus trap and focus restore; the
    // key handler below stays.
    const overlay = createOverlay({
      surface: modal,
      closeOnEscape: false,
      onClose: () => {
        try {
          document.removeEventListener('keydown', onKey);
          rerenderPreviewLightbox = null;
          hidePopup();
          hideCommentDetail();
          commentMarkers?.detach?.();
          detachBigThumbScale();
        } finally {
          try {
            unlockScroll?.();
          } catch {
            // ignore
          }
        }
      },
    });
    const close = () => overlay.close();

    const header = h('div', { class: 'ps-modal-header' });
    const headerLeft = h('div', { class: 'ps-modal-header-left row' });

    // Pin comment button in lightbox (if comments enabled)
    let pinBtn = null;
    let pinHint = null;
    let commentMarkers = null;
    let positionedPopup = null;

    if (commentsApi) {
      pinBtn = h('button', {
        class: 'btn btn-secondary btn-sm pin-comment-btn',
        title: t('comments.addPositioned', 'Add comment to specific spot'),
      });
      pinBtn.append(
        icon('map-pin', { size: 15, className: 'btn-pin-icon' }),
        h('span', {
          class: 'pin-comment-btn-label',
          text: t('comments.pinCommentLabel', 'Comment'),
        }),
      );
      pinHint = h('span', {
        class: 'pin-mode-hint',
        text: t('comments.pinModeHint', 'Click on the slide to place comment'),
      });
      pinHint.style.display = 'none';
      headerLeft.append(pinBtn, pinHint);
    }

    // Slide navigation controls
    const headerNav = h('div', { class: 'preview-lightbox-nav' });
    const prevBtn = h(
      'button',
      {
        class: 'btn btn-secondary btn-icon preview-lightbox-nav-btn',
        type: 'button',
        'aria-label': t('common.previous', 'Previous slide'),
        onclick: () => navigateSlide(-1),
      },
      [icon('chevron-left', { size: 18 })],
    );
    const slideCounter = h('span', { class: 'preview-lightbox-counter' });
    const nextBtn = h(
      'button',
      {
        class: 'btn btn-secondary btn-icon preview-lightbox-nav-btn',
        type: 'button',
        'aria-label': t('common.next', 'Next slide'),
        onclick: () => navigateSlide(1),
      },
      [icon('chevron-right', { size: 18 })],
    );
    headerNav.append(prevBtn, slideCounter, nextBtn);

    const headerRight = h('div', { class: 'ps-modal-header-right' });
    const closeBtn = h(
      'button',
      {
        class: 'btn btn-secondary btn-icon ps-modal-close',
        type: 'button',
        'aria-label': t('common.close', 'Close'),
        onclick: () => close(),
      },
      [icon('x', { size: 16 })],
    );
    headerRight.append(closeBtn);
    header.append(headerLeft, headerNav, headerRight);

    const body = h('div', { class: 'ps-modal-body preview-lightbox-body' });
    const stage = h('div', { class: 'preview-lightbox-stage' });
    const bigThumb = h('div', {
      class: 'thumb preview-lightbox-thumb',
    });
    stage.append(bigThumb);
    body.append(stage);

    const detachBigThumbScale =
      typeof attachThumbScaleContain === 'function'
        ? attachThumbScaleContain(bigThumb, {
            virtualWidth: 1600,
            virtualHeight: 900,
            containerEl: stage,
          })
        : attachThumbScale(bigThumb, { virtualWidth: 1600 });

    // Card showing an existing anchored comment at its pin
    let commentDetailPopup = null;

    const hideCommentDetail = () => {
      commentDetailPopup?.detach();
      commentDetailPopup = null;
    };

    const showCommentDetail = (comment) => {
      hideCommentDetail();
      hidePopup();
      commentDetailPopup = createAnchoredCommentDetail({
        stageEl: stage,
        thumbEl: bigThumb,
        comment,
        onClose: hideCommentDetail,
      });
    };

    // Helper to hide popup
    const hidePopup = () => {
      positionedPopup?.detach();
      positionedPopup = null;
    };

    const leaveAddMode = () => {
      hidePopup();
      commentMarkers?.exitAddMode?.();
      pinBtn?.classList?.remove('is-active');
      if (pinHint) pinHint.style.display = 'none';
    };

    // The same card as on the editor canvas (one composer, D355).
    const showPopup = (x, y) => {
      hidePopup();
      const support = getAnchoredComposerSupport?.();
      positionedPopup = createAnchoredComposer({
        stageEl: stage,
        thumbEl: bigThumb,
        x,
        y,
        attachMentions: support?.attachMentions,
        onSubmit: async (body) => {
          const position = { positionX: x, positionY: y };
          if (support) await support.onSubmit(body, position);
          else
            await commentsApi.createComment({
              body,
              slideId: getSelectedSlideId?.() || null,
              ...position,
            });
          leaveAddMode();
          refreshMarkers();
          onCommentAdded?.();
        },
        onCancel: () => leaveAddMode(),
      });
    };

    // Setup comment markers on lightbox thumb
    if (commentsApi) {
      commentMarkers = createCommentMarkers({
        containerEl: bigThumb,
        onMarkerClick: (comment) => {
          // Show comment detail popup
          showCommentDetail(comment);
        },
        onPositionSelect: ({ x, y }) => {
          hideCommentDetail();
          showPopup(x, y);
        },
      });

      // Pin button handler
      pinBtn.addEventListener('click', () => {
        hideCommentDetail();
        const isActive = commentMarkers.toggleAddMode();
        pinBtn.classList.toggle('is-active', isActive);
        pinHint.style.display = isActive ? '' : 'none';
        if (!isActive) hidePopup();
      });
    }

    const refreshMarkers = async () => {
      if (!commentMarkers || !commentsApi) return;
      try {
        const slideId = getSelectedSlideId?.();
        if (slideId) {
          commentMarkers.setComments(
            await commentsApi.listSlideComments(slideId),
          );
        }
      } catch (err) {
        console.error('Failed to refresh markers:', err);
      }
    };

    // Store markers container reference for re-appending after rerender
    let markersContainer = bigThumb.querySelector('.comment-markers-container');
    let lastRenderedSlideId = null;

    function navigateSlide(delta) {
      const slides = pres?.slides || [];
      const sid = getSelectedSlideId?.();
      const currentIndex = slides.findIndex((s) => s?.id === sid);
      const newIndex = currentIndex + delta;
      if (newIndex < 0 || newIndex >= slides.length) return;
      const newSlide = slides[newIndex];
      if (!newSlide?.id) return;
      // Dismiss open comment popups
      hidePopup();
      hideCommentDetail();
      commentMarkers?.exitAddMode?.();
      pinBtn?.classList?.remove('is-active');
      if (pinHint) pinHint.style.display = 'none';
      onNavigate?.(newSlide.id);
    }

    function updateNavState() {
      const slides = pres?.slides || [];
      const sid = getSelectedSlideId?.();
      const idx = slides.findIndex((s) => s?.id === sid);
      if (idx < 0) {
        slideCounter.textContent = '';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
      }
      slideCounter.textContent = `${idx + 1} / ${slides.length}`;
      prevBtn.disabled = idx <= 0;
      nextBtn.disabled = idx >= slides.length - 1;
    }

    const rerender = () => {
      const sid = getSelectedSlideId?.();
      const s = (pres?.slides || []).find((x) => x?.id === sid);
      updateNavState();
      // Preserve markers container before clearing
      markersContainer = bigThumb.querySelector('.comment-markers-container');
      bigThumb.replaceChildren();
      if (!s) return;
      bigThumb.append(
        renderSlideElement(s, { theme, presentationId: pres?.id }),
      );
      // Re-append markers container after slide content
      if (markersContainer) {
        bigThumb.appendChild(markersContainer);
      }
      if (commentMarkers) {
        commentMarkers.refresh?.();
      }
      // Refresh comment markers when the displayed slide changes
      if (sid !== lastRenderedSlideId) {
        lastRenderedSlideId = sid;
        refreshMarkers();
      }
    };
    rerender();
    rerenderPreviewLightbox = rerender;

    const onKey = (e) => {
      if (takeEscape(e)) {
        if (commentDetailPopup) {
          hideCommentDetail();
        } else if (positionedPopup) {
          leaveAddMode();
        } else {
          close();
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'INPUT' ||
          e.target.isContentEditable
        )
          return;
        e.preventDefault();
        navigateSlide(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };

    // Close when clicking anywhere in the modal *except* the slide itself.
    // But don't close if in add comment mode or viewing a comment
    modal.addEventListener('click', (e) => {
      if (commentMarkers?.isInAddMode?.()) return;
      if (header.contains(e.target)) return;
      if (
        !bigThumb.contains(e.target) &&
        !positionedPopup?.el.contains(e.target) &&
        !commentDetailPopup?.el.contains(e.target)
      ) {
        close();
      }
    });

    modal.append(header, body);
    overlay.show(root);
    document.addEventListener('keydown', onKey);
  };

  return { open, rerenderIfOpen };
}
