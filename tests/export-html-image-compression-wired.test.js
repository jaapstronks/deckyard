import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { buildStandaloneHtml } from '../server/export/html.js';
import {
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';

/**
 * Regression guard for the *seam*, not the transform (B717).
 *
 * `tests/export-pdf-image-compression-wired.test.js` pins the PDF route; this
 * pins the standalone HTML document, which serves two outputs: the HTML
 * download (`context: 'export'`) and the published `/p/` page
 * (`context: 'published'`). Both inlined every image at source resolution: a
 * deck of 48 photos of 4.8 MB came out at 307 MB as a download and 322 MB per
 * visitor as a published page. The difference is entirely whether
 * `buildStandaloneHtml`'s embed passes still pass `transform`.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * A large opaque photo-like PNG: mid-frequency content so PNG can't deflate it
 * away but JPEG compresses it well — the case the export pipeline targets.
 */
async function bigOpaquePng(px) {
  const pixels = Buffer.alloc(px * px * 3);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = ((i * 2654435761) ^ (i >> 3)) & 0xff;
  }
  return sharp(pixels, { raw: { width: px, height: px, channels: 3 } })
    .blur(6)
    .png()
    .toBuffer();
}

/** Write a throwaway upload under the real repo root and return [url, cleanup]. */
async function withUpload(buf) {
  const name = `test-html-compress-${randomUUID()}.png`;
  const dir = path.join(repoRoot, 'server', 'uploads');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, buf);
  return [`/uploads/${name}`, () => fs.rm(file, { force: true })];
}

function dataUrlPayloads(html, mime) {
  const re = new RegExp(
    `data:${mime.replace('/', '\\/')};base64,([A-Za-z0-9+/=]+)`,
    'g',
  );
  return [...html.matchAll(re)].map((m) => m[1]);
}

function photoDeck(id, url) {
  return {
    id,
    title: 'Compression seam',
    theme: 'default',
    lang: 'en',
    slides: [
      {
        id: 's1',
        type: 'image-slide',
        content: { title: 'Photo', image: url },
      },
    ],
  };
}

for (const context of ['export', 'published']) {
  test(`standalone HTML (${context}) applies image compression to embedded slide images`, async () => {
    const raw = await bigOpaquePng(3000);
    const [url, cleanup] = await withUpload(raw);
    try {
      const html = await buildStandaloneHtml(
        repoRoot,
        photoDeck(`compress-${context}`, url),
        { context },
      );

      assert.ok(
        !html.includes(url),
        'image src should be inlined, not left as a path',
      );

      const jpegs = dataUrlPayloads(html, 'image/jpeg');
      assert.ok(
        jpegs.length > 0,
        'opaque photo should be embedded as JPEG, not PNG',
      );

      const rawBase64Len = raw.toString('base64').length;
      const biggest = Math.max(...jpegs.map((p) => p.length));
      assert.ok(
        biggest < rawBase64Len * 0.5,
        `embedded payload ${biggest} not substantially smaller than raw ${rawBase64Len}`,
      );
    } finally {
      await cleanup();
    }
  });
}

test('compression can be switched off for the standalone HTML', async () => {
  const prev = process.env.EXPORT_IMAGE_COMPRESSION;
  const raw = await bigOpaquePng(1200);
  const [url, cleanup] = await withUpload(raw);
  try {
    process.env.EXPORT_IMAGE_COMPRESSION = 'off';
    const html = await buildStandaloneHtml(
      repoRoot,
      photoDeck('compress-off', url),
      {},
    );
    assert.ok(
      dataUrlPayloads(html, 'image/png').length > 0,
      'with compression off the original PNG bytes should be embedded as-is',
    );
  } finally {
    if (prev === undefined) delete process.env.EXPORT_IMAGE_COMPRESSION;
    else process.env.EXPORT_IMAGE_COMPRESSION = prev;
    await cleanup();
  }
});

// --- display-aware cap on <img src>: the download measures, the /p/ page not --

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

after(async () => {
  await closePuppeteerBrowser();
});

/** Longest-edge px of every embedded JPEG in the document. */
async function embeddedJpegLongestEdges(html) {
  const edges = [];
  for (const b64 of dataUrlPayloads(html, 'image/jpeg')) {
    const meta = await sharp(Buffer.from(b64, 'base64')).metadata();
    edges.push(Math.max(meta.width, meta.height));
  }
  return edges;
}

/** A six-up gallery grid: each item is drawn ~480px wide on the canvas. */
async function withGridDeck(fn) {
  const cleanups = [];
  try {
    const images = [];
    for (let i = 0; i < 6; i++) {
      const raw = await sharp(await bigOpaquePng(2400))
        .jpeg({ quality: 92 })
        .toBuffer();
      const [url, cleanup] = await withUpload(raw);
      cleanups.push(cleanup);
      images.push({ src: url, caption: '', alt: '' });
    }
    await fn({
      id: 'html-display-aware',
      title: 'Display aware',
      theme: 'default',
      lang: 'en',
      slides: [
        { id: 'g', type: 'gallery-slide', content: { layout: 'grid', images } },
      ],
    });
  } finally {
    for (const c of cleanups) await c();
  }
}

test('HTML download caps a grid image at its display size', { skip }, () =>
  withGridDeck(async (pres) => {
    const html = await buildStandaloneHtml(repoRoot, pres, {
      context: 'export',
    });
    const edges = await embeddedJpegLongestEdges(html);
    assert.equal(edges.length, 6, 'six grid items');
    for (const e of edges) {
      assert.ok(
        e <= 1200,
        `grid item embedded at ${e}px, expected display-aware (<=1200), not the flat 2600 cap`,
      );
    }
  }),
);

test('published page keeps the flat cap and does not measure in Chrome', () =>
  withGridDeck(async (pres) => {
    const html = await buildStandaloneHtml(repoRoot, pres, {
      context: 'published',
    });
    const edges = await embeddedJpegLongestEdges(html);
    assert.equal(edges.length, 6, 'six grid items');
    for (const e of edges) {
      // Source-limited (2400px) under the flat 2600 cap: no measurement ran.
      assert.ok(e >= 2000, `grid item embedded at ${e}px, expected flat cap`);
    }
  }));
