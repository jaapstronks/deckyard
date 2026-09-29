import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { buildSlidePngHtml } from '../server/render/png.js';
import {
  loadExportDocument,
  exportRenderTimeoutMs,
} from '../server/render/load-export-document.js';
import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';

/**
 * B302: the PNG route (PNG, PNG zip, PPTX "every slide as an image") timed out
 * on a three-slide deck whose image-set held one 3200x1800 upload twice.
 *
 * Two causes, both pinned here. The route embedded every image at full
 * resolution — no transform, unlike the PDF route — so that slide became a
 * 14.6 MB document. And it loaded the document with `networkidle0`: Chrome's
 * idle timer fired while the parser was still writing it, before the new
 * document's `init`, and the `networkIdle` Puppeteer then waited for never
 * came. A real Chrome timeout is not stable to reproduce in a test; the
 * lifecycle order is the reason, the document size and the wait are the test.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

// The display-size measure opens the shared browser when Chrome is present.
after(async () => {
  await closePuppeteerBrowser();
});

/** A large opaque photo-like PNG, the shape of a screenshot-sized upload. */
async function bigOpaquePng(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = ((i * 2654435761) ^ (i >> 3)) & 0xff;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .blur(6)
    .png()
    .toBuffer();
}

/** Write a throwaway upload under the real repo root and return [url, cleanup]. */
async function withUpload(buf) {
  const name = `test-png-embed-${randomUUID()}.png`;
  const dir = path.join(repoRoot, 'server', 'uploads');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, buf);
  return [`/uploads/${name}`, () => fs.rm(file, { force: true })];
}

test('PNG export document stays small for an image-set with a 3200x1800 upload used twice', async () => {
  const raw = await bigOpaquePng(3200, 1800);
  const [url, cleanup] = await withUpload(raw);
  try {
    const html = await buildSlidePngHtml(repoRoot, {
      id: 's1',
      type: 'image-set-slide',
      content: {
        title: 'Two of the same',
        images: [{ src: url }, { src: url }],
      },
    });

    assert.ok(!html.includes(url), 'the upload should be inlined');
    assert.ok(
      html.includes('data:image/jpeg;base64,'),
      'the opaque upload should be re-encoded as JPEG, not embedded as its PNG',
    );
    const bytes = Buffer.byteLength(html);
    assert.ok(
      bytes < 2 * 1024 * 1024,
      `PNG export document is ${(bytes / 1024 / 1024).toFixed(1)} MB; ` +
        'the raw upload is going in without the embed transform',
    );
  } finally {
    await cleanup();
  }
});

test('both export renders load their document through loadExportDocument, never networkidle', async () => {
  for (const rel of ['server/render/png.js', 'server/render/pdf.js']) {
    const src = await fs.readFile(path.join(repoRoot, rel), 'utf8');
    assert.ok(
      !/networkidle/.test(src),
      `${rel} waits on networkidle; data-URL documents never go idle after init`,
    );
    assert.ok(
      /loadExportDocument\(page, html/.test(src),
      `${rel} should load its document through loadExportDocument()`,
    );
    assert.ok(
      !/\.setContent\(/.test(src),
      `${rel} should not call setContent directly`,
    );
  }
});

/** A page double that records what it was asked and can fail like Puppeteer. */
function fakePage({ fail = null } = {}) {
  const calls = { defaultTimeout: null, setContent: null };
  return {
    calls,
    setDefaultTimeout(ms) {
      calls.defaultTimeout = ms;
    },
    async setContent(html, opts) {
      calls.setContent = opts;
      if (fail) throw fail;
    },
  };
}

test('loadExportDocument waits for load under the shared timeout', async () => {
  const page = fakePage();
  await loadExportDocument(page, '<p>x</p>', { label: 'PNG export' });
  assert.equal(page.calls.setContent.waitUntil, 'load');
  assert.equal(page.calls.setContent.timeout, exportRenderTimeoutMs());
  assert.equal(page.calls.defaultTimeout, exportRenderTimeoutMs());
});

test('a render timeout names the env var to raise', async () => {
  const err = new Error('Navigation timeout of 30000 ms exceeded');
  err.name = 'TimeoutError';
  await assert.rejects(
    loadExportDocument(fakePage({ fail: err }), '', {
      label: 'PNG export',
    }),
    /PNG export timed out while rendering.*EXPORT_RENDER_TIMEOUT_MS/,
  );
  const other = new Error('Target closed');
  await assert.rejects(
    loadExportDocument(fakePage({ fail: other }), '', { label: 'PDF export' }),
    (e) => e === other,
  );
});

test('EXPORT_RENDER_TIMEOUT_MS sets the cap; 0 disables it', () => {
  const prev = process.env.EXPORT_RENDER_TIMEOUT_MS;
  try {
    delete process.env.EXPORT_RENDER_TIMEOUT_MS;
    assert.equal(exportRenderTimeoutMs(), 120_000);
    process.env.EXPORT_RENDER_TIMEOUT_MS = '300000';
    assert.equal(exportRenderTimeoutMs(), 300_000);
    process.env.EXPORT_RENDER_TIMEOUT_MS = '0';
    assert.equal(exportRenderTimeoutMs(), 0);
  } finally {
    if (prev === undefined) delete process.env.EXPORT_RENDER_TIMEOUT_MS;
    else process.env.EXPORT_RENDER_TIMEOUT_MS = prev;
  }
});
