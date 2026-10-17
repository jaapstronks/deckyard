import { createPreviewLightbox } from './modals/preview-lightbox.js';
import { t } from '../../lib/ui-i18n.js';
import {
  createAnchoredComposer,
  createCommentMarkers,
} from '../comments/index.js';
import { icon } from '../../lib/dom/icons.js';
import { h } from '../../lib/dom/index.js';

export function createPreviewPanel({
  root,
  pres,
  theme,
  lockDocumentScroll,
  attachThumbScale,
  attachThumbScaleContain,
  renderSlideElement,
  getSelectedSlideId,
  // Slide comments support
  commentsApi,
  // The comments pane's posting and mention lookup, read at open time (the
  // pane is built after this panel): the card on a spot posts like the pane.
  getAnchoredComposerSupport,
  // Positioned-marker click: opens the comments pane on this comment (the
  // under-slide thread list folded into the inspector rail, fase 4).
  onOpenComments,
  // Lightbox navigation
  onLightboxNavigate,
  // Presenter-notes strip, mounted under the slide (see notes-strip.js).
  notesStripEl,
  // Canvas | Fields tabs (canvas-tabs.js), placed in the slide bar.
  canvasTabsEl,
} = {}) {
  const preview = h('div', { class: 'panel preview-panel' });

  const previewLightbox = createPreviewLightbox({
    root,
    pres,
    theme,
    lockDocumentScroll,
    attachThumbScale,
    attachThumbScaleContain,
    renderSlideElement,
    getSelectedSlideId,
    // Pass comments support to lightbox
    commentsApi,
    getAnchoredComposerSupport,
    onCommentAdded: () => {
      refreshCommentMarkers();
    },
    onNavigate: onLightboxNavigate,
  });
  const openPreviewLightbox = () => previewLightbox.open();

  // Slide bar: the head of the canvas column, scoped to the CURRENT slide. It
  // holds only the type pill (with its menu) and the Canvas | Fields tabs
  // (B703 PR 3); the canvas tools float on the canvas itself, the slide
  // actions live in the slide list. The Inspector | Comments tabs head their
  // own column (`.rail-head`, D335), not this bar. The editor form renders
  // the pill into the mount below on every rerender. The controller places
  // this bar into the layout grid (it is NOT appended to the preview panel).
  const slideBar = h('div', { class: 'slide-bar' });
  const slideToolbarLeft = h('div', { class: 'row slide-toolbar-left' });

  const zoomBtn = h('button', {
    class: 'ghost-icon-btn preview-zoom-btn',
    title: t('editor.preview.openLarge', 'Open larger preview'),
    'aria-label': t('editor.preview.openLarge', 'Open larger preview'),
    onclick: () => openPreviewLightbox(),
  });
  zoomBtn.append(icon('zoom-in', { size: 16 }));

  // Mark-a-spot button (only shown if commentsApi is available). Labeled, not
  // icon-only: placing a comment was too well hidden as a bare pin glyph; it
  // still collapses to the glyph on narrow widths, so it carries an
  // aria-label too. When active it flips to a Cancel affordance. The mode hint
  // renders as an overlay banner on the slide stage (see pinModeHint below).
  // From the keyboard (a click with no pointer), Enter places the pin in the
  // middle of the slide and opens the card at once; Escape leaves the mode.
  let pinCommentBtn = null;
  let pinCommentLabel = null;
  let pinModeHint = null;
  if (commentsApi) {
    pinCommentBtn = h('button', {
      class: 'btn btn-secondary pin-comment-btn',
      type: 'button',
      title: t('comments.addPositioned', 'Add comment to specific spot'),
      'aria-label': t('comments.addLabel', 'Mark a spot'),
    });
    pinCommentLabel = h('span', {
      class: 'pin-comment-label',
      text: t('comments.addLabel', 'Mark a spot'),
    });
    pinCommentBtn.append(
      icon('map-pin', { size: 15, className: 'btn-pin-icon' }),
      pinCommentLabel,
    );
    // Mode hint: rendered as an overlay on the stage (appended to previewStage
    // further down), toggled with add-mode. Kept out of the flex toolbar row.
    pinModeHint = h('span', {
      class: 'pin-mode-hint',
      text: t('comments.pinModeHint', 'Click on the slide to place comment'),
    });
    pinModeHint.hidden = true;
  }

  slideBar.append(slideToolbarLeft, ...(canvasTabsEl ? [canvasTabsEl] : []));

  // Canvas tools (Add comment, zoom), floating at the top right of the canvas
  // they act on (B703 PR 3). On the stage, so the Fields view hides them with
  // the canvas.
  const canvasTools = h('div', { class: 'row canvas-float-tools' });
  if (pinCommentBtn) canvasTools.append(pinCommentBtn);
  canvasTools.append(zoomBtn);

  const previewScroll = h('div', {
    class: 'preview-panel-body',
  });
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
  previewStage.append(thumb, canvasTools);
  // Add-comment mode hint: an overlay banner on the stage (pointer-through so
  // it never blocks the placement click). Lives here, not in the toolbar row.
  if (pinModeHint) previewStage.append(pinModeHint);

  // Comment markers on the slide preview - setup functions first
  let commentMarkers = null;
  let positionedCommentPopup = null;

  function hidePositionedCommentPopup() {
    positionedCommentPopup?.detach();
    positionedCommentPopup = null;
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
    const label = isActive
      ? t('comments.cancelPosition', 'Cancel')
      : t('comments.addLabel', 'Mark a spot');
    pinCommentBtn.setAttribute('aria-label', label);
    if (pinCommentLabel) pinCommentLabel.textContent = label;
    if (pinModeHint) pinModeHint.hidden = !isActive;
  }

  // Every way out of add mode (the button, Cancel, Escape, a post) lands here.
  function leaveAddMode() {
    hidePositionedCommentPopup();
    commentMarkers?.exitAddMode?.();
    syncPinButton(false);
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
    if (pinModeHint) pinModeHint.hidden = true;
    const support = getAnchoredComposerSupport?.();
    positionedCommentPopup = createAnchoredComposer({
      // In previewStage (not thumb) to avoid overflow clipping.
      stageEl: previewStage,
      thumbEl: thumb,
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
        // Refresh to show the new marker
        refreshCommentMarkers();
      },
      onCancel: () => leaveAddMode(),
    });
  }

  /**
   * Enter add mode, from the toolbar or from the pane's empty state. From
   * the keyboard the pin goes in the middle of the slide and the card opens
   * at once: there is no pointer to place it with.
   * @param {{ keyboard?: boolean }} [opts]
   */
  function startPinMode({ keyboard = false } = {}) {
    if (!commentMarkers) return;
    if (!commentMarkers.isInAddMode()) commentMarkers.enterAddMode();
    syncPinButton(true);
    if (keyboard) showPositionedCommentPopup(50, 50);
  }

  if (commentsApi) {
    commentMarkers = createCommentMarkers({
      containerEl: thumb,
      onMarkerClick: (comment) => {
        // Open the comments pane in the inspector rail on this comment.
        onOpenComments?.(comment.id);
      },
      onPositionSelect: ({ x, y }) => {
        // Show popup for adding a positioned comment
        showPositionedCommentPopup(x, y);
      },
      onCancelAddMode: () => leaveAddMode(),
    });

    // Pin comment button handler. `detail` is 0 for a click the keyboard
    // made (Enter or Space on the focused button).
    if (pinCommentBtn) {
      pinCommentBtn.addEventListener('click', (e) => {
        if (commentMarkers.isInAddMode()) leaveAddMode();
        else startPinMode({ keyboard: e.detail === 0 });
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
    // The slide bar; the controller mounts it in the layout grid above the
    // canvas column.
    slideBarEl: slideBar,
    // Mount point for the slide-scoped toolbar (filled by rerenderEditor).
    slideToolbar: { leftEl: slideToolbarLeft },
    detachThumbScale,
    rerenderLightboxIfOpen: () => previewLightbox.rerenderIfOpen(),
    // Slide comments API (markers only; the thread list lives in the
    // inspector's comments pane)
    refreshSlideComments: () => refreshCommentMarkers(),
    // Re-attach markers DOM after a preview rerender wipes thumb contents.
    // Cheap: does not refetch — just re-renders the existing comment list.
    reattachCommentMarkers: () => {
      commentMarkers?.reattach?.();
      commentMarkers?.refresh?.();
    },
    // The pane's empty state starts placing a pin from here.
    startPinMode,
    /**
     * "Show on slide" from the list: point at the pin (the slide is already
     * the selected one). False when it is not on the canvas.
     * @param {string} commentId
     */
    showCommentMarker: (commentId) => Boolean(commentMarkers?.flash(commentId)),
    // True while placing a positioned comment. The inline WYSIWYG editor reads
    // this to yield its click capture so the pin lands anywhere on the slide,
    // not only in the non-editable margins.
    isCommentAddMode: () => Boolean(commentMarkers?.isInAddMode?.()),
  };
}
