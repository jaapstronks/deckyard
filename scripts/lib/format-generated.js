/**
 * Run a generator's output through Prettier before it is compared or written.
 *
 * WHY THIS EXISTS
 * Every generated source file in the repo is gated byte-for-byte against what
 * its generator produces (the slide-type aggregators, the slide-type docs). The
 * repo is also formatted by Prettier and CI checks it (`npm run format:check`).
 * Two spellings of "well-formed" cannot coexist: either the generators emit
 * Prettier-clean output, or every regeneration undoes the formatter and every
 * `npm run format` breaks the gate. So the generators hand their string to
 * Prettier with the repo config — one spelling, and the gate stays exact.
 *
 * Resolved per file path so `.prettierrc` and the per-language parser apply
 * exactly as they do for `prettier --write`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

/** Repo root, so callers can pass repo-relative output paths. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Format `source` as Prettier would format the file at `relPath`.
 * @param {string} relPath - repo-relative path of the file being generated
 * @param {string} source - the generator's raw output
 * @returns {Promise<string>}
 */
export async function formatGenerated(relPath, source) {
  const filepath = path.join(REPO_ROOT, relPath);
  const config = await prettier.resolveConfig(filepath);
  return prettier.format(source, { ...config, filepath });
}
