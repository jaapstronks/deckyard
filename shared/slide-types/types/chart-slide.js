import {
  bgClass,
  esc,
  getSubheadingText,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
} from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';

import { parseChartData } from '../chart/parse.js';
import { themeChartPalette } from '../chart/palette.js';
import { truncateLabel } from '../chart/strings.js';
import { chartErrorHtml } from '../chart/error.js';
import { chartSummary } from '../chart/summary.js';
import { renderBarSvg } from '../chart/render-bar.js';
import { renderLineSvg } from '../chart/render-line.js';
import {
  renderPieSvg,
  pieEntriesFromDataset,
} from '../chart/render-pie.js';

export default {
  label: 'Chart',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 220,
    },
    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'chartType',
      label: 'Chart type',
      type: 'enum',
      required: true,
      options: ['bar', 'line', 'pie'],
    },
    {
      key: 'data',
      label: 'Data (CSV/TSV)',
      type: 'markdown', // rendered as textarea in editor; validation treats as string
      required: true,
      maxLength: 20000,
    },
    {
      key: 'xLabel',
      label: 'X label',
      type: 'string',
      required: false,
      maxLength: 80,
    },
    {
      key: 'yLabel',
      label: 'Y label',
      type: 'string',
      required: false,
      maxLength: 80,
    },
    {
      key: 'series1Label',
      label: 'Series 1 label (legend)',
      type: 'string',
      required: false,
      maxLength: 80,
    },
    {
      key: 'series2Label',
      label: 'Series 2 label (legend)',
      type: 'string',
      required: false,
      maxLength: 80,
    },
    {
      key: 'showLegend',
      label: 'Legend',
      type: 'enum',
      required: false,
      options: ['yes', 'no'],
    },
    {
      key: 'showValues',
      label: 'Show values',
      type: 'enum',
      required: false,
      options: ['yes', 'no'],
    },
    {
      key: 'pieLabelMode',
      label: 'Pie labels',
      type: 'enum',
      required: false,
      options: ['none', 'value', '%', 'both'],
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
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
    const lang = ctx?.lang || 'nl';
    const copy = getSlideCopy(lang);
    const chartType = String(content?.chartType || 'bar');
    const parsed = parseChartData({
      chartType,
      data: content?.data || '',
    });
    const theme =
      ctx?.theme && typeof ctx.theme === 'object' ? ctx.theme : null;
    const palette = themeChartPalette(theme);

    const title = esc(content?.title);
    const subheading = getSubheadingText(content);
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
      const hasY2 =
        Array.isArray(ds?.y2) && ds.y2.some((v) => v != null);
      if (showLegend) {
        legendHtml = `
          <div class="chart-legend-block" aria-label="${esc(copy.chartLegendLabel)}">
            <div class="chart-legend-item">
              <span class="chart-legend-swatch chart-swatch-1" aria-hidden="true"></span>
              <span class="chart-legend-name" dir="auto">${esc(
                series1Name
              )}</span>
            </div>
            ${
              hasY2
                ? `
              <div class="chart-legend-item">
                <span class="chart-legend-swatch chart-swatch-2" aria-hidden="true"></span>
                <span class="chart-legend-name" dir="auto">${esc(
                  series2Name
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
        { showLegend, showValues, xAxisLabel, yAxisLabel }
      );
    } else if (parsed.kind === 'pie') {
      const pieLabelModeRaw = String(content?.pieLabelMode || '').trim();
      // Back-compat: older slides may store "percent"
      const pieLabelModeNormalized =
        pieLabelModeRaw === 'percent' ? '%' : pieLabelModeRaw;
      // The "Pie labels" control drives this directly (its own "none" option is
      // the off switch), so it is not gated behind "Show values". Default to %.
      const pieLabelMode = ['none', 'value', '%', 'both'].includes(
        pieLabelModeNormalized
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
                    ? `<span class="chart-legend-stat">${esc(
                        legendStat(e)
                      )}</span>`
                    : ''
                }
                <span class="chart-legend-name" dir="auto">${esc(
                  truncateLabel(e.label, 40)
                )}</span>
              </div>
            `
          )
          .join('');
        legendHtml = `
          <div class="chart-legend-block" aria-label="${esc(copy.chartLegendLabel)}">
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
    return `
      <div class="slide slide-chart ${bg}${hasBottom ? ' has-bottom-subheading' : ''}" data-chart-type="${esc(
        chartType
      )}">
        <div class="slide-inner">
          <div class="chart-header">
            <div class="chart-title-row">
              <h2 class="chart-title" data-inline-field="title" dir="auto">${title}</h2>
            </div>
            ${subheading ? `<div class="subheading" data-inline-field="subheading" dir="auto">${esc(subheading)}</div>` : ''}
          </div>
          ${legendHtml}
          <div class="chart-area" data-inline-field="data" role="group" aria-label="${esc(a11yTitle)}">
            <div class="sr-only">
              <div>${esc(a11yTitle)}</div>
              ${desc ? `<div>${esc(desc)}</div>` : ''}
            </div>
            ${svg}
          </div>
          ${bottomSubheading}
        </div>
      </div>
    `;
  },
};
