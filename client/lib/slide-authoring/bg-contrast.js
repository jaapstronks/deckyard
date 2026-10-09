/**
 * Background-image contrast detection.
 *
 * Given a slide background image URL and the active theme's two candidate text
 * colours, decides whether *light* or *dark* text reads better over the image,
 * and whether a scrim/overlay is still needed because neither candidate clears
 * the WCAG target. The result is meant to be persisted on slide content
 * (`slideBgTextAuto`, `slideBgNeedsScrim`) at edit time, so the server render
 * (export/PDF/PNG) can honour it without re-sampling pixels. The server's
 * write seam settles the same keys for decks that never reach the editor
 * (`server/utils/bg-image-contrast.js`); the rule both use is
 * `shared/bg-image-contrast.js`.
 *
 * Browser-only (uses <canvas>). Same-origin images (uploads, theme presets)
 * work; a cross-origin image taints the canvas, in which case we return
 * `{ ok: false }` and the caller should leave the theme default untouched.
 */

import {
  BG_SAMPLE_SIZE,
  BG_TEXT_FALLBACKS,
  bgSampleRect,
  judgeBgTextContrast,
} from '../../../shared/bg-image-contrast.js';
import { h } from '../dom/index.js';

/**
 * @param {string} url - Background image URL (same-origin recommended).
 * @param {{ light?: string, dark?: string }} textColors - Theme candidate text colours.
 * @returns {Promise<{ ok: boolean, text?: 'light'|'dark', needsScrim?: boolean, failFraction?: number }>}
 */
export async function detectBgTextContrast(
  url,
  { light = BG_TEXT_FALLBACKS.light, dark = BG_TEXT_FALLBACKS.dark } = {},
) {
  if (typeof document === 'undefined' || !url) return { ok: false };

  let img;
  try {
    img = await loadImage(url);
  } catch {
    return { ok: false };
  }

  const canvas = h('canvas', { width: BG_SAMPLE_SIZE, height: BG_SAMPLE_SIZE });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: false };

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return { ok: false };
  const r = bgSampleRect(iw, ih);

  let data;
  try {
    ctx.drawImage(
      img,
      r.left,
      r.top,
      r.width,
      r.height,
      0,
      0,
      BG_SAMPLE_SIZE,
      BG_SAMPLE_SIZE,
    );
    data = ctx.getImageData(0, 0, BG_SAMPLE_SIZE, BG_SAMPLE_SIZE).data;
  } catch {
    // Tainted canvas (cross-origin image) — cannot read pixels.
    return { ok: false };
  }

  // The rule itself is shared with the server's write seam, so both say the
  // same thing about the same image (B627).
  return judgeBgTextContrast(data, { light, dark });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Same-origin assets don't need this; setting it lets same-origin-with-CORS
    // and properly-CORS-enabled hosts sample too. Cross-origin without CORS
    // still taints and is caught at getImageData().
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
