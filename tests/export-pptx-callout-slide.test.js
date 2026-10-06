/** Callout export keeps its status frame and projected words editable. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { initSanitizer } from '../shared/sanitize.js';

await initSanitizer();
const {
  buildEditablePptxBuffer,
  PPTX_HANDLER_TYPES,
  PIXEL_PERFECT_HANDLER_TYPES,
} = await import('../server/export/pptx.js');
const { seedThemeConfig } = await import('./helpers/theme-seed.js');
const theme = await seedThemeConfig('brand');

async function exportCallout(content, lang = 'en-GB', customTheme = theme) {
  const built = await buildEditablePptxBuffer(
    '.',
    {
      id: 'callouts',
      title: 'Callouts',
      lang,
      slides: [{ id: 'c1', type: 'callout-slide', content }],
    },
    { theme: customTheme },
  );
  const zip = await JSZip.loadAsync(Buffer.from(built.buffer));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
  return { built, xml, shapes };
}

function named(shapes, name) {
  const shape = shapes.find((part) => part.includes(`name="${name}"`));
  assert.ok(shape, `${name} exists`);
  return shape;
}

function frame(shape) {
  const match = /<a:off x="(\d+)" y="(\d+)"/.exec(shape);
  return { x: Number(match[1]), y: Number(match[2]) };
}

test('callout is an editable frame, accent, label, markdown body and source', async () => {
  assert.ok(PPTX_HANDLER_TYPES.includes('callout-slide'));
  assert.ok(!PIXEL_PERFECT_HANDLER_TYPES.includes('callout-slide'));
  const { built, xml, shapes } = await exportCallout({
    variant: 'warning',
    label: 'Watch the boundary',
    body: 'Keep **one** contract.\n\n[Read more](https://example.com/guide).',
    source: 'Research & practice',
    background: 'mist',
  });
  assert.deepEqual(built.imageSlides, []);
  assert.deepEqual(built.warnings, []);
  assert.match(named(shapes, 'Callout frame'), /<a:prstGeom prst="roundRect"/);
  assert.match(named(shapes, 'Callout accent'), /<a:srgbClr val="A5620A"/);
  const label = named(shapes, 'Slide title');
  assert.match(label, /<p:ph type="title"\/>/);
  assert.match(label, /Watch the boundary/);
  const body = named(shapes, 'Callout body');
  assert.match(body, /Keep /);
  assert.match(body, /<a:t>one<\/a:t>/);
  assert.match(body, /Read more/);
  assert.match(named(shapes, 'Callout source'), /Research &amp; practice/);
  assert.doesNotMatch(xml, /<p:pic>/);
  assert.ok(frame(named(shapes, 'Callout frame')).x < frame(body).x);
});

test('fallback eyebrow follows deck language and status tone lightens on dark ground', async () => {
  const { shapes, built } = await exportCallout(
    { variant: 'definition', label: '', body: 'Een term.', background: 'dark' },
    'nl',
  );
  assert.deepEqual(built.warnings, []);
  assert.match(named(shapes, 'Slide title'), /Definitie/);
  assert.match(named(shapes, 'Callout body'), /Een term/);
  assert.doesNotMatch(named(shapes, 'Callout accent'), /val="5B4BB8"/);
  assert.equal(
    shapes.some((shape) => shape.includes('Callout source')),
    false,
  );
});

test('variant accents follow the slide status palette', async () => {
  const css = await readFile(
    new URL('../client/styles/slides/00-tokens.css', import.meta.url),
    'utf8',
  );
  const roles = {
    insight: 'positive',
    warning: 'caution',
    definition: 'informative',
    note: 'neutral',
    tip: 'helpful',
  };
  for (const [variant, role] of Object.entries(roles)) {
    const token = new RegExp(`--slide-color-${role}: #(\\w{6});`).exec(css);
    assert.ok(token, `${role} status colour exists`);
    const { shapes } = await exportCallout({
      variant,
      body: 'One thought.',
      background: 'mist',
    });
    assert.match(
      named(shapes, 'Callout accent'),
      new RegExp(`<a:srgbClr val="${token[1].toUpperCase()}"`),
    );
  }
});

test('long body stays in its frame by reducing the type size', async () => {
  const { built, shapes } = await exportCallout({
    variant: 'insight',
    body: 'A useful and carefully qualified observation. '.repeat(12),
    source: 'Source',
  });
  assert.deepEqual(built.warnings, []);
  const body = named(shapes, 'Callout body');
  assert.match(body, /A useful and carefully qualified observation/);
  assert.match(body, /sz="\d+"/);
});
