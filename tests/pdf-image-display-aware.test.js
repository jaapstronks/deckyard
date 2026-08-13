/**
 * Display-aware image caps for the PDF export.
 *
 * `image-compress.js` shrinks each embedded raster to a longest-edge cap, but
 * the shipped cap was flat (`DEFAULT_MAX_PX`) regardless of how big the image is
 * actually drawn. A portrait shown ~150px wide in a grid embedded at the same
 * 2600px as a full-bleed photo — ~1000 ppi for a 2.5-inch box, and the bulk of
 * an export's image bytes (measured: 50.7% above 400 ppi on the CIIIC deck).
 *
 * This guards the fix: measure each `<img>`'s on-page size in headless Chrome,
 * then cap it at a retina margin over *that* — small-on-page images embed small,
 * a full-bleed keeps its resolution. The pure pieces (`displayCap`, `retinaScale`,
 * `hasMeasurableImages`) are tested without a browser; the end-to-end behaviour
 * through `buildSlidesPdfHtml` needs Chrome and skips when none is installed.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import {
  displayCap,
  retinaScale,
  hasMeasurableImages,
  displayAwareEmbedTransform,
  DEFAULT_RETINA_SCALE,
  MIN_DISPLAY_CAP,
} from '../server/export/image-measure.js';
import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';
import {
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = { maxPx: 2600, quality: 80 };

// --- pure pieces, no browser -------------------------------------------------

test('displayCap: a small display size yields a small cap, clamped both ends', () => {
  // A 480px-wide grid item at 2x retina caps well under the flat ceiling.
  assert.equal(displayCap(480, cfg, 2), 960);
  // Never below the floor, so a tiny image still survives a zoom.
  assert.equal(displayCap(10, cfg, 2), MIN_DISPLAY_CAP);
  // Never above the flat ceiling: a full-bleed image is unchanged from today.
  assert.equal(displayCap(1600, cfg, 2), cfg.maxPx);
  // Unknown / non-positive display size falls back to the flat cap exactly.
  assert.equal(displayCap(undefined, cfg, 2), cfg.maxPx);
  assert.equal(displayCap(0, cfg, 2), cfg.maxPx);
});

/** Run `fn` with PDF_EXPORT_* env vars set (undefined = unset). */
function withEnv(env, fn) {
  const keys = ['PDF_EXPORT_IMAGE_RETINA_SCALE', 'PDF_EXPORT_IMAGE_COMPRESSION'];
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

test('retinaScale: default 2, valid override in [1, 4], else fallback', () => {
  withEnv({}, () => assert.equal(retinaScale(), DEFAULT_RETINA_SCALE));
  withEnv({ PDF_EXPORT_IMAGE_RETINA_SCALE: '3' }, () =>
    assert.equal(retinaScale(), 3)
  );
  // Out-of-range and garbage fall back to the default (envInt contract; the
  // pre-family parser clamped 100 → 4 instead).
  withEnv({ PDF_EXPORT_IMAGE_RETINA_SCALE: '100' }, () =>
    assert.equal(retinaScale(), DEFAULT_RETINA_SCALE)
  );
  withEnv({ PDF_EXPORT_IMAGE_RETINA_SCALE: '0' }, () =>
    assert.equal(retinaScale(), DEFAULT_RETINA_SCALE)
  );
  withEnv({ PDF_EXPORT_IMAGE_RETINA_SCALE: 'nope' }, () =>
    assert.equal(retinaScale(), DEFAULT_RETINA_SCALE)
  );
});

test('hasMeasurableImages: only local <img src> counts', () => {
  assert.equal(hasMeasurableImages(['<img src="/uploads/a.jpg">']), true);
  assert.equal(hasMeasurableImages(['<img src="/custom/themes/x/assets/a.png">']), true);
  assert.equal(hasMeasurableImages(['<img src="https://example.com/a.jpg">']), false);
  assert.equal(hasMeasurableImages(['<img src="data:image/png;base64,AAAA">']), false);
  assert.equal(hasMeasurableImages(['<p>no images here</p>']), false);
  // Non-global regex: repeated calls must not carry state between them.
  const docs = ['<img src="/uploads/a.jpg">', '<img src="/uploads/b.jpg">'];
  assert.equal(hasMeasurableImages(docs), true);
  assert.equal(hasMeasurableImages(docs), true);
});

test('displayAwareEmbedTransform: null when compression is off', () => {
  withEnv({ PDF_EXPORT_IMAGE_COMPRESSION: 'off' }, () =>
    assert.equal(displayAwareEmbedTransform(new Map()), null)
  );
});

test('displayAwareEmbedTransform: an unmeasured url keeps the flat cap', async () => {
  const raw = await bigOpaqueJpeg(2400);
  const transform = withEnv({}, () => displayAwareEmbedTransform(new Map()));
  const { buf } = await transform(raw, 'jpg', 'image/jpeg', '/uploads/unknown.jpg');
  const meta = await sharp(buf).metadata();
  // No measurement → flat cap 2600 → 2400 source kept (never enlarged).
  assert.equal(Math.max(meta.width, meta.height), 2400);
});

test('displayAwareEmbedTransform: a small measured url is shrunk to its cap', async () => {
  const raw = await bigOpaqueJpeg(2400);
  const displayPx = new Map([['/uploads/thumb.jpg', 300]]);
  const transform = withEnv({}, () => displayAwareEmbedTransform(displayPx));
  const { buf } = await transform(raw, 'jpg', 'image/jpeg', '/uploads/thumb.jpg');
  const meta = await sharp(buf).metadata();
  assert.equal(Math.max(meta.width, meta.height), 600); // 300 * 2 retina
});

// --- end to end, needs Chrome ------------------------------------------------

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

after(async () => {
  await closePuppeteerBrowser();
});

/**
 * A photo-like opaque JPEG: mid-frequency content so it does not deflate away
 * but downsampling visibly shrinks it — the case the pipeline targets. Distinct
 * `seed` per image so nothing dedupes by identical bytes.
 */
async function bigOpaqueJpeg(px, seed = 1) {
  const pixels = Buffer.alloc(px * px * 3);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = ((i * 2654435761) ^ (i >> 3) ^ (seed * 40503)) & 0xff;
  }
  return sharp(pixels, { raw: { width: px, height: px, channels: 3 } })
    .blur(6)
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function withUpload(buf, ext = 'jpg') {
  const name = `test-display-aware-${randomUUID()}.${ext}`;
  const dir = path.join(repoRoot, 'server', 'uploads');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, buf);
  return [`/uploads/${name}`, () => fs.rm(file, { force: true })];
}

/** Longest-edge px of every embedded JPEG in the export HTML. */
async function embeddedJpegLongestEdges(html) {
  const payloads = [...html.matchAll(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/g)].map((m) => m[1]);
  const edges = [];
  for (const b64 of payloads) {
    const meta = await sharp(Buffer.from(b64, 'base64')).metadata();
    edges.push(Math.max(meta.width, meta.height));
  }
  return edges;
}

test(
  'PDF export caps a grid image at its display size but keeps a full-bleed sharp',
  { skip },
  async () => {
    const cleanups = [];
    try {
      const images = [];
      for (let i = 0; i < 6; i++) {
        const [url, cleanup] = await withUpload(await bigOpaqueJpeg(2400, i + 1));
        cleanups.push(cleanup);
        images.push({ src: url, caption: '', alt: '' });
      }
      const [bleedUrl, bleedCleanup] = await withUpload(await bigOpaqueJpeg(2400, 99));
      cleanups.push(bleedCleanup);

      const pres = {
        id: 'display-aware',
        title: 'Display aware',
        theme: 'default',
        lang: 'en',
        slides: [
          { id: 'g', type: 'gallery-slide', content: { layout: 'grid', images } },
          {
            id: 'f',
            type: 'image-slide',
            content: { title: '', image: bleedUrl, fit: 'cover', bleed: true },
          },
        ],
      };

      const html = await buildSlidesPdfHtml(repoRoot, pres, {});
      const edges = (await embeddedJpegLongestEdges(html)).sort((a, b) => a - b);
      assert.equal(edges.length, 7, 'six grid items plus one full-bleed');

      // The six grid thumbnails: capped near their display size (~480px * 2),
      // an order of magnitude under both the flat 2600px cap and the source.
      const grid = edges.slice(0, 6);
      for (const e of grid) {
        assert.ok(
          e <= 1200,
          `grid item embedded at ${e}px, expected display-aware (<=1200), not the flat 2600 cap`,
        );
      }

      // The full-bleed photo keeps its resolution: its display size saturates
      // the flat cap, so it is source-limited (2400px), not shrunk to a thumbnail.
      const bleed = edges[6];
      assert.ok(
        bleed >= 2000,
        `full-bleed embedded at ${bleed}px, expected near source resolution (>=2000)`,
      );
      assert.ok(bleed > Math.max(...grid) * 1.5, 'full-bleed must stay far sharper than a grid item');
    } finally {
      for (const c of cleanups) await c();
    }
  },
);
