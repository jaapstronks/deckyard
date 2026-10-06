/** Comparison keeps column ownership, rich text and treatment in editable OOXML. */
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { initSanitizer } from '../shared/sanitize.js';
import { seedThemeConfig } from './helpers/theme-seed.js';
import def from '../shared/slide-types/types/comparison-slide.js';
await initSanitizer();
const {
  buildEditablePptxBuffer,
  PPTX_HANDLER_TYPES,
  PIXEL_PERFECT_HANDLER_TYPES,
} = await import('../server/export/pptx.js');
const theme = await seedThemeConfig('brand');
async function exported(content) {
  const built = await buildEditablePptxBuffer(
    '.',
    {
      id: 'comparison',
      title: 'Compare',
      lang: 'en-GB',
      slides: [
        {
          id: 's1',
          type: 'comparison-slide',
          content: { ...def.defaults, ...content },
        },
      ],
    },
    { theme },
  );
  const zip = await JSZip.loadAsync(Buffer.from(built.buffer));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
  const named = (name) => {
    const s = shapes.find((s) => s.includes(`name="${name}"`));
    assert.ok(s, name);
    return s;
  };
  return { built, xml, named, shapes };
}
function box(xml) {
  const [, x, y] = /<a:off x="(\d+)" y="(\d+)"/.exec(xml);
  const [, w, h] = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(xml);
  return { x: +x, y: +y, w: +w, h: +h };
}
test('comparison has a native editable handler only; pixel-perfect still rasterizes', () => {
  assert.equal(def.fidelity.pptx, 'native');
  assert.ok(PPTX_HANDLER_TYPES.includes('comparison-slide'));
  assert.ok(!PIXEL_PERFECT_HANDLER_TYPES.includes('comparison-slide'));
});
test('two columns preserve text ownership, markdown and title semantics in reading order', async () => {
  const { built, xml, named } = await exported({
    leftTitle: 'Same title',
    rightTitle: 'Same title',
    leftBody:
      'Left **bold**\n\n- First\n  - Nested\n\n[Link](https://example.com)',
    rightBody: '## Detail\n\nRight *emphasis*',
    verdict: 'Choose wisely',
    bottomSubheading: 'Bottom',
    subheading: 'Subtitle',
  });
  assert.deepEqual(built.warnings, []);
  assert.deepEqual(built.imageSlides, []);
  assert.doesNotMatch(xml, /<p:pic>|<a:tbl>/);
  assert.match(named('Slide title'), /<p:ph type="title"\/>/);
  assert.match(named('Slide title'), /algn="l"/);
  const left = named('Comparison leftBody');
  const right = named('Comparison rightBody');
  assert.match(left, /<a:t>bold<\/a:t>/);
  assert.match(left, /<a:hlinkClick/);
  assert.match(left, /buChar/);
  assert.doesNotMatch(left, /Right|Detail/);
  assert.match(right, /Detail/);
  assert.match(right, /emphasis/);
  const a = box(left),
    b = box(right);
  assert.ok(a.x + a.w < b.x);
  assert.equal(a.y, b.y);
  const sequence = [
    'Slide title',
    'Comparison subheading',
    'Comparison leftTitle',
    'Comparison leftBody',
    'Comparison rightTitle',
    'Comparison rightBody',
    'Comparison verdict"',
    'Comparison bottomSubheading',
  ];
  let previous = -1;
  for (const name of sequence) {
    const next = xml.indexOf(`name="${name}`);
    assert.ok(next > previous, name);
    previous = next;
  }
});
test('all four treatments retain their distinguishing geometry and text roles', async () => {
  const neutral = await exported({ variant: 'versus' });
  assert.doesNotMatch(neutral.xml, /Comparison direction/);
  const before = await exported({ variant: 'before-after' });
  assert.match(before.named('Comparison direction'), /prst="chevron"/);
  assert.notEqual(
    before.named('Comparison leftBody').match(/srgbClr val="(\w+)"/)[1],
    before.named('Comparison rightBody').match(/srgbClr val="(\w+)"/)[1],
  );
  const pros = await exported({
    variant: 'pros-cons',
    leftBody: '- Benefit\n  - Detail\n\n1. Number',
    rightBody: '- Risk',
  });
  assert.match(pros.named('Comparison leftTitle'), /val="2F7A4F"/);
  assert.match(pros.named('Comparison rightTitle'), /val="B54D4D"/);
  assert.match(pros.named('Comparison leftBody'), /buChar char="&#x2713;"/);
  assert.match(pros.named('Comparison leftBody'), /buAutoNum/);
  assert.match(pros.named('Comparison rightBody'), /buChar char="&#x2717;"/);
  const tradeoff = await exported({ variant: 'tradeoff' });
  assert.match(tradeoff.named('Comparison leftTitle'), /spc="/);
  assert.notEqual(
    tradeoff.named('Comparison divider'),
    neutral.named('Comparison divider'),
  );
  const dark = await exported({ variant: 'pros-cons', background: 'dark' });
  assert.doesNotMatch(dark.named('Comparison leftTitle'), /val="2F7A4F"/);
});
test('long columns shrink independently and report content that exceeds the fit floor', async () => {
  const short = await exported({ leftBody: 'Short.' });
  const long = await exported({
    leftTitle: 'A longer title with enough words to occupy more than one line',
    leftBody: 'A carefully qualified point. '.repeat(42),
    rightBody: 'Short.',
  });
  assert.deepEqual(long.built.warnings, []);
  const size = (xml) => +/ sz="(\d+)"/.exec(xml)[1];
  assert.ok(
    size(long.named('Comparison leftBody')) <
      size(short.named('Comparison leftBody')),
  );
  assert.equal(
    box(long.named('Comparison leftBody')).y,
    box(long.named('Comparison rightBody')).y,
  );
  const overflow = await exported({
    leftBody: 'Very long prose. '.repeat(500),
  });
  assert.ok(
    overflow.built.warnings.some((w) => w.includes('leftBody overflows')),
  );
  assert.match(overflow.named('Comparison leftBody'), /Very long prose/);
});
test('omitted optional text and empty column do not acquire invented content', async () => {
  const { xml, built } = await exported({
    title: '',
    leftTitle: '',
    leftBody: '',
    subheading: '',
    bottomSubheading: '',
    verdict: '',
  });
  assert.deepEqual(built.warnings, []);
  assert.doesNotMatch(
    xml,
    /name="Slide title"|name="Comparison leftBody"|name="Comparison verdict/,
  );
  assert.match(xml, /Option B/);
});
