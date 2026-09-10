/**
 * The theme as a PPTX template: what the layouts actually carry (B264, D106).
 *
 * Why this file runs without a browser: the template holds no slides, so
 * nothing here goes near `renderSlideToPngBuffer` and the whole build is
 * pptxgenjs plus one sharp rasterization. That is the point of pinning it on
 * the XML — the four theme values D106 promises (ground, fonts, text colours,
 * logo) are exactly the four an eyeball on a rendered thumbnail cannot verify,
 * and the fifth claim (the logo is a raster, never SVG bytes under a .png name)
 * is only visible in the package.
 *
 * Run with: node --test tests/export-pptx-theme-master.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import {
  PPTX_LAYOUTS,
  buildThemeTemplateBuffer,
  rasterThemeLogo,
  resolveThemeMaster,
  themeLayoutDefinitions,
} from '../server/export/pptx-theme.js';
import { loadDeckTheme } from '../server/utils/themes.js';

const repoRoot = '.';

/** `midnight`: a dark ground, so a text colour that failed to land is visible. */
async function midnightZip() {
  const theme = await loadDeckTheme(repoRoot, 'midnight');
  const buffer = await buildThemeTemplateBuffer(repoRoot, theme);
  return { theme, zip: await JSZip.loadAsync(Buffer.from(buffer)) };
}

/** Every slide layout part, in package order. */
async function layoutXml(zip) {
  const names = Object.keys(zip.files)
    .filter((f) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f))
    .sort();
  return Promise.all(names.map((n) => zip.file(n).async('string')));
}

test('the theme names the layouts, and there are three of them', async () => {
  const { zip } = await midnightZip();
  const names = (await layoutXml(zip)).map(
    (xml) => xml.match(/<p:cSld name="([^"]*)"/)?.[1],
  );
  for (const wanted of Object.values(PPTX_LAYOUTS)) {
    assert.ok(
      names.includes(wanted),
      `layout "${wanted}" should be in the package, got ${JSON.stringify(names)}`,
    );
  }
});

test("the ground is the theme's, not a guess", async () => {
  const { theme, zip } = await midnightZip();
  // Read the expectation from the theme rather than hardcoding it: the whole
  // point of resolving `--t-slide-bg-<id>` is that `lime` is near-black under
  // midnight and white under another theme.
  const expected = resolveThemeMaster(theme).background;
  assert.equal(expected, '18181B', 'midnight paints its default ground dark');

  for (const xml of await layoutXml(zip)) {
    const name = xml.match(/<p:cSld name="([^"]*)"/)?.[1];
    if (name === 'DEFAULT') continue; // pptxgenjs' own untouched layout
    assert.match(
      xml,
      new RegExp(`<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${expected}"`),
      `layout "${name}" should paint the theme's ground`,
    );
  }
});

test('every placeholder names its own colour and typeface', async () => {
  const { zip } = await midnightZip();
  for (const xml of await layoutXml(zip)) {
    const name = xml.match(/<p:cSld name="([^"]*)"/)?.[1];
    if (name === 'DEFAULT') continue;
    // Only the text-bearing placeholders: the image placeholder carries an
    // empty run-properties element, which is correct — it holds a picture.
    const runProps = [...xml.matchAll(/<a:defRPr[\s\S]*?<\/a:defRPr>/g)]
      .map((m) => m[0])
      .filter((rpr) => rpr.includes('sz="'));
    assert.ok(
      runProps.length,
      `layout "${name}" should carry placeholder run properties`,
    );
    for (const rpr of runProps) {
      // There is no theme text colour in OOXML — pptxgenjs writes hard-coded
      // black for a run that names none, which on this ground is invisible.
      assert.match(
        rpr,
        /<a:srgbClr val="FAFAFA"\/>/,
        `layout "${name}": a placeholder without the theme's text colour would render black on a dark ground`,
      );
      assert.match(
        rpr,
        /<a:latin typeface="(Space Grotesk|Inter)"/,
        `layout "${name}": a placeholder should name one of the theme's faces`,
      );
    }
  }
});

test("the document theme carries the theme's font families", async () => {
  const { zip } = await midnightZip();
  const xml = await zip.file('ppt/theme/theme1.xml').async('string');
  assert.match(
    xml,
    /<a:majorFont><a:latin typeface="Space Grotesk"\/>/,
    'the heading face should be the document theme major font',
  );
  assert.match(
    xml,
    /<a:minorFont><a:latin typeface="Inter"\/>/,
    'the body face should be the document theme minor font',
  );
});

test('the logo travels as real PNG bytes, never as SVG', async () => {
  const { zip } = await midnightZip();
  const media = Object.keys(zip.files).filter(
    (f) => f.startsWith('ppt/media/') && !zip.files[f].dir,
  );
  assert.ok(media.length, 'the template should embed the theme mark');
  for (const name of media) {
    assert.match(name, /\.png$/, `${name} should be a PNG part`);
    const buf = await zip.file(name).async('nodebuffer');
    // The trap B232 measured: pptxgenjs writes SVG bytes under a .png name as
    // the raster fallback for an SVG image, which every non-PowerPoint renderer
    // draws as a broken-image box.
    assert.equal(
      buf.subarray(0, 8).toString('hex'),
      '89504e470d0a1a0a',
      `${name} should start with the PNG signature, not SVG text`,
    );
  }
  // And nothing reached for the svgBlip extension either.
  for (const xml of await layoutXml(zip)) {
    assert.ok(
      !xml.includes('svgBlip'),
      'a layout should not carry an SVG blip extension',
    );
  }
});

test('the template holds layouts and no slides', async () => {
  const { zip } = await midnightZip();
  const slides = Object.keys(zip.files).filter((f) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(f),
  );
  assert.deepEqual(slides, [], 'a template is a starting document, not a deck');
});

test('a theme that names no ground, fonts or mark still yields layouts', async () => {
  // The fork case: a theme stripped to nothing must not throw or emit an
  // invalid colour — it falls back to the same values the stylesheet does.
  const spec = resolveThemeMaster({});
  assert.equal(spec.background, 'FFFFFF');
  assert.equal(spec.text, '0B0B0B');
  assert.equal(spec.headFont, '');
  const layouts = themeLayoutDefinitions(spec, null);
  assert.equal(layouts.length, 3);
  for (const layout of layouts) {
    assert.equal(layout.background.color, 'FFFFFF');
    for (const obj of layout.objects) {
      if (!obj.placeholder) continue;
      if (obj.placeholder.options.type === 'pic') continue;
      assert.equal(obj.placeholder.options.color, '0B0B0B');
      assert.equal(
        obj.placeholder.options.fontFace,
        undefined,
        'no face is better than an invented one — the document theme decides',
      );
    }
  }
});

test('the type scale follows the theme, including its own multiplier', async () => {
  const plain = resolveThemeMaster({ cssVars: {} });
  const scaled = resolveThemeMaster({
    cssVars: { '--t-slide-text-scale': '1.25' },
  });
  assert.equal(plain.textScale, 1);
  assert.equal(scaled.textScale, 1.25);

  const titleOf = (spec) =>
    themeLayoutDefinitions(spec, null)
      .find((l) => l.title === PPTX_LAYOUTS.title)
      .objects.find((o) => o.placeholder?.options?.name === 'title').placeholder
      .options.fontSize;

  // 80 reference px is 48pt on the exported slide; the theme's multiplier
  // moves type and nothing else.
  assert.equal(titleOf(plain), 48);
  assert.equal(titleOf(scaled), 60);
});

test('a font token that points at another token is followed', async () => {
  // Themes write `--t-font-caption: var(--t-font-body)`; a reader that stops at
  // the first value would name the family `var(--t-font-body)`.
  const spec = resolveThemeMaster({
    cssVars: {
      '--t-font-body': "'Work Sans', sans-serif",
      '--t-font-heading': 'var(--t-font-body)',
    },
  });
  assert.equal(spec.headFont, 'Work Sans');
  assert.equal(spec.bodyFont, 'Work Sans');
});

test('a theme variant ground is read from the variant, not the built-in slots', async () => {
  const spec = resolveThemeMaster({
    defaultBackground: 'calm',
    slideBackgrounds: [
      { id: 'calm', label: 'Calm', value: '#140A26', textColor: '#FFFFFF' },
    ],
    cssVars: { '--t-slide-bg-lime': '#ffffff', '--t-color-text': '#0b0b0b' },
  });
  assert.equal(spec.groundId, 'calm');
  assert.equal(spec.background, '140A26');
  assert.equal(
    spec.text,
    'FFFFFF',
    "a variant's declared text colour outranks the theme's page text",
  );
});

test('the boxes of a layout keep clear of each other and of the logo', async () => {
  // Handoff step 3 of the #1128 review, pinned rather than eyeballed: the
  // image slot of the third layout must not run into the body beside it, and
  // the bottom-right mark must sit below every text box on every layout. The
  // definitions carry inches, so the check needs no package. Two marks are
  // tried: the theme's real one, and the largest `rasterThemeLogo` can hand
  // back — the full 150x44 reference-pixel corner box.
  const theme = await loadDeckTheme(repoRoot, 'midnight');
  const spec = resolveThemeMaster(theme);
  const real = await rasterThemeLogo(repoRoot, spec.logoUrl);
  assert.ok(real, 'midnight ships a local mark');
  const fullBox = { data: real.data, w: 1.25, h: 0.3667 };

  const rectOf = (o) =>
    o.placeholder ? o.placeholder.options : o.image ? o.image : null;
  const overlaps = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  for (const logo of [real, fullBox]) {
    for (const layout of themeLayoutDefinitions(spec, logo)) {
      const boxes = layout.objects.map(rectOf).filter(Boolean);
      const names = layout.objects
        .filter((o) => o.placeholder)
        .map((o) => o.placeholder.options.name);
      assert.equal(
        new Set(names).size,
        names.length,
        `layout "${layout.title}": a placeholder name is the address PR 3 writes to, so it must be unique`,
      );
      for (const b of boxes) {
        assert.ok(
          b.x >= 0 && b.y >= 0 && b.x + b.w <= 13.334 && b.y + b.h <= 7.501,
          `layout "${layout.title}": a box runs off the slide`,
        );
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          assert.ok(
            !overlaps(boxes[i], boxes[j]),
            `layout "${layout.title}": boxes ${i} and ${j} overlap`,
          );
        }
      }
    }
  }
});
