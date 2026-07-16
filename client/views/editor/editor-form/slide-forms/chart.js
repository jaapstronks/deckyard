import { t } from '../../../../lib/ui-i18n.js';

export function renderChartSlideForm({
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
  add('title');
  add('subheading');
  add('bottomSubheading');
  add('chartType');

  // Custom data editor: textarea + import button + chart-type specific help.
  used.add('data');
  const dataWrap = h('div', { class: 'stack' });
  dataWrap.append(
    h('div', {
      class: 'field-label',
      text: t('editor.chart.dataLabel', 'Data (CSV/TSV)'),
    })
  );

  const btnRow = h('div', {
    class: 'row is-wrap',
  });
  const fileInput = h('input', {
    type: 'file',
    accept: '.csv,text/csv',
    hidden: true,
  });
  const btnImport = h('button', {
    class: 'btn btn-secondary',
    text: t('editor.chart.importCsv', 'Import CSV'),
    onclick: () => fileInput.click(),
  });
  const btnExample = h('button', {
    class: 'btn btn-secondary',
    text: t('editor.chart.example', 'Example'),
    onclick: () => {
      const ct = String(slide.content?.chartType || 'bar');
      slide.content.data =
        ct === 'line'
          ? 'X,Serie 1,Serie 2\nJan,12,8\nFeb,18,11\nMar,15,9'
          : ct === 'pie'
          ? 'Label,Value\nA,10\nB,25\nC,15'
          : 'Label,Value\nA,10\nB,25\nC,15';
      markDirty?.();
      rerenderEditor?.();
      scheduleUiRefresh?.();
    },
  });
  btnRow.append(btnImport, btnExample, fileInput);
  dataWrap.append(btnRow);

  const ta = h('textarea', {
    class: 'form-input form-textarea-lg',
  });
  ta.value = slide.content?.data || '';
  ta.addEventListener('input', () => {
    slide.content.data = ta.value;
    markDirty?.();
    scheduleUiRefresh?.();
  });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      slide.content.data = text;
      markDirty?.();
      rerenderEditor?.();
      scheduleUiRefresh?.();
    } catch {
      // ignore
    } finally {
      // allow re-selecting same file
      fileInput.value = '';
    }
  });

  const ct = String(slide.content?.chartType || 'bar');
  const help =
    ct === 'line'
      ? t(
          'editor.chart.help.line',
          'Paste TSV (from Sheets/Excel) or CSV.\nLine format: X, Series 1, optional Series 2.\nUse the header row to set series names, or fill “Series 1 label (legend)” / “Series 2 label (legend)”.\nExample:\nX,Revenue,Cost\nJan,12,8\nFeb,18,11'
        )
      : t(
          'editor.chart.help.barPie',
          'Paste TSV (from Sheets/Excel) or CSV.\nBar/Pie format: Label, Value.\nExample:\nLabel,Value\nA,10\nB,25\nC,15'
        );
  dataWrap.append(ta, h('div', { class: 'help', text: help }));
  form.append(dataWrap);

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

  // Axis and series labels only apply to bar and line charts.
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
