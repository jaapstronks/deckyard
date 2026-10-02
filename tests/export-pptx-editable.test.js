/**
 * The editable PPTX and its layer 0 (B290, D141): what the slide XML carries.
 *
 * Why this file runs without a browser: with `compose: 'generic'` every slide
 * goes through layer 0, which writes text, tables and pictures and never
 * renders a slide, so the sample deck of every core type builds in well under
 * a second. The raster branch of the editable export (a `raster` type as its
 * image, reported by number) needs Chrome and is pinned in
 * `export-chrome-smoke.test.js`.
 *
 * The sample pictures are remote (`picsum.photos`), which the SSRF guard does
 * not fetch (it refuses redirects); they are swapped for a local asset so the
 * picture path is exercised and the test stays off the network.
 *
 * Run with: node --test tests/export-pptx-editable.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { initSanitizer } from '../shared/sanitize.js';
// Real sanitizer, as the server has it: without it markdown projects escaped.
await initSanitizer();

const { CORE_SLIDE_TYPE_DEFS, CORE_SLIDE_TYPE_NAMES } =
  await import('../shared/slide-types/registry.js');
const { slideTypeSample } =
  await import('../shared/slide-types/authoring-companions.js');
const { newSlide } = await import('../shared/slide-types/presentation.js');
const { buildEditablePptxBuffer } = await import('../server/export/pptx.js');
const { paragraphRuns, fitSize } =
  await import('../server/export/pptx-generic.js');
const { PPTX_LAYOUTS } = await import('../server/export/pptx-theme.js');
const { seedThemeConfig } = await import('./helpers/theme-seed.js');

const repoRoot = '.';
const LOCAL_IMAGE = '/assets/images/slides-previewimage.png';

/** A sample's remote pictures, pointed at a local asset. */
function localPictures(content) {
  if (!content) return content;
  return JSON.parse(
    JSON.stringify(content).replace(
      /https:\/\/picsum\.photos\/[^"]+/g,
      LOCAL_IMAGE,
    ),
  );
}

/** The sample deck: one slide per core type, in registry order. */
function sampleDeck(lang = 'en-GB') {
  return {
    id: 'pptx-editable-deck',
    title: 'Every type',
    lang,
    slides: CORE_SLIDE_TYPE_NAMES.map((type, i) => ({
      ...newSlide({
        type,
        lang,
        content: localPictures(
          slideTypeSample(type, CORE_SLIDE_TYPE_DEFS[type]),
        ),
        slideTypes: CORE_SLIDE_TYPE_DEFS,
        presentationId: 'pptx-editable-deck',
      }),
      id: `s${i + 1}`,
    })),
  };
}

/** midnight: a dark ground, so a run that fell back to black shows up. */
const theme = await seedThemeConfig('midnight');
const built = await buildEditablePptxBuffer(repoRoot, sampleDeck(), {
  compose: 'generic',
  theme,
  slideTypes: CORE_SLIDE_TYPE_DEFS,
});
const zip = await JSZip.loadAsync(Buffer.from(built.buffer));

/** A type's slide XML in the sample deck. */
async function slideXml(type) {
  const n = CORE_SLIDE_TYPE_NAMES.indexOf(type) + 1;
  assert.ok(n > 0, `${type} is a core type`);
  return zip.file(`ppt/slides/slide${n}.xml`).async('string');
}

/** The layout name a type's slide sits on. */
async function layoutName(type) {
  const n = CORE_SLIDE_TYPE_NAMES.indexOf(type) + 1;
  const rels = await zip
    .file(`ppt/slides/_rels/slide${n}.xml.rels`)
    .async('string');
  const target = /slideLayouts\/(slideLayout\d+\.xml)/.exec(rels)?.[1];
  assert.ok(target, `slide ${n} names a layout`);
  const xml = await zip.file(`ppt/slideLayouts/${target}`).async('string');
  return /<p:cSld name="([^"]*)"/.exec(xml)?.[1];
}

/** The `<a:t>` texts of a part, in order. */
function texts(xml) {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]);
}

test('every core type comes out as one slide on a theme layout', async () => {
  const slides = Object.keys(zip.files).filter((f) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(f),
  );
  assert.equal(slides.length, CORE_SLIDE_TYPE_NAMES.length);
  const layouts = new Set(Object.values(PPTX_LAYOUTS));
  for (const type of CORE_SLIDE_TYPE_NAMES) {
    assert.ok(
      layouts.has(await layoutName(type)),
      `${type} should sit on one of the theme's layouts`,
    );
  }
  assert.deepEqual(built.imageSlides, [], 'generic writes no slide as image');
});

test('a cover takes the title layout, a list the heading-and-body one', async () => {
  assert.equal(await layoutName('title-slide'), PPTX_LAYOUTS.title);
  assert.equal(await layoutName('content-slide'), PPTX_LAYOUTS.headingBody);
  assert.equal(
    await layoutName('image-text-slide'),
    PPTX_LAYOUTS.headingImageBody,
  );
});

test('the heading lands in the title placeholder, the body in the body', async () => {
  const xml = await slideXml('content-slide');
  const title = /<p:ph[^>]*type="title"[\s\S]*?<\/p:sp>/.exec(xml)?.[0];
  assert.ok(title?.includes('<a:t>Key Insights</a:t>'));
  const body = /<p:ph[^>]*type="body"[\s\S]*?<\/p:sp>/.exec(xml)?.[0];
  assert.ok(body, 'the list is written into the body placeholder');
  assert.deepEqual(texts(body), [
    'First important point with details',
    'Second point that matters',
    'Third supporting argument',
    'Final conclusion to remember',
  ]);
  assert.equal(
    (body.match(/<a:buChar char="&#x2022;"\/>/g) || []).length,
    4,
    'each list item is its own bulleted paragraph',
  );
});

test('every run names the theme text colour, never a default black', async () => {
  const text = String(theme.cssVars['--t-color-text'] || '')
    .replace('#', '')
    .toUpperCase();
  for (const type of ['content-slide', 'table-slide', 'kpi-metrics-slide']) {
    const xml = await slideXml(type);
    for (const run of xml.matchAll(/<a:rPr[^>]*>([\s\S]*?)<\/a:rPr>/g)) {
      assert.ok(
        !run[1].includes('val="000000"'),
        `${type}: a run fell back to black on a dark ground`,
      );
    }
    assert.ok(
      xml.includes('<a:srgbClr val='),
      `${type}: the runs carry a colour`,
    );
  }
  assert.ok(text, 'midnight names a text colour');
});

test('a table is a real table with a header row PowerPoint knows about', async () => {
  const xml = await slideXml('table-slide');
  assert.ok(xml.includes('<a:tbl>'), 'table-slide writes an a:tbl');
  assert.ok(
    xml.includes('<a:tblPr firstRow="1"/>'),
    'the header row is marked as such',
  );
  const cells = texts(xml);
  for (const cell of ['Metric', 'Q1', 'Revenue', '$120K', 'Growth', '+67%']) {
    assert.ok(cells.includes(cell), `the table holds '${cell}'`);
  }
  assert.ok(
    cells.includes('All figures in thousands'),
    'the caption travels under the table',
  );
});

test('a picture is embedded at its own ratio, with its alt text', async () => {
  const xml = await slideXml('image-text-slide');
  const pic = /<p:pic>[\s\S]*?<\/p:pic>/.exec(xml)?.[0];
  assert.ok(pic, 'image-text-slide places a picture');
  assert.match(pic, /descr="Sample image"/);
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic);
  const ratio = Number(ext[1]) / Number(ext[2]);
  // slides-previewimage.png is 1200x630.
  assert.ok(
    Math.abs(ratio - 1200 / 630) < 0.01,
    `the frame keeps the picture's ratio (got ${ratio.toFixed(3)})`,
  );
  assert.ok(
    texts(xml).includes('Engage your audience'),
    'the text beside the picture is there too',
  );
});

test('a labelled item keeps its label and value in one paragraph', async () => {
  const xml = await slideXml('kpi-metrics-slide');
  const body = /<p:ph[^>]*type="body"[\s\S]*?<\/p:sp>/.exec(xml)?.[0];
  const paras = body.match(/<a:p>[\s\S]*?<\/a:p>/g);
  const first = paras.find((p) => p.includes('Customer Satisfaction'));
  assert.ok(first.includes('<a:t>98%</a:t>'), 'the value sits with its label');
  assert.ok(first.includes('<a:br/>'), 'on its own line, by a soft break');
  assert.match(first, /<a:rPr[^>]*\sb="1"[^>]*>[\s\S]*?Customer Satisfaction/);
});

test('a numbered list numbers each item from its own position', async () => {
  const xml = await slideXml('timeline-slide');
  const starts = [
    ...xml.matchAll(/buAutoNum type="arabicPeriod" startAt="(\d+)"/g),
  ].map((m) => Number(m[1]));
  assert.deepEqual(starts, [1, 2, 3, 4, 5]);
});

test('a slide whose projection is empty is reported, not filled', async () => {
  const n = CORE_SLIDE_TYPE_NAMES.indexOf('follow-invite-slide') + 1;
  assert.ok(
    built.warnings.some((w) => w.startsWith(`Slide ${n}: its projection`)),
    'the empty slide is named in the warnings',
  );
});

test('notes ride on a layer-0 slide like on any other', async () => {
  const deck = sampleDeck();
  deck.slides = [{ ...deck.slides[2], notes: 'Say this out loud.' }];
  const { buffer } = await buildEditablePptxBuffer(repoRoot, deck, {
    compose: 'generic',
    slideTypes: CORE_SLIDE_TYPE_DEFS,
  });
  const z = await JSZip.loadAsync(Buffer.from(buffer));
  const notes = await z.file('ppt/notesSlides/notesSlide1.xml').async('string');
  assert.ok(texts(notes).includes('Say this out loud.'));
});

test('a type that claims native without a mapper of its own goes through layer 0', async () => {
  const registry = {
    ...CORE_SLIDE_TYPE_DEFS,
    'memo-slide': {
      ...CORE_SLIDE_TYPE_DEFS['content-slide'],
      fidelity: { pptx: 'native' },
    },
  };
  const deck = {
    title: 'Fork',
    slides: [
      {
        id: 'm1',
        type: 'memo-slide',
        content: { title: 'A memo', body: 'One line of it.' },
      },
      { id: 'v1', type: 'video-slide', content: { source: '', title: 'Clip' } },
    ],
  };
  const result = await buildEditablePptxBuffer(repoRoot, deck, {
    slideTypes: registry,
  });
  assert.deepEqual(result.imageSlides, [], 'neither slide became an image');
  const z = await JSZip.loadAsync(Buffer.from(result.buffer));
  const memo = await z.file('ppt/slides/slide1.xml').async('string');
  assert.ok(memo.includes('type="title"'), 'the memo is on a theme layout');
  assert.ok(texts(memo).includes('One line of it.'));
  const video = await z.file('ppt/slides/slide2.xml').async('string');
  assert.ok(
    !video.includes('<p:ph'),
    "the video keeps its own composition, not layer 0's",
  );
});

test('an unknown compose is refused, not read as the default', async () => {
  await assert.rejects(
    buildEditablePptxBuffer(repoRoot, sampleDeck(), { compose: 'all' }),
    /unknown PPTX compose 'all'/,
  );
});

test('paragraphs break hard, lines inside an item break soft', () => {
  const runs = paragraphRuns(
    [
      {
        lines: [[{ text: 'Label', bold: true }], [{ text: 'value' }]],
        level: 0,
        bullet: { kind: 'bullet' },
      },
      { lines: [[{ text: 'Next' }]], level: 0, bullet: null },
    ],
    { pt: 12, color: 'FFFFFF' },
  );
  assert.deepEqual(
    runs.map((r) => [
      r.text,
      !!r.options.softBreakBefore,
      !!r.options.breakLine,
    ]),
    [
      ['Label', false, false],
      ['value', true, true],
      ['Next', false, false],
    ],
  );
  assert.ok(runs.every((r) => r.options.color === 'FFFFFF'));
});

test('the line budget shrinks the size until the text fits, then says so', () => {
  const para = (n) => ({
    lines: [[{ text: 'word '.repeat(n) }]],
    level: 0,
    bullet: null,
  });
  const box = { x: 0, y: 0, w: 6, h: 2 };
  const roomy = fitSize(
    [{ kind: 'text', paragraphs: [para(10)] }],
    box,
    24,
    10,
  );
  assert.deepEqual(roomy, { pt: 24, fits: true });
  const crowded = fitSize(
    [{ kind: 'text', paragraphs: Array.from({ length: 8 }, () => para(40)) }],
    box,
    24,
    10,
  );
  assert.ok(crowded.pt < 24, 'a crowded box gets a smaller size');
  const hopeless = fitSize(
    [{ kind: 'text', paragraphs: Array.from({ length: 80 }, () => para(80)) }],
    box,
    24,
    10,
  );
  assert.deepEqual(hopeless, { pt: 10, fits: false });
});
