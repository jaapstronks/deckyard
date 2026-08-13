import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import {
  pdfImageCompressionConfig,
  compressImageForEmbed,
  pdfImageEmbedTransform,
} from '../server/export/image-compress.js';
import { toDataUrlIfLocal } from '../server/utils/html-utils.js';

/**
 * PDF-export image compression: downsample + recompress each embedded image so
 * a full-res photo doesn't drag its original pixels into the PDF. Opaque images
 * become JPEG; transparent images stay PNG; SVGs and small assets are left
 * alone; the transform never returns a larger buffer.
 */

// A large opaque photo-like PNG: mid-frequency content (a blur over structured
// bytes) so PNG can't deflate it to nothing yet JPEG compresses it well — the
// realistic case the export pipeline targets.
async function bigOpaquePng(px = 4000) {
  const pixels = Buffer.alloc(px * px * 3);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = ((i * 2654435761) ^ (i >> 3)) & 0xff;
  }
  return sharp(pixels, { raw: { width: px, height: px, channels: 3 } })
    .blur(6)
    .png()
    .toBuffer();
}

async function bigTransparentPng(px = 3000) {
  return sharp({
    create: {
      width: px,
      height: px,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 0.4 },
    },
  })
    .png()
    .toBuffer();
}

/** Run `fn` with the given PDF_EXPORT_* vars set (undefined = unset). */
function withEnv(env, fn) {
  const keys = [
    'PDF_EXPORT_IMAGE_COMPRESSION',
    'PDF_EXPORT_IMAGE_MAX_PX',
    'PDF_EXPORT_IMAGE_QUALITY',
  ];
  const saved = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('config: default enabled with safe values, disable switches', () => {
  const def = withEnv({}, () => pdfImageCompressionConfig());
  assert.ok(def && def.maxPx > 0 && def.quality >= 1 && def.quality <= 100);

  // Every recognized falsy token disables; an unrecognized value stays ON
  // (default-on flag: a typo must not silently change export behaviour).
  for (const v of ['off', '0', 'false', 'no']) {
    withEnv({ PDF_EXPORT_IMAGE_COMPRESSION: v }, () =>
      assert.equal(pdfImageCompressionConfig(), null, `toggle ${v}`)
    );
  }
  withEnv({ PDF_EXPORT_IMAGE_COMPRESSION: 'banana' }, () =>
    assert.ok(pdfImageCompressionConfig(), 'unrecognized toggle stays enabled')
  );
  withEnv({ PDF_EXPORT_IMAGE_MAX_PX: '0' }, () =>
    assert.equal(pdfImageCompressionConfig(), null)
  );

  const custom = withEnv(
    { PDF_EXPORT_IMAGE_MAX_PX: '1800', PDF_EXPORT_IMAGE_QUALITY: '65' },
    () => pdfImageCompressionConfig()
  );
  assert.deepEqual(custom, { maxPx: 1800, quality: 65 });

  // Out-of-range falls back to the default (envInt contract).
  withEnv({ PDF_EXPORT_IMAGE_QUALITY: '999' }, () =>
    assert.equal(pdfImageCompressionConfig().quality, def.quality)
  );
});

test('opaque image is downsampled and re-encoded as JPEG, much smaller', async () => {
  const input = await bigOpaquePng(4000);
  const cfg = { maxPx: 2000, quality: 80 };
  const out = await compressImageForEmbed(input, 'png', 'image/png', cfg);

  assert.equal(out.mime, 'image/jpeg');
  assert.ok(out.buf.length < input.length, 'result smaller than original');

  const meta = await sharp(out.buf).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(Math.max(meta.width, meta.height), 2000, 'longest edge capped at maxPx');
});

test('transparent image stays PNG (alpha preserved), still downsampled', async () => {
  const input = await bigTransparentPng(3000);
  const cfg = { maxPx: 1500, quality: 80 };
  const out = await compressImageForEmbed(input, 'png', 'image/png', cfg);

  assert.equal(out.mime, 'image/png');
  const meta = await sharp(out.buf).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.hasAlpha, true, 'transparency preserved');
  assert.equal(Math.max(meta.width, meta.height), 1500);
});

test('SVG and already-small assets are returned untouched', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  const svgOut = await compressImageForEmbed(svg, 'svg', 'image/svg+xml', {
    maxPx: 100,
    quality: 80,
  });
  assert.equal(svgOut.buf, svg, 'SVG buffer unchanged');
  assert.equal(svgOut.mime, 'image/svg+xml');

  // A tiny opaque PNG: re-encoding would grow it, so we keep the original.
  const tiny = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
  const tinyOut = await compressImageForEmbed(tiny, 'png', 'image/png', {
    maxPx: 2000,
    quality: 80,
  });
  assert.equal(tinyOut.buf, tiny, 'small asset not made bigger');
});

test('no config = passthrough', async () => {
  const input = await bigOpaquePng(1200);
  const out = await compressImageForEmbed(input, 'png', 'image/png', null);
  assert.equal(out.buf, input);
  assert.equal(out.mime, 'image/png');
});

test('toDataUrlIfLocal applies the transform end-to-end', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-compress-'));
  try {
    const uploads = path.join(dir, 'server', 'uploads');
    await fs.mkdir(uploads, { recursive: true });
    const buf = await bigOpaquePng(3000);
    await fs.writeFile(path.join(uploads, 'photo.png'), buf);

    const transform = withEnv({}, () => pdfImageEmbedTransform()); // defaults, enabled
    const dataUrl = await toDataUrlIfLocal(dir, '/uploads/photo.png', { transform });
    assert.match(dataUrl, /^data:image\/jpeg;base64,/, 'opaque upload embedded as JPEG');

    // The base64 payload must be far smaller than the raw PNG's base64.
    const payload = dataUrl.split(',')[1];
    const rawBase64Len = buf.toString('base64').length;
    assert.ok(payload.length < rawBase64Len * 0.5, 'embedded payload substantially smaller');

    // Without a transform, the original bytes are embedded (PNG).
    const plain = await toDataUrlIfLocal(dir, '/uploads/photo.png', {});
    assert.match(plain, /^data:image\/png;base64,/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
