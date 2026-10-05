/**
 * The image-text slide's native mapper in the editable PPTX (B588 PR 2): the
 * picture fills its column as the canvas grid places it, and the heading and
 * body are text beside it, the heading as the slide's title.
 *
 * Runs without a browser or network: the mapper reads the local asset and
 * never renders a slide. The asset is 1200x630, wider than every column
 * below, so a cover crop cuts left and right and a contained picture leaves
 * room above and below.
 *
 * Run with: node --test tests/export-pptx-image-text-slide.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { initSanitizer } from '../shared/sanitize.js';

await initSanitizer();

const { buildEditablePptxBuffer, PPTX_HANDLER_TYPES } =
  await import('../server/export/pptx.js');
const { PPTX_LAYOUTS, layoutBox } =
  await import('../server/export/pptx-theme.js');
const { SLIDE_TYPES } = await import('../shared/slide-types/registry.js');
const { imageTextAltText } =
  await import('../shared/slide-types/types/image-text-slide/image.js');
const { seedThemeConfig } = await import('./helpers/theme-seed.js');

const repoRoot = '.';
const IMAGE = '/assets/images/slides-previewimage.png';
const EMU = 914400;
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const pad = layoutBox('headingBody', 'title').x;

const theme = await seedThemeConfig('midnight');

/** Export one image-text slide and return the parts the assertions read. */
async function exportSlide(content, { lang = 'en-GB' } = {}) {
  const built = await buildEditablePptxBuffer(
    repoRoot,
    {
      id: 'image-text-deck',
      title: 'Image text',
      lang,
      slides: [{ id: 's1', type: 'image-text-slide', content }],
    },
    { theme },
  );
  const zip = await JSZip.loadAsync(Buffer.from(built.buffer));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const rels = await zip
    .file('ppt/slides/_rels/slide1.xml.rels')
    .async('string');
  const layoutFile = /slideLayouts\/(slideLayout\d+\.xml)/.exec(rels)?.[1];
  const layoutXml = await zip
    .file(`ppt/slideLayouts/${layoutFile}`)
    .async('string');
  return {
    built,
    xml,
    layout: /<p:cSld name="([^"]*)"/.exec(layoutXml)?.[1],
  };
}

/** A shape's frame in inches. */
function frameOf(part) {
  const off = /<a:off x="(\d+)" y="(\d+)"\/>/.exec(part);
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(part);
  return {
    x: Number(off[1]) / EMU,
    y: Number(off[2]) / EMU,
    w: Number(ext[1]) / EMU,
    h: Number(ext[2]) / EMU,
  };
}

/** The slide's one picture: its frame, crop and description. */
function picture(xml) {
  const pics = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((m) => m[0]);
  assert.equal(pics.length, 1, 'the slide holds one picture');
  const pic = pics[0];
  const crop =
    /<a:srcRect l="(-?\d+)" r="(-?\d+)" t="(-?\d+)" b="(-?\d+)"\/>/.exec(pic);
  return {
    ...frameOf(pic),
    crop: crop
      ? {
          l: Number(crop[1]),
          r: Number(crop[2]),
          t: Number(crop[3]),
          b: Number(crop[4]),
        }
      : null,
    descr: /<p:cNvPr [^>]*descr="([^"]*)"/.exec(pic)?.[1] ?? '',
    decorative: pic.includes('adec:decorative'),
  };
}

/** The `<a:t>` texts of a part, in order. */
function texts(xml) {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]);
}

/** The shape that is the slide's title placeholder. */
function titleShape(xml) {
  const shape = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)]
    .map((m) => m[0])
    .find((sp) => /<p:ph[^>]*type="title"/.test(sp));
  assert.ok(shape, 'the slide has a title placeholder');
  return shape;
}

function near(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) < 0.01,
    `${label}: ${actual.toFixed(3)} is not ${expected.toFixed(3)}`,
  );
}

test('image-text has a composition of its own and claims an editable slide', () => {
  assert.ok(PPTX_HANDLER_TYPES.includes('image-text-slide'));
  assert.equal(SLIDE_TYPES['image-text-slide'].fidelity.pptx, 'native');
});

test('a half split puts a cover picture edge to edge in the left column and the copy beside it', async () => {
  const { built, xml, layout } = await exportSlide({
    title: 'The harbour at dawn',
    body: 'Ships come in **early**.\n\n- Cranes\n- Tugs',
    image: IMAGE,
    alt: 'Boats in a harbour',
  });
  assert.deepEqual(built.imageSlides, [], 'the slide is not an image');
  assert.deepEqual(built.warnings, []);
  assert.equal(layout, PPTX_LAYOUTS.headingBody);

  const pic = picture(xml);
  near(pic.x, 0, 'x');
  near(pic.y, 0, 'y');
  near(pic.w, SLIDE_W / 2, 'w');
  near(pic.h, SLIDE_H, 'h');
  // 1200x630 scaled to the column's height is wider than the column: the
  // crop takes the same share off left and right, nothing off top or bottom.
  assert.ok(pic.crop, 'the picture carries a crop');
  assert.equal(pic.crop.t, 0);
  assert.equal(pic.crop.b, 0);
  assert.ok(pic.crop.l > 10000, `left crop ${pic.crop.l}`);
  assert.ok(Math.abs(pic.crop.l - pic.crop.r) <= 1, 'centred crop');
  assert.equal(pic.descr, 'Boats in a harbour');

  const title = titleShape(xml);
  assert.deepEqual(texts(title), ['The harbour at dawn']);
  assert.match(title, /<a:pPr[^>]*algn="l"/, 'the title is set left');
  const box = frameOf(title);
  near(box.x, SLIDE_W / 2 + pad, 'the title sits in the copy column');
  near(box.w, SLIDE_W / 2 - 2 * pad, 'inside its padding');
  assert.ok(
    box.y > pad + 0.5,
    `a short copy is balanced on the column's middle (y ${box.y})`,
  );
  for (const word of ['Ships come in ', 'early', '.', 'Cranes', 'Tugs']) {
    assert.ok(texts(xml).includes(word), `the body says "${word}"`);
  }
});

test('the body starts at the step the canvas sets for its width and density', async () => {
  // One short line fits at the cap, so its size is the step itself:
  // `10-image-text.css` sets lg, xl beside a narrow picture, one step down
  // on a compact slide.
  const bodySize = async (extra) => {
    const { xml } = await exportSlide({
      title: 'Sizes',
      body: 'One short line.',
      image: IMAGE,
      ...extra,
    });
    const shape = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)]
      .map((m) => m[0])
      .find((sp) => sp.includes('One short line.'));
    return Number(/<a:rPr[^>]*\ssz="(\d+)"/.exec(shape)[1]) / 100;
  };
  const half = await bodySize({});
  const narrow = await bodySize({ imageWidth: 'narrow' });
  const halfCompact = await bodySize({ density: 'compact' });
  const narrowCompact = await bodySize({
    imageWidth: 'narrow',
    density: 'compact',
  });
  // The budget rounds to its own steps, so the test reads the order.
  assert.ok(narrow > half, `narrow (xl, ${narrow}) above half (lg, ${half})`);
  assert.ok(
    halfCompact < half,
    `compact (md, ${halfCompact}) below half (lg, ${half})`,
  );
  assert.equal(narrowCompact, half, 'narrow and compact is lg again');
});

test('imageSide and imageWidth move and size the column', async () => {
  const { xml } = await exportSlide({
    title: 'Wide on the right',
    body: 'Copy',
    image: IMAGE,
    imageSide: 'right',
    imageWidth: 'wide',
  });
  const pic = picture(xml);
  near(pic.x, SLIDE_W * 0.37, 'x');
  near(pic.w, SLIDE_W * 0.63, 'w');
  near(frameOf(titleShape(xml)).x, pad, 'the copy goes left');
});

test('the corner layout keeps the picture in the top corner and the copy at the top', async () => {
  const { xml } = await exportSlide({
    title: 'Corner',
    body: 'Little text',
    image: IMAGE,
    layout: 'corner',
    imageSide: 'right',
  });
  const pic = picture(xml);
  near(pic.x, SLIDE_W * 0.55, 'x');
  near(pic.w, SLIDE_W * 0.45, 'w');
  near(pic.h, SLIDE_H * 0.58, 'h');
  near(frameOf(titleShape(xml)).y, pad, 'the copy starts at the top');
});

test('a contained picture keeps its ratio on a white plate inside the column', async () => {
  const { xml } = await exportSlide({
    title: 'Contained',
    body: 'Copy',
    image: IMAGE,
    fit: 'contain',
  });
  const pic = picture(xml);
  assert.equal(pic.crop, null, 'nothing is cropped');
  near(pic.w / pic.h, 1200 / 630, 'keeps its ratio');
  const inset = (SLIDE_W * 24) / 1600;
  near(pic.w, SLIDE_W / 2 - 2 * inset, 'fills the padded column width');
  assert.match(
    xml,
    /<a:prstGeom prst="rect">[\s\S]*?<a:srgbClr val="FFFFFF"\/>/,
    'a white plate',
  );

  const { xml: matched } = await exportSlide({
    title: 'Contained',
    image: IMAGE,
    fit: 'contain',
    imageBackground: 'match',
  });
  assert.equal(
    matched.includes('<a:srgbClr val="FFFFFF"/>'),
    false,
    'no plate when the image background matches the slide',
  );
});

test('the caption is a chip and the alt text falls back to it, as on the canvas', async () => {
  const content = {
    title: 'Harbour',
    body: 'Copy',
    image: IMAGE,
    caption: 'Rotterdam, 2026',
  };
  const { xml } = await exportSlide(content);
  assert.ok(texts(xml).includes('Rotterdam, 2026'), 'the caption is text');
  assert.match(xml, /<a:alpha val="45000"\/>/, 'the caption sits on a scrim');
  assert.equal(picture(xml).descr, 'Rotterdam, 2026');

  const html = SLIDE_TYPES['image-text-slide'].renderHtml(content, {}, {});
  assert.match(html, /<img [^>]*alt="Rotterdam, 2026"/);
  assert.equal(imageTextAltText(content), 'Rotterdam, 2026');
});

test('a decorative picture is marked decorative and has no description', async () => {
  const { xml } = await exportSlide({
    title: 'Mood',
    image: IMAGE,
    imageRole: 'decorative',
    alt: 'ignored',
  });
  const pic = picture(xml);
  assert.equal(pic.descr, '');
  assert.ok(pic.decorative);
});

test('an empty column shows the placeholder in the deck language', async () => {
  const { xml, built } = await exportSlide(
    { title: 'Later', body: 'Copy' },
    { lang: 'nl' },
  );
  assert.equal(xml.includes('<p:pic>'), false, 'no picture');
  assert.ok(texts(xml).includes('Afbeelding'), texts(xml).join(' | '));
  assert.deepEqual(built.warnings, []);
});

test('a picture that cannot travel leaves its alt text and a warning', async () => {
  const { xml, built } = await exportSlide({
    title: 'Map',
    image: '/assets/images/does-not-exist.png',
    alt: 'A missing map',
  });
  assert.equal(xml.includes('<p:pic>'), false, 'no picture');
  assert.ok(texts(xml).includes('A missing map'));
  assert.match(built.warnings.join('\n'), /could not be embedded/);
});
