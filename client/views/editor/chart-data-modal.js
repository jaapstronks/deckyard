import { createModal } from '../../lib/dom/modal.js';
import { createCsvGridEditor } from './fields/csv-grid.js';
import { mountSlideInto } from '../../lib/slide-runtime/slide-render.js';
import { attachThumbScaleContain } from '../../lib/slide-runtime/thumb-scale.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * Chart-data editor as its own roomy surface (editing-surfaces §4.3): a wide
 * modal with the spreadsheet grid on the left and a live chart preview on the
 * right (stacked on narrow screens). Unlike a visual whose data is manipulated
 * for effect, chart data *is* the data — the render is a consequence — so a
 * blocking modal is the right trade: it gives the grid room to grow (the bottom
 * panel could not), and the side preview still shows the result as you type
 * (Jaap, 2026-07-21). Buffered: edits apply to the slide only on Save.
 *
 * The entry points are the inspector's "Edit data…" button and a click on the
 * chart on the canvas — both route here (one data surface).
 *
 * @param {Object} opts
 * @param {Function} opts.h - DOM helper
 * @param {HTMLElement} opts.root - Mount root for the modal (usually document.body)
 * @param {Object} opts.slide - The chart slide being edited
 * @param {Object} [opts.theme] - Active theme, for a faithful preview
 * @param {string} [opts.presentationId]
 * @param {Function} opts.markDirty
 * @param {Function} [opts.requestSave]
 * @param {Function} [opts.rerenderEditor]
 * @param {Function} [opts.rerenderPreview]
 * @param {Set} [opts.overlayClosers] - Shared overlay-closer set for cleanup
 */
export function openChartDataModal({
  h,
  root,
  slide,
  theme,
  presentationId,
  markDirty,
  requestSave,
  rerenderEditor,
  rerenderPreview,
  overlayClosers,
} = {}) {
  if (!slide || slide.type !== 'chart-slide') return;

  const raw = String(slide.content?.data ?? '');
  const chartType = String(slide.content?.chartType || 'bar');
  let latest = raw;

  // --- Live preview (right / top) -----------------------------------------
  const previewThumb = h('div', { class: 'thumb chart-data-preview-thumb' });
  const previewStage = h('div', { class: 'chart-data-preview-stage' }, [previewThumb]);
  const previewWrap = h('div', { class: 'chart-data-preview' }, [
    h('div', {
      class: 'field-label chart-data-preview-label',
      text: t('editor.chart.preview', 'Preview'),
    }),
    previewStage,
  ]);

  const renderPreview = () => {
    // Render the real slide with the buffered data so the preview is faithful
    // (title + chart, exactly as the slide will look).
    const tempSlide = { ...slide, content: { ...slide.content, data: latest } };
    mountSlideInto(previewThumb, tempSlide, { mode: 'thumb', theme, presentationId });
  };

  // --- Grid (left / bottom) ------------------------------------------------
  const { el: gridEl } = createCsvGridEditor({
    h,
    chartType,
    value: raw,
    label: '',
    onChange: (v) => {
      latest = v;
      renderPreview();
    },
  });
  const gridWrap = h('div', { class: 'chart-data-grid' }, [gridEl]);

  const body = h('div', { class: 'chart-data-modal-body' }, [gridWrap, previewWrap]);

  let detachScale = null;
  const modal = createModal(h, {
    title: t('editor.chart.editDataTitle', 'Chart data'),
    modalClass: 'chart-data-modal',
    isDirty: () => latest !== raw,
    confirmMessage: t(
      'editor.chart.discardConfirm',
      'Discard your changes to the chart data?'
    ),
    onClose: () => {
      detachScale?.();
      detachScale = null;
    },
  });

  const save = () => {
    if (latest !== raw) {
      slide.content.data = latest;
      markDirty?.();
      requestSave?.();
      rerenderEditor?.();
      rerenderPreview?.();
    }
    modal.close();
  };

  const footer = h('div', { class: 'row spread chart-data-modal-footer' }, [
    h('span', {
      class: 'help',
      text: t('editor.inline.markdownHint', 'Ctrl/⌘ + Enter to save'),
    }),
    h('div', { class: 'row' }, [
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: t('common.cancel', 'Cancel'),
        onclick: () => modal.requestClose(),
      }),
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: t('common.save', 'Save'),
        onclick: save,
      }),
    ]),
  ]);

  modal.append(body, footer);

  // Ctrl/Cmd+Enter commits from anywhere in the modal.
  modal.modal.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });

  modal.show(root, overlayClosers);
  detachScale = attachThumbScaleContain(previewThumb, {
    containerEl: previewStage,
    padding: 12,
    virtualWidth: 1600,
    virtualHeight: 900,
  });
  renderPreview();

  // Land focus in the first grid cell so editing starts immediately.
  body.querySelector('.csv-grid-host input, .csv-grid-raw')?.focus();

  return modal;
}
