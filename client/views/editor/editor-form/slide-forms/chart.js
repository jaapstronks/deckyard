import { t } from '../../../../lib/ui-i18n.js';
import { createCsvGridEditor } from '../../fields/csv-grid.js';

/**
 * Chart configuration controls: type, the data editor (CSV/TSV textarea with
 * import + example) and the per-type display toggles. Shared between the full
 * content form below and the phase-3 inspector (which renders ONLY this
 * config; the text and axis-label fields live in the bulk modal).
 */
export function renderChartConfigControls({
  h,
  form,
  slide,
  add,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  add('chartType');

  // Data editor: a spreadsheet-style grid with a raw-CSV toggle, shared with the
  // inline-edit modal (client/views/editor/fields/csv-grid.js) so both paths use
  // one implementation. Serialises to the CSV string the chart parser eats.
  used.add('data');
  const ct = String(slide.content?.chartType || 'bar');
  const dataEditor = createCsvGridEditor({
    h,
    chartType: ct,
    value: slide.content?.data || '',
    label: t('editor.chart.dataLabel', 'Data (CSV/TSV)'),
    onChange: (csv) => {
      slide.content.data = csv;
      markDirty?.();
      scheduleUiRefresh?.();
    },
  });
  form.append(dataEditor.el);

  const showValuesField = fieldByKey.get('showValues');
  const showLegendField = fieldByKey.get('showLegend');
  const pieLabelModeField = fieldByKey.get('pieLabelMode');

  // These fields are shown conditionally per chart type. Mark them all as used
  // up front so the generic fallback loop never appends the ones we skip (e.g.
  // axis/series labels on a pie chart, where they do nothing).
  for (const key of [
    'background',
    'showValues',
    'showLegend',
    'pieLabelMode',
    'xLabel',
    'yLabel',
    'series1Label',
    'series2Label',
  ]) {
    used.add(key);
  }

  // Background colour renders in the unified Background section (editor-form.js).

  // Chart-specific display toggles, two-up so each control has room to breathe.
  const toggles = [];
  if (ct === 'pie') {
    if (pieLabelModeField) toggles.push(renderField(pieLabelModeField));
    if (showLegendField) toggles.push(renderField(showLegendField));
  } else if (ct === 'line') {
    if (showLegendField) toggles.push(renderField(showLegendField));
  } else if (ct === 'bar') {
    if (showValuesField) toggles.push(renderField(showValuesField));
  }
  const toggleRow = fieldGrid(toggles.filter(Boolean), 2);
  if (toggleRow) form.append(toggleRow);
}

export function renderChartSlideForm(ctx = {}) {
  const { add, slide } = ctx;
  add('title');
  add('subheading');
  add('bottomSubheading');

  renderChartConfigControls(ctx);

  // Axis and series labels only apply to bar and line charts.
  const ct = String(slide?.content?.chartType || 'bar');
  if (ct === 'line') {
    add('xLabel');
    add('yLabel');
    add('series1Label');
    add('series2Label');
  } else if (ct === 'bar') {
    add('xLabel');
    add('yLabel');
  }
}
