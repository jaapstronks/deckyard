/**
 * The reader path: prepare, then render.
 *
 * This module applies the visibility filter an installation decides on and
 * hands the result to `./reader-document.js`, which assembles the semantic
 * reflowable document from that input alone. Same split as the canvas path
 * (`./html.js` + `./canvas-document.js`), for the same reason: a published
 * edition has to keep rendering from what was frozen when it was published
 * (`docs/reference/renderer-bundle.md`).
 */

import { filterForExport, filterForPublished } from '../utils/public-output.js';
import { renderReaderDocument } from './reader-document.js';

/**
 * Build the semantic reflowable HTML document for a presentation.
 *
 * @param {string} repoRoot - Repository root; the fork CSS seam is read from
 *   `custom/styles/` under it (server/utils/css-chain.js)
 * @param {object} pres
 * @param {object} [opts]
 * @param {'export'|'published'} [opts.context='export'] - visibility filter
 * @param {Record<string, object>|null} [opts.slideTypes=null] - merged registry
 * @param {string} [opts.canonicalUrl=''] - link to the canvas presentation view
 * @param {string} [opts.headHtml=''] - extra <head> markup (canonical/robots/OG)
 * @returns {string} a complete HTML document
 */
export function buildReaderHtml(
  repoRoot,
  pres,
  {
    context = 'export',
    slideTypes = null,
    canonicalUrl = '',
    headHtml = '',
  } = {},
) {
  const filtered =
    context === 'published'
      ? filterForPublished(pres, { slideTypes })
      : filterForExport(pres, { slideTypes });
  return renderReaderDocument(repoRoot, filtered, {
    storedSlides: Array.isArray(pres?.slides) ? pres.slides : null,
    slideTypes,
    canonicalUrl,
    headHtml,
  });
}
