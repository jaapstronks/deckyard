/** Editable PowerPoint chart backed by the chart slide's parsed CSV data. */
import {
  resolveSlideBgHex,
  resolveSlideBgTone,
} from '../../shared/slide-surface-tone.js';
import { hexToRgb } from '../../shared/color-utils.js';
import {
  CHART_ERROR,
  parseChartData,
} from '../../shared/slide-types/types/chart-slide/parse.js';
import { chartErrorMessages } from '../../shared/slide-types/types/chart-slide/error.js';
import { getSlideCopy } from '../../shared/slide-types/slide-copy.js';
import { themeChartPalette } from '../../shared/slide-types/types/chart-slide/palette.js';
import { chartSummary } from '../../shared/slide-types/types/chart-slide/summary.js';
import {
  MIN_BODY_PT,
  POSITIONED_TITLE_NAME,
  fitSize,
  slideBlocks,
  textBlockHeight,
} from './pptx-generic.js';
import { PPTX_LAYOUTS, layoutBox, themeTextPt } from './pptx-theme.js';

const CANVAS_W = 1600;

function textBlock(text) {
  return {
    kind: 'text',
    paragraphs: [{ lines: [[{ text }]], level: 0, bullet: null }],
  };
}

function addText(pptxSlide, text, box, options, warnings, slideNum) {
  if (!text) return 0;
  const block = textBlock(text);
  const fit = fitSize([block], box, options.fontSize, MIN_BODY_PT);
  if (!fit.fits)
    warnings.push(`Slide ${slideNum}: chart text overflows its box.`);
  const h = Math.min(box.h, textBlockHeight(block, fit.pt, box.w));
  pptxSlide.addText(text, {
    ...box,
    h,
    ...options,
    fontSize: fit.pt,
    margin: 0,
    valign: 'top',
    isTextBox: true,
  });
  return h;
}

function chartData(parsed, content, lang) {
  const { dataset } = parsed;
  const copy = getSlideCopy(lang);
  if (parsed.kind !== 'line') {
    return [{ name: 'Value', labels: dataset.labels, values: dataset.values }];
  }
  const first = String(content.series1Label || '').trim();
  const second = String(content.series2Label || '').trim();
  const series = [
    {
      name: first || dataset.series1Label || copy.chartEncodingSeries1,
      labels: dataset.x,
      values: dataset.y1,
    },
  ];
  if (dataset.y2?.some((value) => value != null)) {
    series.push({
      name: second || dataset.series2Label || copy.chartEncodingSeries2,
      labels: dataset.x,
      values: dataset.y2,
    });
  }
  return series;
}

function pptxHex(rgb) {
  return ['r', 'g', 'b']
    .map((channel) => rgb[channel].toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function gridColor(background, foreground) {
  const bg = hexToRgb(background);
  const fg = hexToRgb(foreground);
  if (!bg || !fg) return foreground;
  return pptxHex(
    Object.fromEntries(
      ['r', 'g', 'b'].map((channel) => [
        channel,
        Math.round(bg[channel] * 0.86 + fg[channel] * 0.14),
      ]),
    ),
  );
}

function chartOptions(
  parsed,
  content,
  spec,
  theme,
  color,
  background,
  box,
  lang,
) {
  const palette = themeChartPalette(theme)
    .map(hexToRgb)
    .filter(Boolean)
    .map(pptxHex);
  if (!palette.length) {
    palette.push(...themeChartPalette(null).map(hexToRgb).map(pptxHex));
  }
  const hasSecond = parsed.dataset.y2?.some((value) => value != null);
  const legendSetting = String(content.showLegend || '').trim();
  const showLegend =
    parsed.kind !== 'bar' &&
    (legendSetting === 'yes'
      ? true
      : legendSetting === 'no'
        ? false
        : parsed.kind === 'pie' || (parsed.kind === 'line' && hasSecond));
  const pieMode = String(content.pieLabelMode || '%').trim();
  const normalizedPieMode = pieMode === 'percent' ? '%' : pieMode;
  const labels = ['none', 'value', '%', 'both'].includes(normalizedPieMode)
    ? normalizedPieMode
    : '%';
  const values =
    parsed.kind === 'line'
      ? [...parsed.dataset.y1, ...(parsed.dataset.y2 || [])]
      : parsed.dataset.values;
  const axis = {
    catAxisTitle: String(content.xLabel || '').trim(),
    valAxisTitle: String(content.yLabel || '').trim(),
    showCatAxisTitle: !!String(content.xLabel || '').trim(),
    showValAxisTitle: !!String(content.yLabel || '').trim(),
    catAxisLabelColor: color,
    valAxisLabelColor: color,
    catAxisTitleColor: color,
    valAxisTitleColor: color,
    catAxisLabelFontFace: spec.monoFont || undefined,
    valAxisLabelFontFace: spec.monoFont || undefined,
    catGridLine: { style: 'none' },
    valGridLine: { color: gridColor(background, color) },
    ...(values.every((value) => value == null || value >= 0)
      ? { valAxisMinVal: 0 }
      : {}),
  };
  return {
    ...box,
    ...axis,
    chartColors: palette,
    showLegend,
    legendPos: 'b',
    legendColor: color,
    legendFontFace: spec.monoFont || undefined,
    showValue:
      parsed.kind === 'bar' || parsed.kind === 'line'
        ? content.showValues === 'yes'
        : parsed.kind === 'pie' && (labels === 'value' || labels === 'both'),
    showPercent: parsed.kind === 'pie' && (labels === '%' || labels === 'both'),
    showLabel: false,
    showTitle: false,
    dataLabelColor: color,
    dataLabelFontFace: spec.monoFont || undefined,
    showSerName: false,
    altText: chartSummary(parsed, lang),
  };
}

/**
 * Compose one chart slide with an editable chart and an embedded data workbook.
 * Invalid or empty data keeps the canvas' error-card meaning as editable text.
 * @returns {Promise<{pptxSlide: object, warnings: string[]}>}
 */
export async function composeChartSlide(pptx, slide, ctx) {
  const { spec, theme, slideNum, slideWidth, slideHeight } = ctx;
  const content = slide?.content || {};
  const chartType = String(content.chartType || 'bar');
  const parsed = ['bar', 'line', 'pie'].includes(chartType)
    ? parseChartData({ chartType, data: content.data || '' })
    : { ok: false, errors: [CHART_ERROR.unknownType] };
  const pptxSlide = pptx.addSlide({ masterName: PPTX_LAYOUTS.headingBody });
  const warnings = [];
  const ground = resolveSlideBgHex(content, theme);
  if (ground) pptxSlide.background = { color: ground.slice(1).toUpperCase() };
  const dark = resolveSlideBgTone(content, theme) === 'dark';
  const color = dark ? spec.darkText : spec.text;
  const muted = dark ? spec.darkText : spec.textMuted;
  const pad = layoutBox('headingBody', 'title').x;
  const width = slideWidth - 2 * pad;
  const align = content.headerAlign === 'center' ? 'center' : 'left';
  const projected = slideBlocks(slide, ctx.def, {
    index: slideNum - 1,
    lang: ctx.docLang,
    slideIds: ctx.slideIds,
  });
  const title = projected.heading.visible ? projected.heading.text : '';
  let nextY = pad;
  nextY += addText(
    pptxSlide,
    title,
    { x: pad, y: nextY, w: width, h: slideHeight * 0.13 },
    {
      fontSize: themeTextPt(spec, '3xl'),
      color,
      fontFace: spec.headFont || undefined,
      align,
      objectName: POSITIONED_TITLE_NAME,
    },
    warnings,
    slideNum,
  );
  const subheading = String(content.subheading || '').trim();
  if (subheading) {
    nextY += (slideWidth * 12) / CANVAS_W;
    nextY += addText(
      pptxSlide,
      subheading,
      { x: pad, y: nextY, w: width, h: slideHeight * 0.1 },
      { fontSize: themeTextPt(spec, 'lg'), color: muted, align },
      warnings,
      slideNum,
    );
  }
  const bottom = String(content.bottomSubheading || '').trim();
  const bottomH = bottom ? slideHeight * 0.1 : 0;
  if (bottom) {
    addText(
      pptxSlide,
      bottom,
      { x: pad, y: slideHeight - pad - bottomH, w: width, h: bottomH },
      { fontSize: themeTextPt(spec, 'lg'), color: muted },
      warnings,
      slideNum,
    );
  }
  const chartY = Math.max(
    nextY + (slideWidth * 24) / CANVAS_W,
    slideHeight * 0.22,
  );
  const chartBox = {
    x: pad,
    y: chartY,
    w: width,
    h: slideHeight - pad - bottomH - (bottom ? 0.12 : 0) - chartY,
  };
  if (!parsed.ok || !['bar', 'line', 'pie'].includes(parsed.kind)) {
    const message = chartErrorMessages(
      parsed.errors?.length ? parsed.errors : [CHART_ERROR.unknownType],
      ctx.docLang,
    ).join(' ');
    addText(
      pptxSlide,
      message,
      chartBox,
      { fontSize: themeTextPt(spec, 'md'), color },
      warnings,
      slideNum,
    );
    warnings.push(`Slide ${slideNum}: chart data is invalid; chart omitted.`);
    return { pptxSlide, warnings };
  }
  const type =
    parsed.kind === 'bar'
      ? pptx.ChartType.bar
      : parsed.kind === 'line'
        ? pptx.ChartType.line
        : pptx.ChartType.pie;
  pptxSlide.addChart(
    type,
    chartData(parsed, content, ctx.docLang),
    chartOptions(
      parsed,
      content,
      spec,
      theme,
      color,
      ground || spec.background,
      chartBox,
      ctx.docLang,
    ),
  );
  return { pptxSlide, warnings };
}
