/**
 * A test-only slide type with a `markup: true` field.
 *
 * No core type declares author markup since the raw-HTML slide type left core
 * (A7.8b); the `code` field type and its `markup` flag stay as vocabulary a
 * fork type may declare. The reader projection and the publish alt-check
 * still honour that flag, so their tests need a definition that carries it —
 * shaped like a fork port of the retired type: sanitized HTML on the canvas,
 * a presentational `css` field beside it.
 */

import { escapeHtml } from '../../shared/slide-types/helpers.js';
import { sanitizeSlideHtmlSync } from '../../shared/sanitize.js';

export const MARKUP_SLIDE_TYPE = 'markup-test-slide';

/** @type {object} */
export const markupSlideType = {
  name: MARKUP_SLIDE_TYPE,
  label: 'Markup',
  fields: [
    { key: 'html', type: 'code', markup: true },
    { key: 'css', type: 'code', presentational: true },
  ],
  defaults: { html: '', css: '' },
  renderHtml(content, slide) {
    const html = sanitizeSlideHtmlSync(String(content?.html || ''));
    return `<section class="slide slide-markup-test" data-id="${escapeHtml(slide?.id || '')}"><div class="markup-root">${html}</div></section>`;
  },
};
