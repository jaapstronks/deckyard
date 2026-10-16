import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { buildStandaloneHtml } from '../server/export/html.js';

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

// --- no display-aware pass: the document is built without a browser ---------

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
 * in Chrome and cap near its ~480px display size. Here they get the flat cap,
 * so a 2400px source stays at 2400px. If this starts failing because the items
 * shrink, a measurement pass came in: that starts Chrome on a route that builds
 * a /p/ page per visitor, and keeps every test process that builds HTML alive.
 */
for (const context of ['export', 'published']) {
  test(`standalone HTML (${context}) gives rendered <img src> the flat cap, without Chrome`, async () => {
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
      const html = await buildStandaloneHtml(
        repoRoot,
        {
          id: `grid-${context}`,
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
        { context },
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
}
