import {
  bgClass,
  escapeHtml,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
} from '../helpers.js';
import { alignGroup, groupAlignClass } from '../field-groups.js';

/**
 * Title and subheading are one header block. The title shrinks to its text
 * inside a flex row (measured 225px wide, 624px left of the slide centre) while
 * the subheading spans the slide, so a per-field `text-align` on the title was
 * inert and the two never shared a centre. The plot area is not part of the
 * group.
 */
const HEADER_BLOCK = alignGroup('header-block', 'headerAlign', {
  label: 'Header alignment',
  labelKey: 'editor.slideField.headerAlign.label',
  schematicKind: 'chart',
});
import { getSlideCopy } from '../slide-copy.js';

import { parseChartData } from './chart-slide/parse.js';
import { themeChartPalette } from './chart-slide/palette.js';
import { truncateLabel } from './chart-slide/strings.js';
import { chartErrorHtml } from './chart-slide/error.js';
import { chartSummary } from './chart-slide/summary.js';
import { renderBarSvg } from './chart-slide/render-bar.js';
import { renderLineSvg } from './chart-slide/render-line.js';
import {
  renderPieSvg,
  pieEntriesFromDataset,
} from './chart-slide/render-pie.js';

export default {
  structure: 'dataset',
  // The payload already is rows (a CSV in `data`), so a table renders all of
  // it and only the encoding is lost. This is also why chart is not in the core
  // profile: the picture needs a charting library, the data does not.
  fallback: 'table-slide',
  runtime: 'static',
  fieldGroups: [HEADER_BLOCK.group],
  layoutVariants: HEADER_BLOCK.variants,
  label: 'Chart',
  // Field order is the form order (both surfaces render the generic loop).
  // The display toggles and axis/series labels only mean something on the
  // chart types that draw them, so each declares the types it belongs to
  // (`visibleWhen`, field-visibility.js) instead of a hand-built form
  // branching on chartType.
  fields: [
    {
      key: 'title',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: true,
      maxLength: 120,
      group: 'header-block',
    },
    {
      key: 'subheading',
      label: 'Subheading',
      labelKey: 'editor.slideField.subheading.label',
      type: 'string',
      required: false,
      maxLength: 220,
      group: 'header-block',
    },
    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      labelKey: 'editor.slideField.bottomSubheading.label',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'chartType',
      label: 'Chart type',
      type: 'enum',
      required: true,
      options: [
        { value: 'bar', label: 'Bar' },
        { value: 'line', label: 'Line' },
        { value: 'pie', label: 'Pie' },
      ],
    },
    {
      key: 'data',
      label: 'Data (CSV/TSV)',
      type: 'csv', // the csv-grid widget (field-editors.js) is this type's base editor
      required: true,
      maxLength: 20000,
      // The `dataset` contract tells a reader to decode this payload to rows
      // and lose "only the visual encoding" — which is honest only if the
      // encoding is named. These siblings describe it; the projection captions
      // the decoded table with their declared labels instead of dropping them
      // in as anonymous paragraphs. `visibleWhen` still applies, so a pie chart
      // names no axes.
      encodingKeys: ['chartType', 'xLabel', 'yLabel'],
    },
    // The per-type display toggles, two-up where a chart type has two (see
    // form-layout.js).
    {
      key: 'pieLabelMode',
      label: 'Pie labels',
      type: 'enum',
      required: false,
      // '%' is the glyph itself, identical in every locale: a bare string, so
      // no key is minted for it (shared/ui-i18n-keys.js).
      options: [
        { value: 'none', label: 'None' },
        { value: 'value', label: 'Value' },
        '%',
        { value: 'both', label: 'Both' },
      ],
      formLayout: 'pair',
      visibleWhen: { field: 'chartType', in: ['pie'] },
    },
    {
      key: 'showLegend',
      label: 'Legend',
      type: 'enum',
      required: false,
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
      formLayout: 'pair',
      visibleWhen: { field: 'chartType', in: ['pie', 'line'] },
    },
    {
      key: 'showValues',
      label: 'Show values',
      type: 'enum',
      required: false,
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
      formLayout: 'pair',
      visibleWhen: { field: 'chartType', in: ['bar'] },
    },
    {
      key: 'xLabel',
      label: 'X label',
      type: 'string',
      required: false,
      maxLength: 80,
      visibleWhen: { field: 'chartType', in: ['bar', 'line'] },
    },
    {
      key: 'yLabel',
      label: 'Y label',
      type: 'string',
      required: false,
      maxLength: 80,
      visibleWhen: { field: 'chartType', in: ['bar', 'line'] },
    },
    {
      key: 'series1Label',
      label: 'Series 1 label (legend)',
      type: 'string',
      required: false,
      maxLength: 80,
      visibleWhen: { field: 'chartType', in: ['line'] },
    },
    {
      key: 'series2Label',
      label: 'Series 2 label (legend)',
      type: 'string',
      required: false,
      maxLength: 80,
      visibleWhen: { field: 'chartType', in: ['line'] },
    },
    BACKGROUND_FIELD,
    // Last, because it has no primary home in the form: the toolbar "Layout"
    // chip owns the header block's alignment (see field-groups.js), so the raw
    // enum is a fallback surface, not the control.
    HEADER_BLOCK.field,
  ],
  defaultsByLang: {
    nl: {
      headerAlign: 'left',
      title: 'Nieuwe chart',
      subheading: '',
      bottomSubheading: '',
      chartType: 'bar',
      data: 'Label,Value\nA,10\nB,25\nC,15',
      xLabel: '',
      yLabel: '',
      series1Label: '',
      series2Label: '',
      showLegend: 'yes',
      showValues: 'no',
      pieLabelMode: '%',
      background: 'lime',
    },
    'en-GB': {
      headerAlign: 'left',
      title: 'New chart',
      subheading: '',
      bottomSubheading: '',
      chartType: 'bar',
      data: 'Label,Value\nA,10\nB,25\nC,15',
      xLabel: '',
      yLabel: '',
      series1Label: '',
      series2Label: '',
      showLegend: 'yes',
      showValues: 'no',
      pieLabelMode: '%',
      background: 'lime',
    },
  },
  // Back-compat fallback
  defaults: {
    headerAlign: 'left',
    title: 'New chart',
    subtitle: '',
    chartType: 'bar',
    data: 'Label,Value\nA,10\nB,25\nC,15',
    xLabel: '',
    yLabel: '',
    series1Label: '',
    series2Label: '',
    showLegend: 'yes',
    showValues: 'no',
    pieLabelMode: '%',
    background: 'lime',
  },
  renderHtml: (content, slide, ctx) => {
    const bg = bgClass(content?.background);
    const copy = getSlideCopy(ctx?.lang);
    const chartType = String(content?.chartType || 'bar');
    const parsed = parseChartData({
      chartType,
      data: content?.data || '',
    });
    const theme =
      ctx?.theme && typeof ctx.theme === 'object' ? ctx.theme : null;
    const palette = themeChartPalette(theme);

    const title = escapeHtml(content?.title);
    const bottomSubheading = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);

    const showValues = String(content?.showValues || 'no') === 'yes';
    const showLegendRaw = String(content?.showLegend || '').trim();
    const xAxisLabel = String(content?.xLabel || '').trim();
    const yAxisLabel = String(content?.yLabel || '').trim();

    const showLegend =
      showLegendRaw === 'yes'
        ? true
        : showLegendRaw === 'no'
          ? false
          : chartType === 'line'
            ? !!parsed?.dataset?.y2
            : chartType === 'pie';

    let svg = '';
    let legendHtml = '';
    if (!parsed.ok) {
      svg = chartErrorHtml(parsed.errors);
    } else if (parsed.kind === 'bar') {
      svg = renderBarSvg(parsed.dataset, {
        showValues,
        xAxisLabel,
        yAxisLabel,
      });
    } else if (parsed.kind === 'line') {
      const ds = parsed.dataset || {};
      // Override series labels if user provided explicit labels.
      const s1 = String(content?.series1Label || '').trim();
      const s2 = String(content?.series2Label || '').trim();
      const series1Name = s1 || ds.series1Label || 'Series 1';
      const series2Name = s2 || ds.series2Label || 'Series 2';
      const hasY2 = Array.isArray(ds?.y2) && ds.y2.some((v) => v != null);
      if (showLegend) {
        legendHtml = `
          <div class="chart-legend-block" aria-label="${escapeHtml(copy.chartLegendLabel)}">
            <div class="chart-legend-item">
              <span class="chart-legend-swatch chart-swatch-1" aria-hidden="true"></span>
              <span class="chart-legend-name" dir="auto">${escapeHtml(
                series1Name,
              )}</span>
            </div>
            ${
              hasY2
                ? `
              <div class="chart-legend-item">
                <span class="chart-legend-swatch chart-swatch-2" aria-hidden="true"></span>
                <span class="chart-legend-name" dir="auto">${escapeHtml(
                  series2Name,
                )}</span>
              </div>
            `
                : ''
            }
          </div>
        `;
      }
      svg = renderLineSvg(
        {
          ...ds,
          series1Label: series1Name,
          series2Label: series2Name,
        },
        { showLegend, showValues, xAxisLabel, yAxisLabel },
      );
    } else if (parsed.kind === 'pie') {
      const pieLabelModeRaw = String(content?.pieLabelMode || '').trim();
      // Back-compat: older slides may store "percent"
      const pieLabelModeNormalized =
        pieLabelModeRaw === 'percent' ? '%' : pieLabelModeRaw;
      // The "Pie labels" control drives this directly (its own "none" option is
      // the off switch), so it is not gated behind "Show values". Default to %.
      const pieLabelMode = ['none', 'value', '%', 'both'].includes(
        pieLabelModeNormalized,
      )
        ? pieLabelModeNormalized
        : '%';
      svg = renderPieSvg(parsed.dataset, {
        showLegend,
        pieLabelMode,
        palette,
      });
      if (showLegend) {
        const entries = pieEntriesFromDataset(parsed.dataset);
        // Mirror the in-slice labels in the legend (e.g. "50% planned…") so the
        // numbers read the same in both places.
        const legendStat = (e) => {
          const pct = Math.round((e.frac || 0) * 100);
          if (pieLabelMode === 'value') return String(e.v);
          if (pieLabelMode === 'both') return `${e.v} (${pct}%)`;
          if (pieLabelMode === '%') return `${pct}%`;
          return '';
        };
        const items = entries
          .map(
            (e, i) => `
              <div class="chart-legend-item">
                <span class="chart-legend-swatch chart-slice-${
                  i % 8
                }" aria-hidden="true"></span>
                ${
                  legendStat(e)
                    ? `<span class="chart-legend-stat">${escapeHtml(
                        legendStat(e),
                      )}</span>`
                    : ''
                }
                <span class="chart-legend-name" dir="auto">${escapeHtml(
                  truncateLabel(e.label, 40),
                )}</span>
              </div>
            `,
          )
          .join('');
        legendHtml = `
          <div class="chart-legend-block" aria-label="${escapeHtml(copy.chartLegendLabel)}">
            ${items}
          </div>
        `;
      }
    } else {
      svg = chartErrorHtml(['Onbekend chart type.']);
    }

    const desc = chartSummary(parsed) || '';
    const a11yTitle = title || 'Chart';

    // Note: we keep SVG inline for export safety.
    const alignClass = groupAlignClass(HEADER_BLOCK.group, content);
    return `
      <div class="slide slide-chart ${bg}${hasBottom ? ' has-bottom-subheading' : ''}${alignClass ? ` ${alignClass}` : ''}" data-chart-type="${escapeHtml(
        chartType,
      )}">
        <div class="slide-inner">
          <div class="chart-header">
            <div class="chart-title-row">
              <h2 class="chart-title" data-inline-field="title" dir="auto">${title}</h2>
            </div>
            ${renderSubheadingHtml(content)}
          </div>
          ${legendHtml}
          <div class="chart-area" data-inline-field="data" role="group" aria-label="${escapeHtml(a11yTitle)}">
            <div class="sr-only">
              <div>${escapeHtml(a11yTitle)}</div>
              ${desc ? `<div>${escapeHtml(desc)}</div>` : ''}
            </div>
            ${svg}
          </div>
          ${bottomSubheading}
        </div>
      </div>
    `;
  },
};
