/**
 * Background-image contrast detection.
 *
 * Given a slide background image URL and the active theme's two candidate text
 * colours, decides whether *light* or *dark* text reads better over the image,
 * and whether a scrim/overlay is still needed because neither candidate clears
 * the WCAG target. The result is meant to be persisted on slide content
 * (`slideBgTextAuto`, `slideBgNeedsScrim`) at edit time, so the server render
 * (export/PDF/PNG) can honour it without re-sampling pixels.
 *
 * Browser-only (uses <canvas>). Same-origin images (uploads, theme presets)
 * work; a cross-origin image taints the canvas, in which case we return
 * `{ ok: false }` and the caller should leave the theme default untouched.
 */

import { hexToRgb, getRelativeLuminance } from './color-utils.js';

const SAMPLE_SIZE = 32; // downscaled sampling canvas edge, px
const CONTRAST_TARGET = 3.0; // per-pixel pass threshold for large/title text (WCAG AA)
// Fraction of the title region that may fail the chosen colour before we
// recommend a scrim. Above this the image is "busy" (mixed light+dark), where
// no single flat text colour reads everywhere and an overlay is warranted.
const SCRIM_FAIL_FRACTION = 0.25;

// Region of the image (normalized 0-1) where slide titles/body usually sit.
// Weighted toward the upper-left, which handles "dark top / bright bottom"
// photos far better than a whole-image average.
const REGION = { x: 0, y: 0, w: 0.7, h: 0.62 };

/**
 * @param {string} url - Background image URL (same-origin recommended).
 * @param {{ light?: string, dark?: string }} textColors - Theme candidate text colours.
 * @returns {Promise<{ ok: boolean, text?: 'light'|'dark', needsScrim?: boolean, failFraction?: number }>}
 */
export async function detectBgTextContrast(
  url,
  { light = '#ffffff', dark = '#212121' } = {}
) {
  if (typeof document === 'undefined' || !url) return { ok: false };

  let img;
  try {
    img = await loadImage(url);
  } catch {
    return { ok: false };
  }

  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: false };

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return { ok: false };

  const sx = Math.max(0, Math.floor(iw * REGION.x));
  const sy = Math.max(0, Math.floor(ih * REGION.y));
  const sw = Math.max(1, Math.floor(iw * REGION.w));
  const sh = Math.max(1, Math.floor(ih * REGION.h));

  let data;
  try {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    // Tainted canvas (cross-origin image) — cannot read pixels.
    return { ok: false };
  }

  // Distribution-based decision: for each sampled pixel, does the light / dark
  // candidate clear the contrast target against it? Pick the colour that leaves
  // the FEWEST failing pixels (robust to busy images, where a single average
  // colour is misleading), and recommend a scrim when even the winner still
  // fails on a meaningful fraction of the region.
  const lLight = candidateLuminance(light, '#ffffff');
  const lDark = candidateLuminance(dark, '#212121');

  let failLight = 0;
  let failDark = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a === 0) continue;
    const lPx = getRelativeLuminance({ r: data[i], g: data[i + 1], b: data[i + 2] });
    if (contrast(lLight, lPx) < CONTRAST_TARGET) failLight += a;
    if (contrast(lDark, lPx) < CONTRAST_TARGET) failDark += a;
    total += a;
  }
  if (total === 0) return { ok: false };

  const fracFailLight = failLight / total;
  const fracFailDark = failDark / total;
  const useLight = fracFailLight <= fracFailDark;
  const chosenFail = useLight ? fracFailLight : fracFailDark;

  return {
    ok: true,
    text: useLight ? 'light' : 'dark',
    needsScrim: chosenFail > SCRIM_FAIL_FRACTION,
    failFraction: Math.round(chosenFail * 100) / 100,
  };
}

function candidateLuminance(hex, fallback) {
  const rgb = hexToRgb(hex) || hexToRgb(fallback);
  return getRelativeLuminance(rgb);
}

// WCAG contrast ratio from two relative luminances.
function contrast(l1, l2) {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
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

// Re-export the luminance helper for callers that want a quick check without
// pulling color-utils directly.
export { getRelativeLuminance };
