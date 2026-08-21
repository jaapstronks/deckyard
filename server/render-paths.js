/**
 * The render-path register: every module that assembles a complete deck document.
 *
 * Deckyard emits `<!doctype html>` in seventeen places, but only a handful of
 * those are *render paths* — documents that project a presentation for a reader.
 * The rest are error pages, e-mail bodies and Puppeteer measuring harnesses that
 * happen to be HTML. That distinction used to live nowhere: the closest thing to
 * a list was a hard-coded object literal inside `tests/fork-css-seam.test.js`,
 * which meant "add a ninth path" and "forget the fork seam in the ninth path"
 * were the same commit.
 *
 * This module is that list, promoted to a thing code can iterate:
 *
 *   - `tests/fork-css-seam.test.js` builds every registered path and asserts the
 *     seam lands last in each — it no longer keeps its own copy of the list.
 *   - `tests/render-path-registry.test.js` asserts the register is *complete*:
 *     a new deck-document builder that is not registered fails the suite.
 *
 * **Uniform signature.** Every `build` takes `(repoRoot, pres, options)` and
 * returns a document string (or a promise of one), so a caller can loop without
 * knowing which path it is holding. Paths that render a single slide rather than
 * a whole deck declare `scope: 'slide'` and receive `pres.slides[0]`; the
 * adapter below is where that unwrapping happens, not at the call site.
 *
 * **Imports are eager on purpose.** A register whose entries have to be awaited
 * before they can be inspected is a lookup table, not a register — and the
 * consumers (a test loop, a lint gate) want the whole set at once. The cost is
 * that importing this module imports the export builders; nothing in the request
 * path does, and nothing should need to.
 */

import { buildSlidesPdfHtml } from './export/pdf-slides.js';
import { buildSlidesPngExportHtml } from './export/png-slides.js';
import { buildStandaloneHtml } from './export/html.js';
import { buildPrintHtml } from './export/print.js';
import { buildSlidePngHtml } from './render/png.js';
import {
  buildSlidePreviewHtml,
  buildSingleSlidePreviewHtml,
} from './mcp/preview.js';
import { buildEmbedHtml } from './utils/embed-html/index.js';
import { buildReaderHtml } from './export/reader.js';

/**
 * Document shape. `canvas` paths project the deck onto the fixed 1600×900 stage
 * and share the core slide CSS; `reflow` paths are semantic re-projections with
 * a stylesheet of their own (see docs/reference/fork-setup.md § two chains).
 */
export const RENDER_PATH_KINDS = Object.freeze(['canvas', 'reflow']);

/** What a path renders: the whole deck, or one slide of it. */
export const RENDER_PATH_SCOPES = Object.freeze(['deck', 'slide']);

/**
 * @typedef {Object} RenderPath
 * @property {string} name - Stable identifier, `<dir>/<module>` shaped. Test
 *   output and lint messages address a path by this, so it outlives renames.
 * @property {string} module - Repo-relative path of the module that owns the
 *   `<!doctype html>` template literal.
 * @property {'canvas'|'reflow'} kind - Document shape.
 * @property {'deck'|'slide'} scope - Whole deck, or a single slide.
 * @property {(repoRoot: string, pres: object, options?: object) => string|Promise<string>} build
 *   Assemble the document. Uniform across paths; single-slide builders are
 *   adapted here rather than at the call site.
 */

/** @type {ReadonlyArray<RenderPath>} */
export const RENDER_PATHS = Object.freeze([
  {
    name: 'export/pdf-slides',
    module: 'server/export/pdf-slides.js',
    kind: 'canvas',
    scope: 'deck',
    build: (repoRoot, pres, options = {}) =>
      buildSlidesPdfHtml(repoRoot, pres, options),
  },
  {
    name: 'export/png-slides',
    module: 'server/export/png-slides.js',
    kind: 'canvas',
    scope: 'deck',
    build: (repoRoot, pres, options = {}) =>
      buildSlidesPngExportHtml(repoRoot, pres, options),
  },
  {
    name: 'export/html',
    module: 'server/export/html.js',
    kind: 'canvas',
    scope: 'deck',
    build: (repoRoot, pres, options = {}) =>
      buildStandaloneHtml(repoRoot, pres, options),
  },
  {
    name: 'export/print',
    module: 'server/export/print.js',
    kind: 'canvas',
    scope: 'deck',
    build: (repoRoot, pres, options = {}) =>
      buildPrintHtml(repoRoot, pres, options),
  },
  {
    name: 'render/png',
    module: 'server/render/png.js',
    kind: 'canvas',
    scope: 'slide',
    build: (repoRoot, pres, options = {}) =>
      buildSlidePngHtml(repoRoot, firstSlide(pres), options),
  },
  {
    name: 'mcp/preview (list)',
    module: 'server/mcp/preview.js',
    kind: 'canvas',
    scope: 'deck',
    build: (repoRoot, pres, options = {}) =>
      buildSlidePreviewHtml(slidesOf(pres), {
        title: pres?.title || 'Slide Preview',
        ...options,
        repoRoot,
      }),
  },
  {
    name: 'mcp/preview (single)',
    module: 'server/mcp/preview.js',
    kind: 'canvas',
    scope: 'slide',
    build: (repoRoot, pres, options = {}) =>
      buildSingleSlidePreviewHtml(firstSlide(pres), { ...options, repoRoot }),
  },
  {
    name: 'utils/embed-html',
    module: 'server/utils/embed-html/template.js',
    kind: 'canvas',
    scope: 'deck',
    build: (repoRoot, pres, options = {}) =>
      buildEmbedHtml(repoRoot, pres, options),
  },
  {
    // The one reflow path: a semantic re-projection with a stylesheet of its
    // own, sharing nothing with the canvas vocabulary (no `.slide`, no `--t-*`).
    // Being a different document is why it has a second chain; being a render
    // path is why it still ends in the same fork seam.
    name: 'export/reader',
    module: 'server/export/reader.js',
    kind: 'reflow',
    scope: 'deck',
    build: (repoRoot, pres, options = {}) =>
      buildReaderHtml(repoRoot, pres, options),
  },
]);

/**
 * Modules that emit `<!doctype html>` without being a render path.
 *
 * Listing them is what lets the completeness check in
 * `tests/render-path-registry.test.js` be an assertion rather than a warning:
 * a new document builder is either a render path or it is named here, and
 * "neither" fails. Each entry carries why it is not a render path — a reason
 * that stops applying is how a path sneaks back out of the register.
 */
export const NON_RENDER_PATH_DOCUMENTS = Object.freeze({
  'server/routes/static/embed.js':
    'error page shown when a render path threw — deliberately renders no deck',
  'server/routes/public-api/v1/index.js':
    'Swagger UI shell for /api/v1/docs — API documentation, not a deck',
  'server/render/pdf-to-images.js':
    'Puppeteer harness that paints an already-rendered PDF onto canvases',
  'server/export/gradient-raster.js':
    'measuring harness: rasterises gradients the CSS chain already resolved',
  'server/export/image-measure.js':
    'measuring harness: reads intrinsic image sizes in a headless page',
  'server/utils/sandbox-og-image.js':
    'social-card image for the sandbox landing page — no presentation involved',
  'server/integrations/email-templates/export.js': 'transactional e-mail body',
  'server/integrations/email-templates/helpers.js': 'transactional e-mail body',
  'server/integrations/email-templates/notifications.js':
    'transactional e-mail body',
  'server/integrations/email-templates/digest.js': 'transactional e-mail body',
});

/**
 * Look one render path up by name.
 *
 * @param {string} name - A `RenderPath.name`
 * @returns {RenderPath|undefined}
 */
export function getRenderPath(name) {
  return RENDER_PATHS.find((p) => p.name === name);
}

/**
 * Build every registered path from one presentation.
 *
 * @param {string} repoRoot - Repository root path
 * @param {object} pres - Presentation object; `scope: 'slide'` paths get slide 1
 * @param {object} [options] - Passed through to each builder
 * @returns {Promise<Record<string, string>>} path name -> document HTML
 */
export async function buildAllRenderPaths(repoRoot, pres, options = {}) {
  const out = {};
  for (const path of RENDER_PATHS) {
    out[path.name] = await path.build(repoRoot, pres, options);
  }
  return out;
}

/** @param {object} pres @returns {object[]} */
function slidesOf(pres) {
  return Array.isArray(pres?.slides) ? pres.slides : [];
}

/** @param {object} pres @returns {object|undefined} */
function firstSlide(pres) {
  return slidesOf(pres)[0];
}
