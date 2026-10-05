/** Chapter-title mapper: editable words on a dark section-divider surface. */
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
const { resolveThemeMaster } = await import('../server/export/pptx-theme.js');
const theme = await seedThemeConfig('midnight');

async function exportChapter(content, customTheme = theme) {
  const built = await buildEditablePptxBuffer(
    '.',
    {
      id: 'chapters',
      title: 'Chapters',
      lang: 'en-GB',
      slides: [{ id: 'c1', type: 'chapter-title-slide', content }],
    },
    { theme: customTheme },
  );
  const zip = await JSZip.loadAsync(Buffer.from(built.buffer));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
  return { built, xml, shapes };
}

function position(shape) {
  const match = /<a:off x="(\d+)" y="(\d+)"/.exec(shape);
  return { x: Number(match[1]), y: Number(match[2]) };
}

test('chapter title has editable title and subtitle on the theme dark surface', async () => {
  assert.ok(PPTX_HANDLER_TYPES.includes('chapter-title-slide'));
  assert.ok(!PIXEL_PERFECT_HANDLER_TYPES.includes('chapter-title-slide'));
  const { built, xml, shapes } = await exportChapter({
    title: 'A new & better chapter',
    subheading: 'What comes next',
  });
  const spec = resolveThemeMaster(theme);
  assert.deepEqual(built.imageSlides, []);
  assert.deepEqual(built.warnings, []);
  assert.match(
    xml,
    new RegExp(`<p:bg>[\\s\\S]*?<a:srgbClr val="${spec.darkBackground}"`),
  );
  assert.equal(shapes.length, 2);
  assert.match(shapes[0], /<p:ph type="title"\/>/);
  assert.match(shapes[0], /A new &amp; better chapter/);
  assert.match(shapes[1], /What comes next/);
  assert.match(shapes[0], new RegExp(`<a:srgbClr val="${spec.darkText}"`));
  assert.match(shapes[1], new RegExp(`<a:srgbClr val="${spec.darkText}"`));
  assert.doesNotMatch(xml, /<p:pic>/);
});

test('vertical layouts move the title block and horizontal alignment centers both boxes', async () => {
  const content = { title: 'Section', subheading: 'Details' };
  const top = await exportChapter({ ...content, layout: 'top' });
  const middle = await exportChapter({ ...content, layout: 'center' });
  const bottom = await exportChapter({ ...content, layout: 'bottom' });
  const centered = await exportChapter({
    ...content,
    titleBlockAlign: 'center',
  });
  assert.ok(position(top.shapes[0]).y < position(middle.shapes[0]).y);
  assert.ok(position(middle.shapes[0]).y < position(bottom.shapes[0]).y);
  assert.ok(position(centered.shapes[0]).x > position(middle.shapes[0]).x);
  assert.ok(position(centered.shapes[1]).x > position(middle.shapes[1]).x);
  for (const shape of centered.shapes) assert.match(shape, /algn="ctr"/);
});

test('long chapter title is reduced to fit and empty subtitle leaves one shape', async () => {
  const { shapes, built } = await exportChapter({
    title: 'A long section heading '.repeat(6),
    subheading: '',
  });
  assert.equal(shapes.length, 1);
  assert.deepEqual(built.warnings, []);
  assert.match(shapes[0], /A long section heading/);
});
