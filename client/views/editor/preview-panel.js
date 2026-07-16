import { createPreviewLightbox } from './modals/preview-lightbox.js';
import { t } from '../../lib/ui-i18n.js';
import { createCommentMarkers } from './comment-markers.js';

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
  markDirty,
  nav,
  // Slide comments support
  commentsApi,
  user,
  // Positioned-marker click: opens the comments pane on this comment (the
  // under-slide thread list folded into the inspector rail, fase 4).
  onOpenComments,
  // Lightbox navigation
  onLightboxNavigate,
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
  // "Slide", not "Preview": with inline WYSIWYG this panel is the primary
  // editing surface, not a passive preview.
  previewHeader.append(
    h('h2', { text: t('editor.preview.title', 'Slide') })
  );

  const zoomIcon = h('img', {
    class: 'preview-zoom-icon',
    alt: '',
    src: iconUrl('search'),
  });
  const zoomBtn = h('button', {
    class: 'preview-icon-btn preview-zoom-btn',
    title: t('editor.preview.openLarge', 'Open larger preview'),
    onclick: () => openPreviewLightbox(),
  });
  zoomBtn.append(zoomIcon);

  // Pin comment button (only shown if commentsApi is available)
  let pinCommentBtn = null;
  let pinModeHint = null;
  if (commentsApi) {
    pinCommentBtn = h('button', {
      class: 'btn btn-secondary btn-sm pin-comment-btn',
      title: t('comments.addPositioned', 'Add comment to specific spot'),
    });
    pinCommentBtn.append(
      h('img', { class: 'btn-pin-icon', src: iconUrl('map-pin'), alt: '', 'aria-hidden': 'true' }),
      h('span', { class: 'pin-comment-btn-label', text: t('comments.pinCommentLabel', 'Comment') })
    );
    // Hint text that appears when pin mode is active
    pinModeHint = h('span', {
      class: 'pin-mode-hint',
      text: t('comments.pinModeHint', 'Click on the preview to place comment'),
    });
    pinModeHint.style.display = 'none';
  }

  const headerActions = h('div', { class: 'row preview-panel-actions' });
  if (pinCommentBtn) headerActions.append(pinCommentBtn);
  if (pinModeHint) headerActions.append(pinModeHint);
  headerActions.append(zoomBtn);
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
      pinModeHint.style.display = 'none';
    }
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
        pinCommentBtn?.classList?.remove('is-active');
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
          pinCommentBtn?.classList?.remove('is-active');
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
        pinCommentBtn.classList.toggle('is-active', isActive);
        if (pinModeHint) {
          pinModeHint.style.display = isActive ? '' : 'none';
        }
        if (isActive) {
          pinCommentBtn.title = t('comments.cancelPosition', 'Cancel');
        } else {
          pinCommentBtn.title = t('comments.addPositioned', 'Add comment to specific spot');
          hidePositionedCommentPopup();
        }
      });
    }
  }

  const previewNotes = h('div', { class: 'preview-notes stack' });
  const previewNotesHeader = h('div', {
    class: 'field-label',
    text: t('editor.notes.title', 'Presenter notes'),
  });
  const previewNotesHelp = h('div', {
    class: 'help',
    text: t('editor.notes.savedPerSlide', 'Saved per slide.'),
  });
  const previewNotesTa = h('textarea', {
    class: 'form-input preview-notes-input',
    // Collab presence: focus in the notes is reported/decorated under the
    // 'notes' field path (see presence/presence-ui.js). Inert without collab.
    'data-collab-field-key': 'notes',
    placeholder:
      t(
        'editor.notes.placeholder',
        "Text you write here shows on your phone. Click 'Notes (QR)' to show a QR code for your phone."
      ),
  });
  previewNotesTa.addEventListener('input', () => {
    const sid = getSelectedSlideId?.();
    const slide = (pres?.slides || []).find((s) => s?.id === sid);
    if (!slide) return;
    slide.notes = previewNotesTa.value;
    markDirty?.();
  });
  previewNotes.append(previewNotesHeader, previewNotesHelp, previewNotesTa);

  // The always-open slide comments section that used to sit here folded
  // into the inspector's comments pane (fase 4); the positioned markers on
  // the slide (above) are the remaining comments surface in this panel.

  const previewNotesWrap = h('div', { class: 'preview-notes-wrap' });
  previewNotesWrap.append(previewNotes);

  previewScroll.append(previewStage);
  previewScroll.append(previewNotesWrap);
  preview.append(previewScroll);

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
    previewNotesTa,
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
  };
}
