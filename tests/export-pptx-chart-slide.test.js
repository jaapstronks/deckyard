/** The chart mapper writes editable chart parts and their source workbook. */
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { initSanitizer } from '../shared/sanitize.js';

await initSanitizer();
const { buildEditablePptxBuffer, PPTX_HANDLER_TYPES } =
  await import('../server/export/pptx.js');
const { seedThemeConfig } = await import('./helpers/theme-seed.js');
const { themeChartPalette } =
  await import('../shared/slide-types/types/chart-slide/palette.js');
const theme = await seedThemeConfig('midnight');

async function exportChart(content) {
  const result = await buildEditablePptxBuffer(
    '.',
    {
      id: 'chart-test',
      title: 'Chart test',
      lang: 'en-GB',
      slides: [{ id: 'chart-1', type: 'chart-slide', content }],
    },
    { theme },
  );
  const zip = await JSZip.loadAsync(Buffer.from(result.buffer));
  const slide = await zip.file('ppt/slides/slide1.xml').async('string');
  const chartName = Object.keys(zip.files).find((name) =>
    /^ppt\/charts\/chart\d+\.xml$/.test(name),
  );
  const chart = chartName ? await zip.file(chartName).async('string') : '';
  const workbookName = Object.keys(zip.files).find((name) =>
    /^ppt\/embeddings\/Microsoft_Excel_Worksheet\d+\.xlsx$/.test(name),
  );
  const workbook = workbookName
    ? await JSZip.loadAsync(await zip.file(workbookName).async('nodebuffer'))
    : null;
  const worksheet = workbook
    ? await workbook.file('xl/worksheets/sheet1.xml').async('string')
    : '';
  const sharedStrings = workbook
    ? await workbook.file('xl/sharedStrings.xml').async('string')
    : '';
  return {
    result,
    zip,
    slide,
    chart,
    worksheet,
    sharedStrings,
    chartName,
    workbookName,
  };
}

test('bar chart is a native object linked to an editable workbook', async () => {
  assert.ok(PPTX_HANDLER_TYPES.includes('chart-slide'));
  const built = await exportChart({
    title: 'Revenue',
    subheading: 'By region',
    bottomSubheading: 'FY 2026',
    chartType: 'bar',
    data: 'Region,Amount\nNorth,10\nSouth,25',
    showValues: 'yes',
    showLegend: 'yes',
    xLabel: 'Region',
    yLabel: 'EUR',
    background: 'dark',
  });
  assert.deepEqual(built.result.imageSlides, []);
  assert.deepEqual(built.result.warnings, []);
  assert.match(built.slide, /<c:chart r:id="rId\d+"/);
  assert.match(built.slide, /<p:ph type="title"\/>/);
  assert.match(built.slide, /Revenue[\s\S]*By region[\s\S]*FY 2026/);
  assert.doesNotMatch(built.slide, /<p:pic>/);
  assert.match(built.chart, /<c:barChart>/);
  assert.match(built.chart, /<c:showVal val="1"\/>/);
  assert.doesNotMatch(built.chart, /<c:legend>/);
  assert.match(built.chart, /Region/);
  assert.match(built.chart, /EUR/);
  assert.ok(built.chartName);
  assert.ok(built.workbookName);
  assert.match(built.sharedStrings, /North/);
  assert.match(built.sharedStrings, /South/);
  assert.match(built.worksheet, /25/);
  const rels = await built.zip
    .file('ppt/charts/_rels/chart1.xml.rels')
    .async('string');
  assert.match(rels, /relationships\/package/);
  assert.match(rels, /\.xlsx/);
});

test('line chart keeps two named series and the legend setting', async () => {
  const built = await exportChart({
    title: 'Trend',
    chartType: 'line',
    data: 'Year,Sales,Target\n2024,10,8\n2025,15,12',
    series1Label: 'Actual',
    series2Label: 'Plan',
    showLegend: 'yes',
    showValues: 'yes',
    xLabel: 'Year',
    yLabel: 'Units',
  });
  assert.match(built.chart, /<c:lineChart>/);
  assert.equal((built.chart.match(/<c:ser>/g) || []).length, 2);
  assert.match(built.chart, /Actual/);
  assert.match(built.chart, /Plan/);
  assert.match(built.chart, /<c:legendPos val="b"\/>/);
  assert.match(built.chart, /<c:showVal val="1"\/>/);
  assert.match(built.sharedStrings, /2024/);
  assert.match(built.sharedStrings, /2025/);
  assert.deepEqual(built.result.warnings, []);
});

test('pie chart carries theme slice colours and value-plus-percent labels', async () => {
  const built = await exportChart({
    title: 'Share',
    chartType: 'pie',
    data: 'Category,Value\nAlpha,30\nBeta,70',
    pieLabelMode: 'both',
    showLegend: 'no',
  });
  assert.match(built.chart, /<c:pieChart>/);
  assert.match(built.chart, /<c:showVal val="1"\/>/);
  assert.match(built.chart, /<c:showPercent val="1"\/>/);
  assert.doesNotMatch(built.chart, /<c:legend>/);
  for (const color of themeChartPalette(theme).slice(0, 2)) {
    assert.match(built.chart, new RegExp(color.slice(1).toUpperCase()));
  }
  assert.match(built.sharedStrings, /Alpha/);
  assert.match(built.sharedStrings, /Beta/);
  assert.deepEqual(built.result.imageSlides, []);
});

test('optional labels and a negative bar use their own chart settings', async () => {
  const bar = await exportChart({
    chartType: 'bar',
    data: 'Category,Value\nLoss,-5\nGain,10',
    showValues: 'no',
  });
  assert.match(bar.chart, /<c:barChart>/);
  assert.doesNotMatch(bar.chart, /<c:min val="0"\/>/);
  assert.match(bar.chart, /<c:showVal val="0"\/>/);
  const pie = await exportChart({
    chartType: 'pie',
    data: 'Category,Value\nA,2\nB,3',
    pieLabelMode: 'none',
    showLegend: 'no',
  });
  assert.match(pie.chart, /<c:pieChart>/);
  assert.match(pie.chart, /<c:showVal val="0"\/>/);
  assert.match(pie.chart, /<c:showPercent val="0"\/>/);
});

test('invalid data remains editable text and has no broken chart part', async () => {
  const built = await exportChart({
    title: 'Empty chart',
    chartType: 'bar',
    data: '',
  });
  assert.equal(built.chartName, undefined);
  assert.equal(built.workbookName, undefined);
  assert.match(built.slide, /Empty chart/);
  assert.match(built.slide, /Data is leeg/);
  assert.match(built.result.warnings.join(' '), /chart data is invalid/);
  assert.deepEqual(built.result.imageSlides, []);
});
