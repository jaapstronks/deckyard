/**
 * The image slide's native mapper in the editable PPTX (B588 PR 1): the
 * picture is framed, cropped and placed as the canvas does it, and the words
 * around it are text.
 *
 * Runs without a browser or network: an image slide that claims `native` takes
 * its own composition, which reads the local asset and never renders a slide.
 * The asset is 1200x630, wider than every frame below, so a cover crop cuts
 * top and bottom and a contained picture leaves room left and right.
 *
 * Run with: node --test tests/export-pptx-image-slide.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { buildEditablePptxBuffer } from '../server/export/pptx.js';
import { PPTX_LAYOUTS, layoutBox } from '../server/export/pptx-theme.js';
import { seedThemeConfig } from './helpers/theme-seed.js';

const repoRoot = '.';
const IMAGE = '/assets/images/slides-previewimage.png';
const EMU = 914400;
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

const theme = await seedThemeConfig('midnight');

/** Export one image slide and return the parts the assertions read. */
async function exportSlide(content, { lang = 'en-GB' } = {}) {
  const built = await buildEditablePptxBuffer(
    repoRoot,
    {
      id: 'image-deck',
      title: 'Image',
      lang,
      slides: [{ id: 's1', type: 'image-slide', content }],
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
    rels,
    layout: /<p:cSld name="([^"]*)"/.exec(layoutXml)?.[1],
  };
}

/** The slide's one picture: its frame in inches, its crop and description. */
function picture(xml) {
  const pics = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((m) => m[0]);
  assert.equal(pics.length, 1, 'the slide holds one picture');
  const pic = pics[0];
  const off = /<a:off x="(\d+)" y="(\d+)"\/>/.exec(pic);
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic);
  const crop =
    /<a:srcRect l="(-?\d+)" r="(-?\d+)" t="(-?\d+)" b="(-?\d+)"\/>/.exec(pic);
  return {
    x: Number(off[1]) / EMU,
    y: Number(off[2]) / EMU,
    w: Number(ext[1]) / EMU,
    h: Number(ext[2]) / EMU,
    crop: crop
      ? {
          l: Number(crop[1]),
          r: Number(crop[2]),
          t: Number(crop[3]),
          b: Number(crop[4]),
        }
      : null,
    descr: /<p:cNvPr [^>]*descr="([^"]*)"/.exec(pic)?.[1] ?? '',
  };
}

/** The `<a:t>` texts of a part, in order. */
function texts(xml) {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]);
}

/** The shape that fills the layout's title placeholder. */
function titlePlaceholder(xml) {
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

/** The non-bleed frame under a title: the padded column, from under the title box down to the padding. */
const pad = layoutBox('headingBody', 'title').x;
const titleBox = layoutBox('headingBody', 'title');
const bodyTop = titleBox.y + titleBox.h;
const column = {
  x: pad,
  y: bodyTop,
  w: SLIDE_W - 2 * pad,
  h: SLIDE_H - pad - bodyTop,
};

test('a cover picture fills the column under its heading and crops top and bottom', async () => {
  const { built, xml, rels, layout } = await exportSlide({
    title: 'The harbour at dawn',
    image: IMAGE,
    alt: 'Boats in a harbour',
    caption: 'Rotterdam, 2026',
  });
  assert.deepEqual(built.imageSlides, [], 'the slide is not an image');
  assert.equal(layout, PPTX_LAYOUTS.headingBody);

  const pic = picture(xml);
  near(pic.x, column.x, 'x');
  near(pic.y, column.y, 'y');
  near(pic.w, column.w, 'w');
  near(pic.h, column.h, 'h');
  // 1200x630 scaled to the column's width is taller than the column: the
  // crop takes the same share off top and bottom, nothing off the sides.
  assert.ok(pic.crop, 'the picture carries a crop');
  assert.equal(pic.crop.l, 0);
  assert.equal(pic.crop.r, 0);
  assert.ok(pic.crop.t > 5000, `top crop ${pic.crop.t}`);
  assert.ok(Math.abs(pic.crop.t - pic.crop.b) <= 1, 'centred crop');
  assert.equal(pic.descr, 'Boats in a harbour');

  assert.match(rels, /relationships\/image" Target="\.\.\/media\/[^"]+"/);
  assert.deepEqual(
    texts(titlePlaceholder(xml)),
    ['The harbour at dawn'],
    'the title is in the title placeholder',
  );
  assert.ok(texts(xml).includes('Rotterdam, 2026'), 'the caption is text');
  assert.match(xml, /<a:alpha val="45000"\/>/, 'the caption sits on a scrim');
});

test('the focus decides what a cover crop keeps', async () => {
  const { xml } = await exportSlide({
    title: 'Sky',
    image: IMAGE,
    focusX: 50,
    focusY: 0,
  });
  const { crop } = picture(xml);
  assert.equal(crop.t, 0, 'focus at the top keeps the top edge');
  assert.ok(crop.b > 10000, `bottom crop ${crop.b}`);
});

test('a contained picture keeps its ratio and sits where the focus puts it', async () => {
  const { xml } = await exportSlide({
    image: IMAGE,
    fit: 'contain',
    focusX: 0,
  });
  const pic = picture(xml);
  // No heading: the frame is the whole padded slide.
  const box = { x: pad, y: pad, w: SLIDE_W - 2 * pad, h: SLIDE_H - 2 * pad };
  assert.equal(pic.crop, null, 'nothing is cropped');
  near(pic.h, box.h, 'fills the height');
  near(pic.w / pic.h, 1200 / 630, 'keeps its ratio');
  near(pic.x, box.x, 'focus 0 puts it against the left edge');
});

test('a bleed picture fills the slide and its heading overlays it on a scrim', async () => {
  const { xml } = await exportSlide({
    title: 'Edge to edge',
    subheading: 'and nothing around it',
    bottomSubheading: 'Low on the picture',
    image: IMAGE,
    bleed: true,
  });
  const pic = picture(xml);
  near(pic.x, 0, 'x');
  near(pic.y, 0, 'y');
  near(pic.w, SLIDE_W, 'w');
  near(pic.h, SLIDE_H, 'h');
  assert.deepEqual(
    texts(titlePlaceholder(xml)),
    [],
    'the heading overlays the picture, not in the title placeholder',
  );
  assert.deepEqual(texts(xml), [
    'Edge to edge',
    'and nothing around it',
    'Low on the picture',
  ]);
  assert.equal(
    [...xml.matchAll(/<a:alpha val="45000"\/>/g)].length,
    2,
    'two chips: the heading and the bottom subheading',
  );
  assert.match(xml, /<a:srgbClr val="FFFFFF"\/>/, 'light text on the scrim');
});

test('a decorative picture has no description', async () => {
  const { xml } = await exportSlide({
    image: IMAGE,
    imageRole: 'decorative',
    alt: 'ignored',
  });
  assert.equal(picture(xml).descr, '');
});

test('an empty frame shows the placeholder in the deck language', async () => {
  const { xml, built } = await exportSlide({ title: 'Later' }, { lang: 'nl' });
  assert.equal(xml.includes('<p:pic>'), false, 'no picture');
  assert.ok(texts(xml).includes('Afbeelding'), texts(xml).join(' | '));
  assert.deepEqual(built.warnings, []);
});

test('a picture that cannot travel leaves its alt text and a warning', async () => {
  const { xml, built } = await exportSlide({
    image: '/assets/images/does-not-exist.png',
    alt: 'A missing map',
  });
  assert.equal(xml.includes('<p:pic>'), false, 'no picture');
  assert.ok(texts(xml).includes('A missing map'));
  assert.match(built.warnings.join('\n'), /could not be embedded/);
});
