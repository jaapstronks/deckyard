/**
 * Which theme text colour reads over a background image — the rule, without
 * the pixels.
 *
 * Two samplers feed it: the editor's (`client/lib/slide-authoring/
 * bg-contrast.js`, a <canvas>) and the server's write seam
 * (`server/utils/bg-image-contrast.js`, sharp). Both cut the same region out of
 * the image, scale it to the same square and hand the RGBA pixels here, so a
 * deck that never meets the editor gets the answer the editor would have given
 * (B627).
 *
 * The verdict lands on slide content as `slideBgTextAuto` / `slideBgNeedsScrim`
 * (plus `slideBgAutoFor`, the image it was measured on), where the shared
 * renderer reads it behind `slideBgText: 'auto'`.
 */

import {
  hexToRgb,
  getRelativeLuminance,
  contrastRatioFromLuminance,
} from './color-utils.js';
import { WCAG_THRESHOLDS } from './contrast.js';

/** Edge of the downscaled sampling square, px. */
export const BG_SAMPLE_SIZE = 32;

/**
 * Region of the image (normalized 0-1) where slide titles/body usually sit.
 * Weighted toward the upper-left, which handles "dark top / bright bottom"
 * photos far better than a whole-image average.
 */
export const BG_SAMPLE_REGION = { x: 0, y: 0, w: 0.7, h: 0.62 };

/** The theme's candidate text colours when it names none. */
export const BG_TEXT_FALLBACKS = { light: '#ffffff', dark: '#212121' };

// Per-pixel pass threshold. Titles over a background image are large text, so
// the large-text AA bar applies — taken from the shared threshold table rather
// than restated here, so it sits next to the 4.5 that body text needs.
const CONTRAST_TARGET = WCAG_THRESHOLDS.large.aa;
// Fraction of the title region that may fail the chosen colour before we
// recommend a scrim. Above this the image is "busy" (mixed light+dark), where
// no single flat text colour reads everywhere and an overlay is warranted.
const SCRIM_FAIL_FRACTION = 0.25;

/**
 * The pixel rectangle {@link BG_SAMPLE_REGION} names in an image of this size.
 * @param {number} width
 * @param {number} height
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function bgSampleRect(width, height) {
  return {
    left: Math.max(0, Math.floor(width * BG_SAMPLE_REGION.x)),
    top: Math.max(0, Math.floor(height * BG_SAMPLE_REGION.y)),
    width: Math.max(1, Math.floor(width * BG_SAMPLE_REGION.w)),
    height: Math.max(1, Math.floor(height * BG_SAMPLE_REGION.h)),
  };
}

/**
 * The theme's two candidate text colours, as the samplers compare them.
 * @param {Object|null} [theme] - a loaded theme
 * @returns {{ light: string, dark: string }}
 */
export function bgTextCandidates(theme) {
  return {
    light: theme?.textColorLight || BG_TEXT_FALLBACKS.light,
    dark: theme?.textColorDark || BG_TEXT_FALLBACKS.dark,
  };
}

/**
 * Judge sampled pixels. Distribution-based: for each pixel, does the light /
 * dark candidate clear the contrast target against it? Pick the colour that
 * leaves the FEWEST failing pixels (robust to busy images, where a single
 * average colour is misleading), and recommend a scrim when even the winner
 * still fails on a meaningful fraction of the region.
 *
 * @param {ArrayLike<number>} rgba - RGBA bytes, 4 per pixel
 * @param {{ light?: string, dark?: string }} [textColors]
 * @returns {{ ok: boolean, text?: 'light'|'dark', needsScrim?: boolean, failFraction?: number }}
 */
export function judgeBgTextContrast(
  rgba,
  { light = BG_TEXT_FALLBACKS.light, dark = BG_TEXT_FALLBACKS.dark } = {},
) {
  if (!rgba || !rgba.length) return { ok: false };
  const lLight = candidateLuminance(light, BG_TEXT_FALLBACKS.light);
  const lDark = candidateLuminance(dark, BG_TEXT_FALLBACKS.dark);

  let failLight = 0;
  let failDark = 0;
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    if (a === 0) continue;
    const lPx = getRelativeLuminance({
      r: rgba[i],
      g: rgba[i + 1],
      b: rgba[i + 2],
    });
    if (contrastRatioFromLuminance(lLight, lPx) < CONTRAST_TARGET)
      failLight += a;
    if (contrastRatioFromLuminance(lDark, lPx) < CONTRAST_TARGET) failDark += a;
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
