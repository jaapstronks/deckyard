import { t } from '../../../lib/ui-i18n.js';
import { createCommentMarkers } from '../comment-markers.js';
import { iconUrl } from '../../../../shared/icon-names.js';
import { renderCommentBodyNodes } from '../../../lib/comments/comment-body.js';

export function createPreviewLightbox({
  h,
  root,
  pres,
  theme,
  lockDocumentScroll,
  attachThumbScale,
  attachThumbScaleContain,
  renderSlideElement,
  openOverlayClosers,
  getSelectedSlideId,
  // Comment support
  commentsApi,
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
    const slide = (pres?.slides || []).find(
      (s) => s?.id === selectedSlideId
    );
    if (!slide) return;

    const unlockScroll = lockDocumentScroll?.();
    const backdrop = h('div', { class: 'modal-backdrop ps-modal-overlay' });
    const modal = h('div', {
      class: 'modal ps-modal preview-lightbox-modal',
    });

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
        h('img', { class: 'btn-pin-icon', src: iconUrl('map-pin'), alt: '', 'aria-hidden': 'true' }),
        h('span', { class: 'pin-comment-btn-label', text: t('comments.pinCommentLabel', 'Comment') })
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
    const prevBtn = h('button', {
      class: 'btn btn-secondary btn-icon preview-lightbox-nav-btn',
      type: 'button',
      'aria-label': t('common.previous', 'Previous slide'),
      onclick: () => navigateSlide(-1),
    }, [
      h('svg', { width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
        h('path', { d: 'M15 18l-6-6 6-6' }),
      ]),
    ]);
    const slideCounter = h('span', { class: 'preview-lightbox-counter' });
    const nextBtn = h('button', {
      class: 'btn btn-secondary btn-icon preview-lightbox-nav-btn',
      type: 'button',
      'aria-label': t('common.next', 'Next slide'),
      onclick: () => navigateSlide(1),
    }, [
      h('svg', { width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
        h('path', { d: 'M9 18l6-6-6-6' }),
      ]),
    ]);
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
      [
        h(
          'svg',
          {
            width: '16',
            height: '16',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2',
          },
          [h('path', { d: 'M18 6L6 18M6 6l12 12' })]
        ),
      ]
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

    // Comment detail popup for viewing existing comments
    let commentDetailPopup = null;

    const hideCommentDetail = () => {
      if (commentDetailPopup) {
        commentDetailPopup.remove();
        commentDetailPopup = null;
      }
    };

    const showCommentDetail = (comment) => {
      hideCommentDetail();
      hidePopup();

      // Calculate position based on comment's stored position
      const thumbRect = bigThumb.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const x = comment.positionX;
      const y = comment.positionY;
      const pixelX = thumbRect.left - stageRect.left + (x / 100) * thumbRect.width;
      const pixelY = thumbRect.top - stageRect.top + (y / 100) * thumbRect.height;

      const positionClasses = ['comment-detail-popup'];
      if (x > 50) positionClasses.push('anchor-right');
      if (y > 60) positionClasses.push('anchor-bottom');

      commentDetailPopup = h('div', {
        class: positionClasses.join(' '),
        style: `left: ${pixelX}px; top: ${pixelY}px;`,
      });

      // Header with author and time
      const headerEl = h('div', { class: 'comment-detail-header' });
      const authorEl = h('span', {
        class: 'comment-detail-author',
        text: comment.authorName || comment.authorEmail || t('comments.unknownAuthor', 'Unknown'),
      });
      const timeEl = h('span', {
        class: 'comment-detail-time',
        text: formatTime(comment.createdAt),
      });
      const closeBtn = h('button', {
        class: 'comment-detail-close',
        type: 'button',
        text: '×',
        onclick: () => hideCommentDetail(),
      });
      headerEl.append(authorEl, timeEl, closeBtn);

      // Body with comment text (mention markers render as chips)
      const bodyEl = h('div', { class: 'comment-detail-body' });
      bodyEl.append(...renderCommentBodyNodes(comment.body, h));

      // Replies if any
      const repliesEl = h('div', { class: 'comment-detail-replies' });
      if (comment.replies && comment.replies.length > 0) {
        for (const reply of comment.replies) {
          const replyEl = h('div', { class: 'comment-detail-reply' });
          const replyAuthor = h('span', {
            class: 'comment-detail-reply-author',
            text: reply.authorName || reply.authorEmail || t('comments.unknownAuthor', 'Unknown'),
          });
          const replyBody = h('span', { class: 'comment-detail-reply-body' });
          replyBody.append(...renderCommentBodyNodes(reply.body, h));
          replyEl.append(replyAuthor, replyBody);
          repliesEl.append(replyEl);
        }
      }

      commentDetailPopup.append(headerEl, bodyEl, repliesEl);
      stage.appendChild(commentDetailPopup);
    };

    const formatTime = (isoString) => {
      if (!isoString) return '';
      try {
        const date = new Date(isoString);
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return t('comments.time.justNow', 'Just now');
        if (minutes < 60) return t('comments.time.minutesAgo', '{count}m ago', { count: minutes });
        if (hours < 24) return t('comments.time.hoursAgo', '{count}h ago', { count: hours });
        if (days < 7) return t('comments.time.daysAgo', '{count}d ago', { count: days });
        return date.toLocaleDateString();
      } catch {
        return '';
      }
    };

    // Helper to hide popup
    const hidePopup = () => {
      if (positionedPopup) {
        positionedPopup.remove();
        positionedPopup = null;
      }
    };

    // Helper to show positioned comment popup
    const showPopup = (x, y) => {
      hidePopup();

      const thumbRect = bigThumb.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const pixelX = thumbRect.left - stageRect.left + (x / 100) * thumbRect.width;
      const pixelY = thumbRect.top - stageRect.top + (y / 100) * thumbRect.height;

      const positionClasses = ['positioned-comment-popup'];
      if (x > 50) positionClasses.push('anchor-right');
      if (y > 60) positionClasses.push('anchor-bottom');

      positionedPopup = h('div', {
        class: positionClasses.join(' '),
        style: `left: ${pixelX}px; top: ${pixelY}px;`,
      });

      const marker = h('div', { class: 'positioned-comment-marker' });
      const textarea = h('textarea', {
        class: 'form-input',
        placeholder: t('comments.addPlaceholder', 'Add a comment...'),
        rows: 2,
      });

      const actions = h('div', { class: 'positioned-comment-popup-actions' });
      const cancelBtn = h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        text: t('common.cancel', 'Cancel'),
        onclick: () => {
          hidePopup();
          commentMarkers?.exitAddMode?.();
          pinBtn?.classList?.remove('is-active');
          if (pinHint) pinHint.style.display = 'none';
        },
      });
      const submitBtn = h('button', {
        class: 'btn btn-primary btn-sm',
        type: 'button',
        text: t('comments.post', 'Post'),
        onclick: async () => {
          const body = textarea.value.trim();
          if (!body) return;

          try {
            submitBtn.disabled = true;
            await commentsApi.createComment({
              body,
              slideId: getSelectedSlideId?.() || null,
              positionX: x,
              positionY: y,
            });
            hidePopup();
            commentMarkers?.exitAddMode?.();
            pinBtn?.classList?.remove('is-active');
            if (pinHint) pinHint.style.display = 'none';
            refreshMarkers();
            onCommentAdded?.();
          } catch (err) {
            console.error('Failed to post comment:', err);
          } finally {
            submitBtn.disabled = false;
          }
        },
      });

      actions.append(cancelBtn, submitBtn);
      positionedPopup.append(marker, textarea, actions);
      stage.style.position = 'relative';
      stage.appendChild(positionedPopup);
      textarea.focus();
    };

    // Setup comment markers on lightbox thumb
    if (commentsApi) {
      commentMarkers = createCommentMarkers({
        h,
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
          const result = await commentsApi.listComments({ slideId });
          commentMarkers.setComments(result.comments || []);
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
      const currentIndex = slides.findIndex(s => s?.id === sid);
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
      const idx = slides.findIndex(s => s?.id === sid);
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
      bigThumb.innerHTML = '';
      if (!s) return;
      bigThumb.append(renderSlideElement(s, { theme, presentationId: pres?.id }));
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
      if (e.key === 'Escape') {
        if (commentDetailPopup) {
          hideCommentDetail();
        } else if (positionedPopup) {
          hidePopup();
          commentMarkers?.exitAddMode?.();
          pinBtn?.classList?.remove('is-active');
          if (pinHint) pinHint.style.display = 'none';
        } else {
          close();
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
        e.preventDefault();
        navigateSlide(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };

    const close = () => {
      try {
        document.removeEventListener('keydown', onKey);
        rerenderPreviewLightbox = null;
        hidePopup();
        hideCommentDetail();
        commentMarkers?.destroy?.();
        detachBigThumbScale();
        backdrop.remove();
      } finally {
        try {
          unlockScroll?.();
        } catch {
          // ignore
        }
        openOverlayClosers?.delete(close);
      }
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    // Close when clicking anywhere in the modal *except* the slide itself.
    // But don't close if in add comment mode or viewing a comment
    modal.addEventListener('click', (e) => {
      if (commentMarkers?.isInAddMode?.()) return;
      if (header.contains(e.target)) return;
      if (!bigThumb.contains(e.target) &&
          !positionedPopup?.contains(e.target) &&
          !commentDetailPopup?.contains(e.target)) {
        close();
      }
    });

    modal.append(header, body);
    backdrop.append(modal);
    root.append(backdrop);
    openOverlayClosers?.add(close);
    document.addEventListener('keydown', onKey);
  };

  return { open, rerenderIfOpen };
}
