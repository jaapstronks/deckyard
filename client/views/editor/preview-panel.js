import { createPreviewLightbox } from './modals/preview-lightbox.js';
import { t } from '../../lib/ui-i18n.js';
import { createCommentMarkers } from './comment-markers.js';
import { zoomInIcon } from '../../lib/icons.js';

export function createPreviewPanel({
  h,
  root,
  pres,
  theme,
  iconUrl,
  lockDocumentScroll,
  attachThumbScale,
  attachThumbScaleContain,
  renderSlideElement,
  openOverlayClosers,
  getSelectedSlideId,
  nav,
  // Slide comments support
  commentsApi,
  user,
  // Positioned-marker click: opens the comments pane on this comment (the
  // under-slide thread list folded into the inspector rail, fase 4).
  onOpenComments,
  // Lightbox navigation
  onLightboxNavigate,
  // Pane tabs (Inspector / Comments): the far-right group of the slide
  // toolbar, directly above the rail the tabs control.
  paneTabsEl,
  // Presenter-notes strip, mounted under the slide (see notes-strip.js).
  notesStripEl,
} = {}) {
  const preview = h('div', { class: 'panel preview-panel' });

  const previewLightbox = createPreviewLightbox({
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
    // Pass comments support to lightbox
    commentsApi,
    onCommentAdded: () => {
      refreshCommentMarkers();
    },
    onNavigate: onLightboxNavigate,
  });
  const openPreviewLightbox = () => previewLightbox.open();

  const previewHeader = h('div', {
    class: 'row spread preview-panel-header',
  });
  // Slide toolbar (chrome re-org 2026-07-16): everything scoped to the
  // CURRENT slide lives with the slide, not in the inspector header. The
  // editor form renders the slide-dependent contents (type chip, "All text",
  // lock, actions menu) into these mounts on every rerender.
  const slideToolbarLeft = h('div', { class: 'row slide-toolbar-left' });
  previewHeader.append(slideToolbarLeft);

  const zoomBtn = h('button', {
    class: 'ghost-icon-btn preview-zoom-btn',
    title: t('editor.preview.openLarge', 'Open larger preview'),
    'aria-label': t('editor.preview.openLarge', 'Open larger preview'),
    onclick: () => openPreviewLightbox(),
  });
  zoomBtn.append(zoomInIcon({ size: 16 }));

  // Add-comment button (only shown if commentsApi is available). Labeled, not
  // icon-only: placing a comment was too well hidden as a bare pin glyph. When
  // active it flips to a Cancel affordance. The mode hint no longer lives in
  // the toolbar (it wrapped and unbalanced the row) - it renders as an overlay
  // banner on the slide stage instead (see pinModeHint below).
  let pinCommentBtn = null;
  let pinCommentLabel = null;
  let pinModeHint = null;
  if (commentsApi) {
    pinCommentBtn = h('button', {
      class: 'btn btn-secondary btn-sm pin-comment-btn',
      type: 'button',
      title: t('comments.addPositioned', 'Add comment to specific spot'),
    });
    pinCommentLabel = h('span', {
      class: 'pin-comment-label',
      text: t('comments.addLabel', 'Add comment'),
    });
    pinCommentBtn.append(
      h('img', { class: 'btn-pin-icon', src: iconUrl('map-pin'), alt: '', 'aria-hidden': 'true' }),
      pinCommentLabel
    );
    // Mode hint: rendered as an overlay on the stage (appended to previewStage
    // further down), toggled with add-mode. Kept out of the flex toolbar row.
    pinModeHint = h('span', {
      class: 'pin-mode-hint',
      text: t('comments.pinModeHint', 'Click on the slide to place comment'),
    });
    pinModeHint.hidden = true;
  }

  const headerActions = h('div', { class: 'row preview-panel-actions' });
  const slideToolbarActions = h('div', { class: 'row slide-toolbar-actions' });
  if (pinCommentBtn) headerActions.append(pinCommentBtn);
  headerActions.append(zoomBtn, slideToolbarActions);
  if (paneTabsEl) {
    headerActions.append(
      h('div', { class: 'slide-toolbar-sep', 'aria-hidden': 'true' }),
      paneTabsEl
    );
  }
  previewHeader.append(headerActions);
  preview.append(previewHeader);

  const previewScroll = h('div', { class: 'panel-scroll preview-panel-scroll' });
  const previewStage = h('div', { class: 'preview-stage' });
  const thumb = h('div', {
    class: 'thumb is-clickable-preview',
    title: t('editor.preview.clickToZoom', 'Click to open larger preview'),
  });
  thumb.addEventListener('click', (e) => {
    // Avoid opening when selecting/copying text inside the rendered slide.
    if (e.defaultPrevented) return;
    // Don't open lightbox if in add comment mode
    if (commentMarkers?.isInAddMode?.()) return;
    // On inline-editable slides, clicking the preview is for editing text — the
    // large preview has its own zoom button, so a stray click must not zoom.
    if (thumb.classList.contains('is-inline-edit')) return;
    openPreviewLightbox();
  });
  previewStage.append(thumb);
  // Add-comment mode hint: an overlay banner on the stage (pointer-through so
  // it never blocks the placement click). Lives here, not in the toolbar row.
  if (pinModeHint) previewStage.append(pinModeHint);

  // Comment markers on the slide preview - setup functions first
  let commentMarkers = null;
  let positionedCommentPopup = null;

  function hidePositionedCommentPopup() {
    if (positionedCommentPopup) {
      positionedCommentPopup.remove();
      positionedCommentPopup = null;
    }
    // Also hide hint when popup is dismissed
    if (pinModeHint) {
      pinModeHint.hidden = true;
    }
  }

  // Reflect add-comment mode on the toolbar button: filled + "Cancel" while
  // active, back to "Add comment" when idle. Centralized so every exit path
  // (toolbar toggle, composer Cancel, composer Post) restores the same state.
  function syncPinButton(isActive) {
    if (!pinCommentBtn) return;
    pinCommentBtn.classList.toggle('is-active', isActive);
    pinCommentBtn.title = isActive
      ? t('comments.cancelPosition', 'Cancel')
      : t('comments.addPositioned', 'Add comment to specific spot');
    if (pinCommentLabel) {
      pinCommentLabel.textContent = isActive
        ? t('comments.cancelPosition', 'Cancel')
        : t('comments.addLabel', 'Add comment');
    }
    if (pinModeHint) pinModeHint.hidden = !isActive;
  }

  async function refreshCommentMarkers() {
    if (!commentMarkers || !commentsApi) return;
    try {
      const slideId = getSelectedSlideId?.();
      if (slideId) {
        const result = await commentsApi.listComments({ slideId });
        commentMarkers.setComments(result.comments || []);
      } else {
        commentMarkers.setComments([]);
      }
    } catch (err) {
      console.error('Failed to refresh comment markers:', err);
    }
  }

  function showPositionedCommentPopup(x, y) {
    hidePositionedCommentPopup();

    // Calculate pixel position based on thumb bounds
    const thumbRect = thumb.getBoundingClientRect();
    const stageRect = previewStage.getBoundingClientRect();

    // Position within stage (which is the positioning context)
    const pixelX = thumbRect.left - stageRect.left + (x / 100) * thumbRect.width;
    const pixelY = thumbRect.top - stageRect.top + (y / 100) * thumbRect.height;

    // Smart positioning: avoid edge clipping
    const positionClasses = ['positioned-comment-popup'];
    if (x > 50) positionClasses.push('anchor-right');
    if (y > 60) positionClasses.push('anchor-bottom');

    positionedCommentPopup = h('div', {
      class: positionClasses.join(' '),
      style: `left: ${pixelX}px; top: ${pixelY}px;`,
    });

    // Store the original click position for the marker (as percentage)
    const clickX = x;
    const clickY = y;

    // Small marker at click point
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
        hidePositionedCommentPopup();
        commentMarkers?.exitAddMode?.();
        syncPinButton(false);
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
            positionX: clickX,
            positionY: clickY,
          });
          hidePositionedCommentPopup();
          commentMarkers?.exitAddMode?.();
          syncPinButton(false);
          // Refresh to show the new marker
          refreshCommentMarkers();
        } catch (err) {
          console.error('Failed to post positioned comment:', err);
        } finally {
          submitBtn.disabled = false;
        }
      },
    });

    actions.append(cancelBtn, submitBtn);
    positionedCommentPopup.append(marker, textarea, actions);
    // Render in previewStage (not thumb) to avoid overflow clipping
    previewStage.style.position = 'relative';
    previewStage.appendChild(positionedCommentPopup);
    textarea.focus();
  }

  if (commentsApi) {
    commentMarkers = createCommentMarkers({
      h,
      containerEl: thumb,
      onMarkerClick: (comment) => {
        // Open the comments pane in the inspector rail on this comment.
        onOpenComments?.(comment.id);
      },
      onPositionSelect: ({ x, y }) => {
        // Show popup for adding a positioned comment
        showPositionedCommentPopup(x, y);
      },
    });

    // Pin comment button handler
    if (pinCommentBtn) {
      pinCommentBtn.addEventListener('click', () => {
        const isActive = commentMarkers.toggleAddMode();
        syncPinButton(isActive);
        if (!isActive) hidePositionedCommentPopup();
      });
    }
  }

  // Presenter notes live in the strip under the slide (notes-strip.js,
  // appended below); the comment thread list folded into the comments pane
  // earlier (fase 4). The positioned markers on the slide (above) are the
  // remaining comments surface in this panel.

  previewScroll.append(previewStage);
  preview.append(previewScroll);

  // Presenter-notes strip, directly under the slide (Keynote / PowerPoint
  // convention). Fills the space beneath the 16:9 stage; collapsible so the
  // slide can reclaim the full height. See notes-strip.js.
  if (notesStripEl) preview.append(notesStripEl);

  const detachThumbScale = attachThumbScaleContain(thumb, {
    virtualWidth: 1600,
    virtualHeight: 900,
    containerEl: previewStage,
    padding: 0,
  });

  // Initial load of comment markers
  if (commentsApi) {
    refreshCommentMarkers();
  }

  return {
    previewEl: preview,
    thumbEl: thumb,
    // Mount points for the slide-scoped toolbar (filled by rerenderEditor).
    slideToolbar: { leftEl: slideToolbarLeft, actionsEl: slideToolbarActions },
    detachThumbScale,
    rerenderLightboxIfOpen: () => previewLightbox.rerenderIfOpen(),
    // Slide comments API (markers only; the thread list lives in the
    // inspector's comments pane)
    refreshSlideComments: () => {
      refreshCommentMarkers();
    },
    // Re-attach markers DOM after a preview rerender wipes thumb contents.
    // Cheap: does not refetch — just re-renders the existing comment list.
    reattachCommentMarkers: () => {
      commentMarkers?.reattach?.();
      commentMarkers?.refresh?.();
    },
    // True while placing a positioned comment. The inline WYSIWYG editor reads
    // this to yield its click capture so the pin lands anywhere on the slide,
    // not only in the non-editable margins.
    isCommentAddMode: () => Boolean(commentMarkers?.isInAddMode?.()),
  };
}
