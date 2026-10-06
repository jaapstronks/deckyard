/** KPI cards survive the editable export as positioned PowerPoint objects. */
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { initSanitizer } from '../shared/sanitize.js';
await initSanitizer();
const { buildEditablePptxBuffer, PPTX_HANDLER_TYPES } =
  await import('../server/export/pptx.js');
const { seedThemeConfig } = await import('./helpers/theme-seed.js');
const theme = await seedThemeConfig('midnight');

async function exportMetrics(content) {
  const result = await buildEditablePptxBuffer(
    '.',
    {
      id: 'metrics',
      title: 'Metrics',
      lang: 'en-GB',
      slides: [{ id: 'k1', type: 'kpi-metrics-slide', content }],
    },
    { theme },
  );
  const zip = await JSZip.loadAsync(Buffer.from(result.buffer));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
  return { result, xml, shapes };
}

function shapeNamed(shapes, name) {
  return shapes.find((shape) => shape.includes(`name="${name}"`));
}

function position(shape) {
  const [, x, y] = /<a:off x="(\d+)" y="(\d+)"/.exec(shape);
  return { x: Number(x), y: Number(y) };
}

function bottom(shape) {
  const { y } = position(shape);
  const [, , h] = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(shape);
  return y + Number(h);
}

test('KPI values and units stay together in editable cards', async () => {
  assert.ok(PPTX_HANDLER_TYPES.includes('kpi-metrics-slide'));
  const { result, xml, shapes } = await exportMetrics({
    title: 'Outcome',
    subheading: 'This quarter',
    bottomSubheading: 'Versus plan',
    background: 'dark',
    metrics: [
      {
        value: '98',
        unit: '%',
        label: 'Customer Satisfaction',
        note: '+3pp ahead',
      },
      {
        value: '1.2',
        unit: 'M',
        label: 'Reach',
        note: '-5% vs plan',
      },
    ],
  });
  assert.deepEqual(result.imageSlides, []);
  assert.deepEqual(result.warnings, []);
  assert.doesNotMatch(xml, /<p:pic>/);
  assert.match(shapeNamed(shapes, 'Slide title'), /<p:ph type="title"\/>/);
  assert.match(
    shapeNamed(shapes, 'KPI 1 value and unit'),
    /<a:t>98<\/a:t>[\s\S]*<a:t> %<\/a:t>/,
  );
  assert.match(shapeNamed(shapes, 'KPI 1 label'), /Customer Satisfaction/);
  assert.match(shapeNamed(shapes, 'KPI 1 note'), /\+3pp[\s\S]*ahead/);
  assert.match(shapeNamed(shapes, 'KPI 2 note'), /-5%[\s\S]*vs plan/);
  assert.match(xml, /Versus plan/);
});

test('one, three and four metrics use centered, one-row and two-row geometry', async () => {
  const metric = (i) => ({
    value: String(i),
    unit: '%',
    label: `Metric ${i}`,
    note: `+${i}% vs plan`,
  });
  const single = await exportMetrics({ metrics: [metric(1)] });
  const three = await exportMetrics({ metrics: [1, 2, 3].map(metric) });
  const four = await exportMetrics({ metrics: [1, 2, 3, 4].map(metric) });
  assert.equal((single.xml.match(/KPI \d card/g) || []).length, 1);
  const oneX = position(shapeNamed(single.shapes, 'KPI 1 card')).x;
  const threeX = position(shapeNamed(three.shapes, 'KPI 1 card')).x;
  assert.ok(oneX > threeX, 'single card is centered');
  const threeY = [1, 2, 3].map(
    (i) => position(shapeNamed(three.shapes, `KPI ${i} card`)).y,
  );
  assert.deepEqual(threeY, [threeY[0], threeY[0], threeY[0]]);
  const fourY = [1, 2, 3, 4].map(
    (i) => position(shapeNamed(four.shapes, `KPI ${i} card`)).y,
  );
  assert.deepEqual(fourY.slice(0, 2), [fourY[0], fourY[0]]);
  assert.ok(fourY[2] > fourY[0]);
  assert.equal(fourY[2], fourY[3]);
  for (const [i, shape] of four.shapes.entries()) {
    if (!shape.includes(' label"')) continue;
    const number = /name="KPI (\d+) label"/.exec(shape)?.[1];
    assert.ok(number, `label shape ${i} has a card number`);
    const note = shapeNamed(four.shapes, `KPI ${number} note`);
    assert.ok(
      bottom(shape) < position(note).y,
      `KPI ${number} label clears its note`,
    );
  }
});

test('long labels remain present and reduce their font size to fit', async () => {
  const label =
    'Visitors reached through a carefully named international campaign';
  const { shapes, result } = await exportMetrics({
    metrics: [1, 2, 3, 4].map((i) => ({ value: String(i), label })),
  });
  assert.deepEqual(result.warnings, []);
  const shape = shapeNamed(shapes, 'KPI 1 label');
  assert.match(shape, new RegExp(label));
  assert.match(shape, /sz="\d+"/);
});

test('an empty metrics list keeps the canvas placeholder card', async () => {
  const { shapes, result } = await exportMetrics({ metrics: [] });
  assert.deepEqual(result.warnings, []);
  assert.ok(shapeNamed(shapes, 'KPI 1 card'));
  assert.match(shapeNamed(shapes, 'KPI 1 value and unit'), /<a:t>0<\/a:t>/);
  assert.match(shapeNamed(shapes, 'KPI 1 label'), /<a:t>Label<\/a:t>/);
});
