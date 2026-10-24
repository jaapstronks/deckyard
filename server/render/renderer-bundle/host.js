/**
 * Production entry fails closed until an OS-isolated runner is available.
 * Node permissions and module filtering cannot sandbox historical code.
 * Reproducibility experiments use a separate trusted-fixture test helper.
 */
import { RENDERER_BUNDLE_ERRORS, RendererBundleError } from './errors.js';

/**
 * Refuse execution before reading or running any bundle code.
 * No fallback to the current renderer or to the test-only runner.
 * @returns {Promise<never>}
 */
export async function renderEditionInBundle() {
  throw new RendererBundleError(
    RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE,
    'Renderer execution requires an OS-isolated runner; Node permissions and import filtering are not a sandbox',
  );
}
