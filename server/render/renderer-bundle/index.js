/**
 * Render bundles: the seam.
 *
 * A **render bundle** is the renderer a published edition was published with,
 * frozen: the transitive code, the core CSS and the fork seam, content-hashed
 * into one identity. Rendering an edition means opening the bundle its manifest
 * names and running it in a sealed worker on frozen input - never the current
 * renderer, never a fallback.
 *
 * This is the technical proof of T1.1, not a live publishing contract: nothing
 * in the request path calls it yet. What it establishes is that the renderer
 * *can* be closed, which the storage design of T1.3 onwards depends on. Read
 * `docs/reference/renderer-bundle.md` for the dependency map it closed, the
 * boundaries it holds and the two edges it did not close.
 *
 * Building a bundle is an operator action, so the builder lives with the other
 * build tooling: `scripts/build-renderer-bundle.js`.
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
  RENDER_LIMITS,
  renderEditionInBundle,
  rendererWorkerArgs,
  workerEnv,
} from './host.js';
export { EDITION_INPUT_SCHEMA } from './edition-input.js';
