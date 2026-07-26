/**
 * Contrast judgement — the thin layer that turns a measurement into a verdict.
 *
 * `color-utils.js` answers "how much contrast is there"; this module answers
 * "is that enough". Keeping the two apart matters because the thresholds are a
 * policy decision and the ratio is not: the background-image sampler wants the
 * large-text bar, the theme editor wants the body-text bar, and before this
 * module those two numbers lived as unexplained literals in different files.
 *
 * Two readings, deliberately:
 *
 * - **WCAG 2.2 contrast ratio** is the verdict. It is what EN 301 549 and the
 *   European Accessibility Act point at, so it is the only claim a user can
 *   actually stand behind when someone asks whether their deck is accessible.
 * - **APCA (Lc)** is reported alongside as a perceptual second opinion. It
 *   models text size and weight properly and is far better at light-on-dark —
 *   exactly the case WCAG 2 is known to misjudge, and exactly what the
 *   `midnight` theme is. It is candidate work for WCAG 3, not a standard yet,
 *   so it informs but never decides.
 *
 * Where the two disagree, that disagreement is the interesting signal: a pair
 * that clears AA but fails APCA is usually light text on a dark ground that
 * looks thinner than the ratio suggests.
 */

import { hexToRgb, getContrastRatio } from './color-utils.js';

/**
 * WCAG 2.2 minimum contrast ratios, by text size.
 *
 * `large` is WCAG's "large scale text" (≥18pt, or ≥14pt bold). Slide titles,
 * table headers and button labels are all comfortably in that bucket; slide
 * body copy is judged at `body` even though it renders big, because the deck
 * can be exported to PDF and read at document size.
 * @type {{large: {aa: number, aaa: number}, body: {aa: number, aaa: number}}}
 */
export const WCAG_THRESHOLDS = {
  large: { aa: 3, aaa: 4.5 },
  body: { aa: 4.5, aaa: 7 },
};

/**
 * APCA Lc minimums, by the same two size buckets.
 *
 * From the APCA readability guidance: Lc 75 is the floor for a column of body
 * text, Lc 60 for larger content text. Compared on absolute Lc — the sign of an
 * Lc value carries polarity, not magnitude.
 * @type {{large: number, body: number}}
 */
export const APCA_THRESHOLDS = { large: 60, body: 75 };

/** Text-size buckets both threshold tables are keyed by. */
export const TEXT_SIZES = /** @type {const} */ (['body', 'large']);

// --- APCA (APCA-W3 0.1.9, the "0.98G-4g" constant set) ----------------------
// Vendored rather than taken as a dependency: it is a closed formula with fixed
// constants, and pulling a package for ~40 lines would be the larger liability.
// The constants are load-bearing — do not "tidy" them.
const APCA_TRC = 2.4;
const APCA_R = 0.2126729;
const APCA_G = 0.7151522;
const APCA_B = 0.072175;
const NORM_BG = 0.56;
const NORM_TXT = 0.57;
const REV_TXT = 0.62;
const REV_BG = 0.65;
const BLACK_THRESHOLD = 0.022;
const BLACK_CLAMP = 1.414;
const SCALE_BOW = 1.14;
const SCALE_WOB = 1.14;
const LO_BOW_OFFSET = 0.027;
const LO_WOB_OFFSET = 0.027;
const DELTA_Y_MIN = 0.0005;
const LO_CLIP = 0.1;

/**
 * APCA screen luminance (Ys) for an RGB object.
 *
 * Not the same curve as {@link getRelativeLuminance}: APCA uses a plain 2.4
 * power transfer, where WCAG uses a piecewise linear/power hybrid. They are
 * close but not interchangeable, which is why this is private to the module.
 * @param {{r: number, g: number, b: number}} rgb
 * @returns {number}
 */
function apcaLuminance({ r, g, b }) {
  const y =
    APCA_R * (r / 255) ** APCA_TRC +
    APCA_G * (g / 255) ** APCA_TRC +
    APCA_B * (b / 255) ** APCA_TRC;
  // Soft-clamp near-black so the curve does not run away at the bottom end.
  return y < BLACK_THRESHOLD ? y + (BLACK_THRESHOLD - y) ** BLACK_CLAMP : y;
}

/**
 * APCA lightness contrast (Lc) for text on a background.
 *
 * **Order matters**, unlike {@link getContrastRatio}: APCA is polarity-aware,
 * and dark-on-light is not the same problem as light-on-dark. A positive Lc
 * means dark text on a lighter ground; negative means light text on a darker
 * ground. Compare thresholds against the absolute value.
 * @param {string} textHex
 * @param {string} bgHex
 * @returns {number} signed Lc, roughly −108…108; 0 when either colour is unparseable
 */
export function getApcaLc(textHex, bgHex) {
  const textRgb = hexToRgb(textHex);
  const bgRgb = hexToRgb(bgHex);
  if (!textRgb || !bgRgb) return 0;

  const textY = apcaLuminance(textRgb);
  const bgY = apcaLuminance(bgRgb);
  if (Math.abs(bgY - textY) < DELTA_Y_MIN) return 0;

  let sapc;
  let output;
  if (bgY > textY) {
    // Dark text on a light ground.
    sapc = (bgY ** NORM_BG - textY ** NORM_TXT) * SCALE_BOW;
    output = sapc < LO_CLIP ? 0 : sapc - LO_BOW_OFFSET;
  } else {
    // Light text on a dark ground.
    sapc = (bgY ** REV_BG - textY ** REV_TXT) * SCALE_WOB;
    output = sapc > -LO_CLIP ? 0 : sapc + LO_WOB_OFFSET;
  }
  return output * 100;
}

/**
 * Normalize an arbitrary size argument to a threshold-table key.
 * @param {string} [size]
 * @returns {'body'|'large'}
 */
function normalizeSize(size) {
  return size === 'large' ? 'large' : 'body';
}

/**
 * @typedef {object} ContrastAssessment
 * @property {number} ratio - WCAG 2.2 contrast ratio (1–21).
 * @property {'body'|'large'} size - Which threshold set was applied.
 * @property {'fail'|'aa'|'aaa'} level - Size-aware WCAG verdict.
 * @property {boolean} passes - Shorthand for `level !== 'fail'`.
 * @property {number} apcaLc - Signed APCA Lc for this text-on-background pair.
 * @property {boolean} apcaPasses - Whether |Lc| clears the APCA floor for `size`.
 * @property {boolean} disagree - True when the two methods reach opposite verdicts.
 */

/**
 * Judge a text-on-background pair against both methods.
 *
 * Argument order follows APCA's requirement (text first, then background); the
 * WCAG ratio is order-independent so it is unaffected.
 * @param {string} textHex - Foreground / text colour.
 * @param {string} bgHex - Background colour behind it.
 * @param {{size?: 'body'|'large'}} [options]
 * @returns {ContrastAssessment}
 */
export function assessContrast(textHex, bgHex, { size } = {}) {
  const bucket = normalizeSize(size);
  const ratio = getContrastRatio(textHex, bgHex);
  const bar = WCAG_THRESHOLDS[bucket];

  let level = 'fail';
  if (ratio >= bar.aaa) level = 'aaa';
  else if (ratio >= bar.aa) level = 'aa';

  const apcaLc = getApcaLc(textHex, bgHex);
  const apcaPasses = Math.abs(apcaLc) >= APCA_THRESHOLDS[bucket];
  const passes = level !== 'fail';

  return {
    ratio,
    size: bucket,
    level,
    passes,
    apcaLc,
    apcaPasses,
    disagree: passes !== apcaPasses,
  };
}
