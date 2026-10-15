import { createModal } from '../../lib/dom/modal.js';
import { createCsvGridEditor } from './fields/csv-grid.js';
import { mountSlideInto } from '../../lib/slide-runtime/slide-render.js';
import { attachThumbScaleContain } from '../../lib/slide-runtime/thumb-scale.js';
import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom/index.js';

/**
 * Chart-data editor as its own roomy surface (editing-surfaces §4.3): a wide
 * modal with the spreadsheet grid on the left and a live chart preview on the
 * right (stacked on narrow screens). Chart data *is* the data — the render is
 * a consequence — so the grid gets room to grow here instead of in a form.
 *
 * Live, like every other edit (D338): each change to the grid is written to
 * the slide at once, so the canvas behind the modal follows as you type. There
 * is no Cancel/Save; one **Done** button (or Escape, or Ctrl/⌘+Enter) closes
 * the modal. Undo is the safety net: the whole session is one undo step,
 * through the host's `undoGroup` (begin on open, end on close).
 *
 * The one route to chart data: the inspector's "Edit data…" button, a click
 * on the chart on the canvas and the data summary in a full form all open
 * this modal.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.root - Mount root for the modal (usually document.body)
 * @param {Object} opts.slide - The slide whose data is edited
 * @param {string} [opts.fieldKey='data'] - The csv field on that slide
 * @param {Object} [opts.theme] - Active theme, for a faithful preview
 * @param {string} [opts.presentationId]
 * @param {Object} [opts.renderVia] - How the preview resolves assets; the
 *   deck by default, `RENDER_VIA_THEME` where there is no deck (library)
 * @param {string|null} [opts.lang] - Deck language, so the preview's legend label
 *   matches what the canvas shows
 * @param {Function} opts.markDirty - Called after each write to the slide
 * @param {Function} [opts.rerenderPreview] - Repaint the canvas after a write
 * @param {{ begin: Function, end: Function }} [opts.undoGroup] - Makes the
 *   session one undo step; without it the host's own grouping applies
 * @param {Function} [opts.onClosed] - After the modal closed (refresh a form)
 */
export function openChartDataModal({
  root,
  slide,
  fieldKey = 'data',
  theme,
  presentationId,
  renderVia = { kind: 'deck', id: presentationId },
  lang = null,
  markDirty,
  rerenderPreview,
  undoGroup,
  onClosed,
} = {}) {
  if (!slide?.content) return;

  const chartType = String(slide.content.chartType || 'bar');

  // --- Live preview (right / top) -----------------------------------------
  const previewThumb = h('div', { class: 'thumb chart-data-preview-thumb' });
  const previewStage = h('div', { class: 'chart-data-preview-stage' }, [
    previewThumb,
  ]);
  const previewWrap = h('div', { class: 'chart-data-preview' }, [
    h('div', {
      class: 'field-label chart-data-preview-label',
      text: t('editor.chart.preview', 'Preview'),
    }),
    previewStage,
  ]);

  const renderModalPreview = () => {
    mountSlideInto(previewThumb, slide, {
      mode: 'thumb',
      theme,
      presentationId,
      renderVia,
      lang,
    });
  };

  // --- Grid (left / bottom) ------------------------------------------------
  const { el: gridEl } = createCsvGridEditor({
    chartType,
    value: String(slide.content[fieldKey] ?? ''),
    label: '',
    onChange: (csv) => {
      if (slide.content[fieldKey] === csv) return;
      slide.content[fieldKey] = csv;
      markDirty?.();
      rerenderPreview?.();
      renderModalPreview();
    },
  });
  const gridWrap = h('div', { class: 'chart-data-grid' }, [gridEl]);

  const body = h('div', { class: 'chart-data-modal-body' }, [
    gridWrap,
    previewWrap,
  ]);

  let detachScale = null;
  const modal = createModal({
    title: t('editor.chart.editDataTitle', 'Chart data'),
    modalClass: 'chart-data-modal',
    fill: true,
    onClose: () => {
      detachScale?.();
      detachScale = null;
      undoGroup?.end();
      onClosed?.();
    },
  });

  const footer = h('div', { class: 'row spread chart-data-modal-footer' }, [
    h('span', {
      class: 'help',
      text: t(
        'editor.chart.liveHint',
        'Changes apply as you type. Undo reverts the whole session.',
      ),
    }),
    h('button', {
      class: 'btn btn-primary',
      type: 'button',
      text: t('common.done', 'Done'),
      onclick: () => modal.close(),
    }),
  ]);

  modal.append(body, footer);

  // Ctrl/Cmd+Enter closes from anywhere in the modal, like Done.
  modal.modal.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      modal.close();
    }
  });

  undoGroup?.begin();
  modal.show(root);
  detachScale = attachThumbScaleContain(previewThumb, {
    containerEl: previewStage,
    padding: 12,
    virtualWidth: 1600,
    virtualHeight: 900,
  });
  renderModalPreview();

  // Land focus in the first grid cell so editing starts immediately.
  body.querySelector('.csv-grid-host input, .csv-grid-raw')?.focus();

  return modal;
}
