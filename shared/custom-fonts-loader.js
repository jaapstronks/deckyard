/**
 * Custom Font Loader — the fork seam for `CURATED_FONTS`.
 *
 * `CURATED_FONTS` in `shared/theme-fonts.js` and `scripts/google-fonts.lock.json`
 * are two halves of one contract, and only one of them was ever fork-writable.
 * A fork that added a family got a clean merge and then a failing `npm install`
 * ("<family> not in the lockfile"), because the lock ships from upstream and is
 * written by a core script (B163). The message was right; the coupling was the
 * problem.
 *
 * The seam splits the pair instead of loosening it. A fork declares its families
 * in `custom/fonts.js` and pins them in `custom/google-fonts.lock.json` — the
 * same two halves, both on the fork's side of the line, both written by the same
 * `--update-lock` run. The lockfile stays a contract; it just stops being *one*
 * file two owners have to share.
 *
 * Expected shape (gitignored upstream, tracked in the fork):
 *
 *   // custom/fonts.js
 *   export default [
 *     { family: 'League Spartan', category: 'sans-serif', weights: [400, 700] },
 *   ];
 *
 * Node-only, like `shared/slide-types/custom-loader.js`: the browser gets core's
 * list. A fork family reaches the client through the theme it is used in, whose
 * `@font-face` rules are served from the fork's own pins.
 */

import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The declaration half of the seam. */
export const CUSTOM_FONTS_FILE = join(REPO_ROOT, 'custom', 'fonts.js');

/** The pin half. Same shape as `scripts/google-fonts.lock.json`. */
export const CUSTOM_FONTS_LOCK_PATH = join(
  REPO_ROOT,
  'custom',
  'google-fonts.lock.json',
);

/** Repo-relative spellings, for messages that have to be pasteable. */
export const CUSTOM_FONTS_FILE_REL = 'custom/fonts.js';
export const CUSTOM_FONTS_LOCK_REL = 'custom/google-fonts.lock.json';

/** The categories the font picker groups by; anything else has no home. */
const CATEGORIES = ['sans-serif', 'serif', 'display', 'monospace'];

/**
 * Validate one declared family, returning why it is unusable or null.
 *
 * Rejecting loudly here is the point: a malformed entry that merely fails to
 * appear would surface as "our font is gone" on a deck, three steps from the
 * file that caused it.
 *
 * @param {unknown} font - one entry from the fork's default export
 * @param {Set<string>} taken - families already claimed (core, then earlier fork entries)
 * @returns {string|null} the complaint, or null when the entry is well-formed
 */
export function customFontProblem(font, taken) {
  if (!font || typeof font !== 'object') return 'not an object';
  const { family, category, weights } = /** @type {any} */ (font);
  if (typeof family !== 'string' || !family.trim())
    return 'missing a "family" string';
  if (!CATEGORIES.includes(category))
    return `"${family}": category must be one of ${CATEGORIES.join(', ')}`;
  if (!Array.isArray(weights) || weights.length === 0)
    return `"${family}": weights must be a non-empty array`;
  if (!weights.every((w) => Number.isInteger(w) && w >= 100 && w <= 900))
    return `"${family}": weights must be integers between 100 and 900`;
  if (taken.has(family))
    return `"${family}": already curated upstream — drop the entry, or rename yours`;
  return null;
}

/**
 * Load the fork's declared families, if any.
 *
 * @param {Array<{family: string}>} coreFonts - the upstream curated list
 * @returns {Promise<Array<{family: string, category: string, weights: number[]}>>}
 *   validated fork families, in declaration order; empty upstream
 */
export async function loadCustomFonts(coreFonts = []) {
  if (!existsSync(CUSTOM_FONTS_FILE)) return [];

  let declared;
  try {
    const mod = await import(pathToFileURL(CUSTOM_FONTS_FILE).href);
    declared = mod.default ?? mod.CUSTOM_FONTS;
  } catch (err) {
    // stderr, not stdout: this module is reached from tools whose stdout is a
    // data contract, the same constraint shared/slide-types/custom-loader.js has.
    console.error(
      `[custom-fonts] failed to load ${CUSTOM_FONTS_FILE_REL}: ${err.message}`,
    );
    return [];
  }

  if (!Array.isArray(declared)) {
    console.warn(
      `[custom-fonts] ${CUSTOM_FONTS_FILE_REL} must default-export an array of ` +
        'font entries — ignored',
    );
    return [];
  }

  const taken = new Set(coreFonts.map((f) => f.family));
  const accepted = [];
  for (const font of declared) {
    const problem = customFontProblem(font, taken);
    if (problem) {
      console.warn(`[custom-fonts] skipping entry — ${problem}`);
      continue;
    }
    taken.add(font.family);
    accepted.push({
      family: font.family,
      category: font.category,
      weights: [...font.weights],
    });
  }

  if (accepted.length) {
    console.warn(
      `[custom-fonts] loaded ${accepted.length} fork font(s): ` +
        accepted.map((f) => f.family).join(', '),
    );
  }
  return accepted;
}
