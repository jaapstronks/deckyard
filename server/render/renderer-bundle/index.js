/**
 * Content-addressed renderer bundles: building and verification are available.
 * Execution fails closed pending an OS-isolated runner. T1.1 remains blocked;
 * test-only trusted-fixture experiments establish reproducibility, not safety.
 * See docs/reference/renderer-bundle.md for evidence and the architecture gate.
 */

export {
  RENDERER_BUNDLE_SCHEMA,
  canonicalManifestBytes,
  isRendererHash,
  rendererHashFor,
  sha256Hex,
  sriFromSha256Hex,
} from './manifest.js';
export { RENDERER_BUNDLE_ERRORS, RendererBundleError } from './errors.js';
export {
  FILES_DIR,
  MANIFEST_NAME,
  PROVENANCE_NAME,
  listRendererBundles,
  openRendererBundle,
} from './store.js';
export { renderEditionInBundle } from './host.js';
export { EDITION_INPUT_SCHEMA } from './edition-input.js';
