/**
 * Export smoke test — the only test in the suite that starts a real browser.
 *
 * Why this exists: `puppeteer-core` deliberately ships without a browser, so
 * for a long time nothing in CI could launch Chrome, and PDF/PNG/PPTX export,
 * deck thumbnails and the sandbox OG image ran completely unguarded. That bit
 * during the puppeteer-core 24→25 bump (#275): CI was green and that said
 * nothing at all about whether export still worked. This is the gate that
 * makes green mean something.
 *
 * What it covers (form 1 of docs/plans/TODO.md B14 — the smoke test):
 *   - Chrome actually launches from the export chain's own resolver.
 *   - The PDF path yields a real `%PDF-` document with one page per slide and
 *     extractable text — i.e. not a blank page.
 *   - The PNG path yields a correctly sized image that is not blank: many
 *     distinct colours, and no single colour covering the whole frame.
 *   - PPTX embeds those Chrome-rendered PNGs, and the sandbox OG image renders.
 *
 * What it deliberately does NOT cover: a silent visual regression such as a
 * webfont failing to load and falling back to a system font. Catching that
 * needs pixel comparison against recorded baselines (form 2 in B14), which is
 * a separate decision — it is notoriously brittle across platforms, and the
 * ubuntu CI runner rasterises differently from a Mac.
 *
 * Requires a Chrome/Chromium binary. In CI that is provisioned explicitly by
 * .github/workflows/ci.yml (see docs/developer/export-smoke-test.md); locally
 * the tests skip when no browser is installed, so a contributor without Chrome
 * does not get a false red. In CI a missing browser is a hard failure — a
 * smoke test that silently skips itself is worse than no smoke test.
 *
 * Run with: node --test tests/export-chrome-smoke.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import sharp from 'sharp';

import {
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';
import { renderSlidesToPdfBuffer } from '../server/render/pdf.js';
import { renderSlideToPngBuffer } from '../server/render/png.js';
import { buildPptxBuffer } from '../server/export/pptx.js';
import { renderSandboxOgImagePng } from '../server/utils/sandbox-og-image.js';
import { parsePdf } from '../server/utils/convert-file/pdf-parser.js';
import { loadThemeAssets } from '../server/utils/themes.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());

/**
 * Skip locally when no browser is installed; never skip in CI, where the
 * absence of a browser is exactly the regression this file guards against.
 */
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

const TITLE = 'Export smoke test';
const SUBHEADING = 'One slide, all the way through headless Chrome';

/** A single slide is enough: this proves the chain runs, not that it is pretty. */
function smokeSlide() {
  return {
    type: 'title-slide',
    content: { title: TITLE, subheading: SUBHEADING, background: 'lime' },
  };
}

function smokeDeck() {
  return { title: 'Export smoke', theme: 'default', slides: [smokeSlide()] };
}

/** Collapse every whitespace run to a single space, so line breaks stop mattering. */
function flattenSpace(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * Count distinct RGB values and the share of the most common one.
 *
 * A blank render collapses to a single colour covering the entire frame; a
 * render with actual type and chrome on it spreads over hundreds of colours
 * through antialiasing alone. Both numbers together separate "blank" from
 * "rendered" far more reliably than a byte-length check.
 */
async function colorProfile(pngBuffer) {
  const { data, info } = await sharp(pngBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(rgb, (counts.get(rgb) || 0) + 1);
  }
  let dominant = 0;
  for (const n of counts.values()) if (n > dominant) dominant = n;
  return {
    unique: counts.size,
    dominantShare: dominant / (info.width * info.height),
  };
}

after(async () => {
  // The shared browser is cached for the process lifetime, so without this the
  // test runner would sit on a live Chrome child and never exit.
  await closePuppeteerBrowser();
});

test(
  'a Chrome/Chromium binary is available to the export chain',
  { skip },
  () => {
    assert.ok(
      chromePath,
      'export needs a browser and puppeteer-core does not bundle one — CI must ' +
        'provision Chrome (see .github/workflows/ci.yml) or set PUPPETEER_EXECUTABLE_PATH',
    );
  },
);

test('PDF export produces a real, non-blank PDF', { skip }, async () => {
  const theme = await loadThemeAssets(repoRoot, 'default');
  const buf = await renderSlidesToPdfBuffer(repoRoot, smokeDeck(), { theme });

  assert.ok(
    Buffer.isBuffer(buf),
    'export should return a Node Buffer, not a bare Uint8Array',
  );
  assert.equal(
    buf.subarray(0, 5).toString('latin1'),
    '%PDF-',
    'output must carry the PDF magic header',
  );
  assert.ok(
    buf.length > 4096,
    `a rendered slide should be more than a stub PDF (got ${buf.length} bytes)`,
  );

  // Text extraction is the non-blank check: a PDF whose page never painted
  // still has a valid header, but yields no text.
  const parsed = await parsePdf(Buffer.from(buf));
  assert.deepEqual(parsed.errors, [], 'the PDF should parse without errors');
  assert.equal(parsed.slides.length, 1, 'one slide in → one page out');
  // Collapse whitespace before matching: where a line wraps is a function of
  // font metrics, so the ubuntu CI runner breaks the subheading in a different
  // place than a Mac does. The assertion is "this text rendered", not "it
  // rendered on one line".
  const text = flattenSpace(parsed.slides[0]?.textContent || '');
  assert.ok(
    text.includes(TITLE),
    `page text should contain the slide title, got: ${text}`,
  );
  assert.ok(
    text.includes(flattenSpace(SUBHEADING)),
    `page text should contain the subheading, got: ${text}`,
  );
});

test(
  'PNG export produces a correctly sized, non-blank image',
  { skip },
  async () => {
    const theme = await loadThemeAssets(repoRoot, 'default');
    const buf = await renderSlideToPngBuffer(repoRoot, smokeSlide(), {
      scale: 2,
      theme,
    });

    assert.ok(
      Buffer.isBuffer(buf),
      'export should return a Node Buffer, not a bare Uint8Array',
    );
    const meta = await sharp(buf).metadata();
    assert.equal(meta.format, 'png');
    // 1600×900 at deviceScaleFactor 2 — also asserts the scale option is honored.
    assert.equal(
      meta.width,
      3200,
      'PNG width should be the 16:9 frame at scale 2',
    );
    assert.equal(
      meta.height,
      1800,
      'PNG height should be the 16:9 frame at scale 2',
    );

    const { unique, dominantShare } = await colorProfile(buf);
    assert.ok(
      unique >= 64,
      `a blank frame has one colour; a rendered slide has hundreds (got ${unique})`,
    );
    assert.ok(
      dominantShare < 0.98,
      `no single colour should cover the frame (most common colour: ${(dominantShare * 100).toFixed(2)}%)`,
    );
  },
);

/**
 * Order matters here, and not by accident: the PDF test above runs pdf-parse
 * first, which loads pdf.js, which polyfills `Uint8Array.fromBase64`. Puppeteer
 * then stops handing back Node Buffers, and PPTX export — which base64-encodes
 * the render — used to produce garbage. Running PPTX after PDF in the same
 * process keeps that regression covered.
 */
test(
  'PPTX export embeds the Chrome-rendered slide image',
  { skip },
  async () => {
    const theme = await loadThemeAssets(repoRoot, 'default');
    const { buffer } = await buildPptxBuffer(repoRoot, smokeDeck(), {
      scale: 1,
      theme,
    });

    // Explicit bytes rather than a string literal: a .pptx starts with the
    // local-file-header magic PK\x03\x04.
    assert.ok(
      Buffer.from(buffer)
        .subarray(0, 4)
        .equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
      'a .pptx should be a zip container',
    );

    const zip = await JSZip.loadAsync(Buffer.from(buffer));
    assert.ok(
      zip.file('ppt/slides/slide1.xml'),
      'the deck should contain one slide part',
    );

    // Directory entries share the prefix; only real files carry the render.
    const media = Object.keys(zip.files).filter(
      (name) => name.startsWith('ppt/media/') && !zip.files[name].dir,
    );
    assert.ok(
      media.length >= 1,
      'the slide image should be embedded as a media part',
    );
    const imageBytes = await zip.file(media[0]).async('nodebuffer');
    assert.ok(
      imageBytes.length > 4096,
      `the embedded render should not be an empty image (got ${imageBytes.length} bytes)`,
    );
    // Same non-blank check as the PNG case: a .pptx full of white rectangles is
    // structurally valid and useless.
    const { unique } = await colorProfile(imageBytes);
    assert.ok(
      unique >= 64,
      `the embedded slide image should not be blank (got ${unique} colours)`,
    );
  },
);

test(
  'the sandbox OG image renders at its social-card size',
  { skip },
  async () => {
    const buf = await renderSandboxOgImagePng();

    const meta = await sharp(buf).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.width, 1200);
    assert.equal(meta.height, 630);

    const { unique, dominantShare } = await colorProfile(buf);
    assert.ok(
      unique >= 64,
      `OG image should not be a flat fill (got ${unique} colours)`,
    );
    assert.ok(
      dominantShare < 0.98,
      `OG image should not be a single colour (most common: ${(dominantShare * 100).toFixed(2)}%)`,
    );
  },
);
