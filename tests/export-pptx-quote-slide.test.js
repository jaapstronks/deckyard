/** Quote mapper: editable text, dark surface, layout variants and portraits. */
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { initSanitizer } from '../shared/sanitize.js';
await initSanitizer();
const {
  buildEditablePptxBuffer,
  PPTX_HANDLER_TYPES,
  PIXEL_PERFECT_HANDLER_TYPES,
} = await import('../server/export/pptx.js');
const { seedThemeConfig } = await import('./helpers/theme-seed.js');
const { resolveThemeMaster, themeTextPt } =
  await import('../server/export/pptx-theme.js');
const theme = await seedThemeConfig('midnight');
const sample = {
  quote: 'Make room for better ideas.',
  authorName: 'Jane & Sam',
  authorTitle: 'Designers',
};

async function exportQuote(content = sample, customTheme = theme) {
  const built = await buildEditablePptxBuffer(
    '.',
    {
      id: 'quotes',
      title: 'Quotes',
      lang: 'en-GB',
      slides: [{ id: 'q1', type: 'quote-slide', content }],
    },
    { theme: customTheme },
  );
  const zip = await JSZip.loadAsync(Buffer.from(built.buffer));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
  return { built, xml, shapes };
}
function frame(shape) {
  return {
    x: Number(/<a:off x="(\d+)"/.exec(shape)[1]),
    y: Number(/<a:off x="\d+" y="(\d+)"/.exec(shape)[1]),
  };
}

test('quote is editable only in the editable file, with dark ground and a title', async () => {
  assert.ok(PPTX_HANDLER_TYPES.includes('quote-slide'));
  assert.ok(!PIXEL_PERFECT_HANDLER_TYPES.includes('quote-slide'));
  const { xml, built, shapes } = await exportQuote();
  assert.deepEqual(built.imageSlides, []);
  assert.deepEqual(built.warnings, []);
  const spec = resolveThemeMaster(theme);
  assert.match(
    xml,
    new RegExp(`<p:bg>[\\s\\S]*?<a:srgbClr val="${spec.darkBackground}"`),
  );
  assert.match(shapes[0], /<p:ph type="title"\/>/);
  assert.match(shapes[0], /“Make room for better ideas.”/);
  assert.match(
    shapes[0],
    new RegExp(`sz="${Math.floor(themeTextPt(spec, '4xl')) * 100}"`),
  );
  assert.match(shapes[0], new RegExp(`<a:srgbClr val="${spec.darkText}"`));
  assert.match(shapes[1], /Jane &amp; Sam/);
  assert.match(shapes[1], /Designers/);
  assert.match(shapes[1], /sz="1600"/);
  assert.doesNotMatch(xml, /<p:pic>/);
});

test('centered quote moves its whole block; ordinary attribution sits at the bottom', async () => {
  const left = await exportQuote();
  const center = await exportQuote({ ...sample, quoteAlign: 'center' });
  assert.ok(frame(center.shapes[0]).y > frame(left.shapes[0]).y);
  assert.ok(frame(center.shapes[1]).y < frame(left.shapes[1]).y);
  for (const shape of center.shapes) assert.match(shape, /algn="ctr"/);
});

test('multiple quotes alternate and preserve their own attribution and matching font size', async () => {
  const { shapes, built } = await exportQuote({
    ...sample,
    quotes: [
      { quote: 'A second voice.', authorName: 'Alex', authorTitle: 'Editor' },
      { quote: 'A third voice.', authorName: 'Chris' },
    ],
  });
  assert.deepEqual(built.warnings, []);
  assert.equal(shapes.length, 6);
  assert.match(shapes[2], /“A second voice.”/);
  assert.match(shapes[3], /Alex/);
  assert.match(shapes[3], /Editor/);
  assert.match(shapes[4], /“A third voice.”/);
  assert.ok(frame(shapes[2]).x > frame(shapes[0]).x);
  assert.equal(frame(shapes[4]).x, frame(shapes[0]).x);
  assert.match(shapes[2], /algn="r"/);
  const sizes = [0, 2, 4].map((i) => /sz="(\d+)"/.exec(shapes[i])[1]);
  assert.equal(new Set(sizes).size, 1);
  assert.equal(
    (shapes.join('').match(/<p:ph type="title"\/>/g) || []).length,
    1,
  );
});

test('empty extras and extras beyond the canvas limit do not export', async () => {
  const { xml } = await exportQuote({
    ...sample,
    quotes: [{ quote: ' ' }, { quote: 'Second' }, { quote: 'Must not appear' }],
  });
  assert.match(xml, /Second/);
  assert.doesNotMatch(xml, /Must not appear/);
});

test('primary and extra portraits are independent editable circular pictures with alt text', async () => {
  const image = '/assets/images/slides-previewimage.png';
  const { xml, built } = await exportQuote({
    ...sample,
    authorImage1: image,
    authorImage1Alt: 'Jane portrait',
    authorImage2: image,
    authorImage2Alt: 'Sam portrait',
    quotes: [
      {
        quote: 'Second',
        authorName: 'Alex',
        authorImage: image,
        authorImageAlt: 'Alex portrait',
      },
    ],
  });
  assert.deepEqual(built.warnings, []);
  assert.equal((xml.match(/<p:pic>/g) || []).length, 3);
  assert.equal((xml.match(/prst="ellipse"/g) || []).length, 3);
  for (const name of ['Jane', 'Sam', 'Alex'])
    assert.match(xml, new RegExp(`descr="${name} portrait"`));
});

test('missing portrait warns and keeps the quotation and attribution', async () => {
  const { xml, built } = await exportQuote({
    ...sample,
    authorImage1: '/assets/missing-quote-portrait.png',
    authorImage1Alt: 'Missing portrait',
  });
  assert.equal(built.warnings.length, 1);
  assert.match(built.warnings[0], /could not be embedded/);
  assert.match(xml, /Missing portrait/);
  assert.match(xml, /Jane &amp; Sam/);
});

test('dark palette and scale come from the theme even when its default is light', async () => {
  const custom = {
    ...theme,
    cssVars: {
      ...theme.cssVars,
      '--t-slide-bg-dark': '#123456',
      '--t-slide-bg-dark-text': '#fedcba',
      '--t-color-accent-on-dark': '#abcdef',
      '--t-slide-text-scale': '1.25',
      '--t-font-mono': 'Courier New',
    },
  };
  const { xml, shapes } = await exportQuote(sample, custom);
  for (const color of ['123456', 'FEDCBA', 'ABCDEF'])
    assert.match(xml, new RegExp(`val="${color}"`));
  assert.match(shapes[0], /sz="4800"/);
  assert.match(shapes[1], /typeface="Courier New"/);
});

test('empty quotation does not turn the attribution into a quotation', async () => {
  const { xml, shapes } = await exportQuote({ authorName: 'Only author' });
  assert.match(xml, /Only author/);
  assert.doesNotMatch(shapes[0], /Only author/);
});
