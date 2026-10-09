/**
 * Text contrast over a slide background image, settled on the server (B627).
 *
 * The editor samples a background image when it shows the slide and stores
 * the verdict (`slideBgTextAuto`, `slideBgNeedsScrim`, `slideBgAutoFor`). A
 * deck that never reaches the editor — created over MCP, imported, generated,
 * presented straight away — used to keep the theme's text colour over the
 * photo, which on a dark preset meant a dark title on a dark image in
 * present, share and the PDF. The storage write seam now settles the same keys
 * for every slide whose image has no verdict yet, with the same rule
 * (`shared/bg-image-contrast.js`), so both surfaces say the same thing.
 *
 * Only images this installation serves from disk are read (theme presets,
 * uploads, fork assets). Anything else — a remote URL, a missing file — is
 * left alone, and the editor stays the fallback.
 */

import fs from 'node:fs/promises';
import sharp from 'sharp';
import {
  BG_SAMPLE_SIZE,
  bgSampleRect,
  bgTextCandidates,
  judgeBgTextContrast,
} from '../../shared/bg-image-contrast.js';
import { resolveServedAssetPath } from './served-asset-path.js';
import { createLogger } from './logger.js';

const log = createLogger('bg-image-contrast');

// Orient and shrink first, then cut the sample region from the small copy:
// the browser sampler draws the EXIF-oriented image, and a full-size decode
// is not needed to judge a 32×32 square.
const PRE_SCALE_EDGE = 256;

// Verdicts per file version and colour pair. A deck carries the same image in
// every language version, and a preset recurs across decks.
const MEMO_LIMIT = 256;
const memo = new Map();

/**
 * Sample an image file and judge which candidate text colour reads over it.
 * @param {string} filePath - absolute path of the image
 * @param {{ light: string, dark: string }} textColors
 * @returns {Promise<{ ok: boolean, text?: 'light'|'dark', needsScrim?: boolean, failFraction?: number }>}
 */
export async function sampleBgTextContrastFile(filePath, textColors) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { ok: false };
  }
  if (!stat.isFile()) return { ok: false };
  const key = `${filePath}|${stat.mtimeMs}|${stat.size}|${textColors.light}|${textColors.dark}`;
  if (memo.has(key)) return memo.get(key);

  let result;
  try {
    const small = await sharp(filePath)
      .rotate()
      .resize({
        width: PRE_SCALE_EDGE,
        height: PRE_SCALE_EDGE,
        fit: 'inside',
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = small.info;
    const sample = await sharp(small.data, { raw: { width, height, channels } })
      .extract(bgSampleRect(width, height))
      .resize(BG_SAMPLE_SIZE, BG_SAMPLE_SIZE, { fit: 'fill' })
      .raw()
      .toBuffer();
    result = judgeBgTextContrast(sample, textColors);
  } catch (err) {
    log.warn(`cannot sample ${filePath}: ${err?.message || err}`);
    result = { ok: false };
  }
  if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value);
  memo.set(key, result);
  return result;
}

/**
 * Every slide list a deck body carries: the top-level one and each language
 * version's.
 * @param {Object} deck
 * @returns {Array<Object[]>}
 */
function slideLists(deck) {
  const lists = [];
  if (Array.isArray(deck?.slides)) lists.push(deck.slides);
  const versions = deck?.i18n?.versions;
  if (versions && typeof versions === 'object') {
    for (const version of Object.values(versions)) {
      if (Array.isArray(version?.slides)) lists.push(version.slides);
    }
  }
  return lists;
}

/**
 * Settle the text-contrast verdict on every slide whose background image has
 * none yet, in place. A slide already measured on its current image
 * (`slideBgAutoFor` names it) is left alone, so a save costs nothing once a
 * deck is settled; the theme is loaded only when something needs measuring.
 *
 * Mirrors the editor (`runBgContrastDetection`): a readable image gets
 * `slideBgAutoFor`, `slideBgTextAuto` and `slideBgNeedsScrim`, and an unset
 * `slideBgText` becomes `'auto'` so the renderer honours the verdict. An image
 * that cannot be read sets nothing.
 *
 * @param {Object} deck - a deck body (`slides`, `i18n.versions`), mutated
 * @param {Object} opts
 * @param {string|null} opts.repoRoot - installation root, for the served files
 * @param {() => Promise<Object|null>} opts.loadTheme - the deck's theme
 * @returns {Promise<number>} how many slides got a verdict
 */
export async function settleBgTextContrast(deck, { repoRoot, loadTheme }) {
  if (!repoRoot) return 0;
  const pending = [];
  for (const slides of slideLists(deck)) {
    for (const slide of slides) {
      const content = slide?.content;
      if (!content || typeof content !== 'object') continue;
      if (typeof content.slideBgImage !== 'string') continue;
      const url = content.slideBgImage.trim();
      if (!url || content.slideBgAutoFor === url) continue;
      const resolved = resolveServedAssetPath(repoRoot, url);
      if (resolved) pending.push({ content, url, filePath: resolved.path });
    }
  }
  if (!pending.length) return 0;

  const theme = await Promise.resolve()
    .then(loadTheme)
    .catch(() => null);
  const textColors = bgTextCandidates(theme);
  let settled = 0;
  for (const { content, url, filePath } of pending) {
    const result = await sampleBgTextContrastFile(filePath, textColors);
    if (!result.ok) continue;
    content.slideBgAutoFor = url;
    content.slideBgTextAuto = result.text;
    content.slideBgNeedsScrim = !!result.needsScrim;
    if (content.slideBgText == null) content.slideBgText = 'auto';
    settled += 1;
  }
  return settled;
}
