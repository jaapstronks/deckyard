import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';

/**
 * Regression guard for the *seam*, not the transform.
 *
 * `tests/pdf-image-compression.test.js` covers `compressImageForEmbed` itself.
 * What it cannot see is whether the PDF export still *calls* it: the transform
 * is threaded into `buildSlidesPdfHtml`'s two embed passes (slide field values
 * and rendered `<img src>`) by hand, and dropping either argument leaves every
 * unit test green while full-resolution originals go back into the PDF.
 *
 * That is not hypothetical. A 78-page CIIIC deck exported before the transform
 * was wired in came out at 328 MB and took ~500ms to show its first page and
 * ~1.4s per page to scroll (PDFKit, retina); the same deck with the transform
 * in place is 28 MB, 45ms, and 9ms per page. The difference is entirely whether
 * these two call sites still pass `transform`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  const name = `test-export-compress-${randomUUID()}.png`;
  const dir = path.join(repoRoot, 'server', 'uploads');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, buf);
  return [`/uploads/${name}`, () => fs.rm(file, { force: true })];
}

function dataUrlPayloads(html, mime) {
  const re = new RegExp(`data:${mime.replace('/', '\\/')};base64,([A-Za-z0-9+/=]+)`, 'g');
  return [...html.matchAll(re)].map((m) => m[1]);
}

test('PDF export still applies image compression to embedded slide images', async () => {
  const raw = await bigOpaquePng(3000);
  const [url, cleanup] = await withUpload(raw);
  try {
    const pres = {
      id: 'compress-seam',
      title: 'Compression seam',
      theme: 'default',
      lang: 'en',
      slides: [
        { id: 's1', type: 'image-slide', content: { title: 'Photo', image: url } },
      ],
    };

    const html = await buildSlidesPdfHtml(repoRoot, pres, {});

    // The original upload must not survive as a raw path or as PNG bytes.
    assert.ok(!html.includes(url), 'image src should be inlined, not left as a path');

    const jpegs = dataUrlPayloads(html, 'image/jpeg');
    assert.ok(jpegs.length > 0, 'opaque photo should be embedded as JPEG, not PNG');

    // The embedded payload must be far smaller than the untouched original.
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

test('compression can be switched off for the PDF export', async () => {
  const prev = process.env.PDF_EXPORT_IMAGE_COMPRESSION;
  const raw = await bigOpaquePng(1200);
  const [url, cleanup] = await withUpload(raw);
  try {
    process.env.PDF_EXPORT_IMAGE_COMPRESSION = 'off';
    const pres = {
      id: 'compress-off',
      title: 'Compression off',
      theme: 'default',
      lang: 'en',
      slides: [
        { id: 's1', type: 'image-slide', content: { title: 'Photo', image: url } },
      ],
    };
    const html = await buildSlidesPdfHtml(repoRoot, pres, {});
    assert.ok(
      dataUrlPayloads(html, 'image/png').length > 0,
      'with compression off the original PNG bytes should be embedded as-is',
    );
  } finally {
    if (prev === undefined) delete process.env.PDF_EXPORT_IMAGE_COMPRESSION;
    else process.env.PDF_EXPORT_IMAGE_COMPRESSION = prev;
    await cleanup();
  }
});
