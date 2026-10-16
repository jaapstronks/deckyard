import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { buildSlidesPngExportHtml } from '../server/export/png-slides.js';

/**
 * Regression guard for the *seam*, not the transform (B729).
 *
 * `tests/export-pdf-image-compression-wired.test.js` pins the PDF route and
 * `tests/export-html-image-compression-wired.test.js` the standalone HTML;
 * this pins the PNG preview sheet the export modal opens in a tab. It shows
 * every slide as a thumbnail, yet it inlined every image at source
 * resolution: a deck of 48 photos of 4.8 MB opened as a 307 MB tab. The
 * difference is entirely whether `buildSlidesPngExportHtml`'s embed passes
 * still pass `transform`.
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
  const name = `test-png-preview-compress-${randomUUID()}.png`;
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

test('PNG preview sheet applies image compression to embedded slide images', async () => {
  const raw = await bigOpaquePng(3000);
  const [url, cleanup] = await withUpload(raw);
  try {
    const html = await buildSlidesPngExportHtml(
      repoRoot,
      photoDeck('compress-png-preview', url),
      {},
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

test('compression can be switched off for the PNG preview sheet', async () => {
  const prev = process.env.EXPORT_IMAGE_COMPRESSION;
  const raw = await bigOpaquePng(1200);
  const [url, cleanup] = await withUpload(raw);
  try {
    process.env.EXPORT_IMAGE_COMPRESSION = 'off';
    const html = await buildSlidesPngExportHtml(
      repoRoot,
      photoDeck('compress-off-png-preview', url),
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

// --- no display-aware pass: the sheet is built without a browser ------------

/** Longest-edge px of every embedded JPEG in the document. */
async function embeddedJpegLongestEdges(html) {
  const edges = [];
  for (const b64 of dataUrlPayloads(html, 'image/jpeg')) {
    const meta = await sharp(Buffer.from(b64, 'base64')).metadata();
    edges.push(Math.max(meta.width, meta.height));
  }
  return edges;
}

/**
 * A six-up gallery grid: rendered `<img src>` that the PDF route would measure
 * in Chrome and cap near its display size. Here they get the flat cap, so a
 * 2400px source stays at 2400px. If this starts failing because the items
 * shrink, a measurement pass came in: that starts Chrome on a route that
 * never needed one, and keeps every test process that builds the sheet alive.
 */
test('PNG preview sheet gives rendered <img src> the flat cap, without Chrome', async () => {
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
    const html = await buildSlidesPngExportHtml(
      repoRoot,
      {
        id: 'grid-png-preview',
        title: 'Grid',
        theme: 'default',
        lang: 'en',
        slides: [
          {
            id: 'g',
            type: 'gallery-slide',
            content: { layout: 'grid', images },
          },
        ],
      },
      {},
    );
    const edges = await embeddedJpegLongestEdges(html);
    assert.equal(edges.length, 6, 'six grid items, each recompressed');
    for (const e of edges) {
      assert.ok(e >= 2000, `grid item embedded at ${e}px, expected flat cap`);
    }
  } finally {
    for (const c of cleanups) await c();
  }
});
