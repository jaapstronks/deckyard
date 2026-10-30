/**
 * Content-addressed renderer bundles: building, verification and execution
 * through the Linux operator runner. Execution refuses unless
 * `RENDERER_RUNNER_SOCKET` names the runner's broker socket; test-only
 * trusted-fixture experiments establish reproducibility, not safety.
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
export {
  RUNNER_REQUEST_LIMIT,
  RUNNER_SOCKET_ENV,
  renderEditionInBundle,
  runnerSocketPath,
} from './host.js';
export {
  CURRENT_RENDERER_STORE,
  openCurrentRendererBundle,
} from './current.js';
export { EDITION_INPUT_SCHEMA } from './edition-input.js';
export {
  EDITION_MANIFEST_SCHEMA,
  buildEditionManifest,
  canonicalJson,
  canonicalJsonBytes,
  decodeDataUrl,
  verifyEditionInput,
} from './edition-manifest.js';
export { findUnsealableSlides } from './sealable.js';
