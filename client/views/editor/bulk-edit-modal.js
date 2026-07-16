/**
 * Bulk-edit modal ("Edit all text") - phase 2 of the editor-UI track.
 *
 * A roomy two-pane overlay: every content field of the current slide on the
 * left (the EXISTING form renderers via createRerenderEditor's contentOnly
 * mode - so items add/remove/reorder, markdown editors and validation are
 * inherited, never reimplemented), a live slide preview on the right.
 * Prev/next navigate the deck without leaving the modal; navigation goes
 * through the caller's setSelectedSlideId seam so slide locks, presence and
 * URL sync all lift along.
 */

import { createModal } from '../../lib/modal.js';
import { mountSlideInto } from '../../lib/slide-render.js';
import { attachThumbScaleContain } from '../../lib/thumb-scale.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * @param {Object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Object} opts.pres - the presentation model (live reference)
 * @param {Function} opts.getSelectedSlideId
 * @param {Function} opts.setSelectedSlideId - the lock-aware selection seam
 * @param {Function} opts.createFormRenderer - (formMount, refreshPreview) =>
 *   rerender function; the controller builds this from createRerenderEditor
 *   with `contentOnly: true` so the modal reuses the exact form machinery.
 * @param {Function} [opts.getTheme] - () => current theme (for the preview)
 * @param {Function} [opts.onClosed] - called after close (resync main form)
 * @param {Set} [opts.openOverlayClosers]
 * @returns {{ open: Function }}
 */
export function createBulkEditModal({
  h,
  pres,
  getSelectedSlideId,
  setSelectedSlideId,
  createFormRenderer,
  getTheme,
  onClosed,
  openOverlayClosers,
} = {}) {
  function open() {
    let detachScale = null;
    const modal = createModal(h, {
      title: t('editor.bulkEdit.title', 'Edit all text'),
      modalClass: 'bulk-edit-modal',
      onClose: () => {
        detachScale?.();
        onClosed?.();
      },
    });

    // ---- Layout: form pane (left) + live preview pane (right) ----
    const formMount = h('div', { class: 'bulk-edit-form' });
    const previewStage = h('div', { class: 'bulk-edit-preview' });
    const previewThumb = h('div', { class: 'thumb bulk-edit-thumb' });
    previewStage.append(previewThumb);
    const body = h('div', { class: 'bulk-edit-body' });
    body.append(formMount, previewStage);
    modal.append(
      h('div', {
        class: 'help bulk-edit-hint',
        text: t(
          'editor.bulkEdit.hint',
          'The slide updates live while you type. Layout, background and accessibility stay in the side panel.'
        ),
      }),
      body
    );

    // ---- Prev/next nav in the modal header ----
    const prevBtn = h('button', {
      type: 'button',
      class: 'btn btn-secondary btn-sm',
      text: '‹',
      title: t('editor.bulkEdit.prev', 'Previous slide'),
      onclick: () => navigate(-1),
    });
    const nextBtn = h('button', {
      type: 'button',
      class: 'btn btn-secondary btn-sm',
      text: '›',
      title: t('editor.bulkEdit.next', 'Next slide'),
      onclick: () => navigate(1),
    });
    const counter = h('span', { class: 'bulk-edit-counter help' });
    const nav = h('div', { class: 'row bulk-edit-nav' });
    nav.append(prevBtn, counter, nextBtn);
    modal.header.insertBefore(nav, modal.closeBtn);

    // ---- Live preview ----
    let previewRaf = 0;
    const refreshPreview = () => {
      if (previewRaf) return;
      previewRaf = requestAnimationFrame(() => {
        previewRaf = 0;
        const slide = pres.slides.find((s) => s.id === getSelectedSlideId?.());
        if (!slide) return;
        mountSlideInto(previewThumb, slide, {
          theme: getTheme?.(),
          presentationId: pres?.id,
        });
      });
    };

    // The form renderer is a full createRerenderEditor instance in
    // contentOnly mode, mounted on the modal's own container.
    const rerenderForm = createFormRenderer(formMount, refreshPreview);

    const currentIndex = () =>
      pres.slides.findIndex((s) => s.id === getSelectedSlideId?.());

    const refresh = () => {
      const idx = currentIndex();
      if (idx < 0) {
        modal.close();
        return;
      }
      counter.textContent = t('editor.bulkEdit.counter', 'Slide {n} of {total}', {
        n: String(idx + 1),
        total: String(pres.slides.length),
      });
      prevBtn.disabled = idx <= 0;
      nextBtn.disabled = idx >= pres.slides.length - 1;
      rerenderForm();
      refreshPreview();
    };

    function navigate(delta) {
      const idx = currentIndex();
      const next = pres.slides[idx + delta];
      if (!next) return;
      // Through the lock-aware seam: main editor, presence, URL follow along.
      setSelectedSlideId?.(next.id);
      refresh();
    }

    modal.show(document.body, openOverlayClosers);
    detachScale = attachThumbScaleContain(previewThumb, {
      containerEl: previewStage,
      padding: 16,
    });
    refresh();
  }

  return { open };
}
