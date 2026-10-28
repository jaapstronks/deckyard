/**
 * The renderer this installation would publish with: the one bundle its image
 * carries.
 *
 * The Docker image builds its own renderer into `renderer-store/` at build
 * time (`Dockerfile`, stage `renderer-bundle`). That directory is what an
 * operator exports to the runner host and registers after a release
 * (`scripts/export-renderer-bundle.sh`, docs/ops/renderer-runner.md), and its
 * hash is what the doctor probes the runner with. A checkout has no store
 * until somebody builds one: `node scripts/build-renderer-bundle.js --store
 * renderer-store`.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { repoRoot } from '../../config/paths.js';
import { RENDERER_BUNDLE_ERRORS, RendererBundleError } from './errors.js';
import { isRendererHash } from './manifest.js';
import { openRendererBundle } from './store.js';

/** Where the image keeps the bundle it was built with. */
export const CURRENT_RENDERER_STORE = path.join(repoRoot, 'renderer-store');

/**
 * Open and verify the installation's own bundle.
 *
 * @param {string} [storeDir] - Defaults to {@link CURRENT_RENDERER_STORE}
 * @returns {Promise<import('./store.js').OpenRendererBundle>}
 * @throws {RendererBundleError} `renderer_bundle_unknown` when the store holds
 *   no bundle or more than one; any verification refusal of the bundle itself.
 */
export async function openCurrentRendererBundle(
  storeDir = CURRENT_RENDERER_STORE,
) {
  let names;
  try {
    names = await readdir(storeDir);
  } catch {
    names = [];
  }
  const hashes = names.filter(isRendererHash);
  if (hashes.length !== 1)
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.UNKNOWN,
      hashes.length
        ? `${storeDir} holds ${hashes.length} render bundles; an installation carries exactly one`
        : `no render bundle in ${storeDir}`,
      { storeDir, count: hashes.length },
    );
  return openRendererBundle(storeDir, hashes[0]);
}
