/**
 * Which slides a render bundle cannot derive from the edition input alone.
 *
 * One rule, two callers. The render entry (`./bundle/entry.js`) refuses the
 * first unsealable slide it meets; the edition-input builder
 * (`server/export/edition-input.js`) reports all of them, so an author sees the
 * whole list before publishing instead of one refusal per attempt
 * (`docs/plans/briefs/publication-records.md` § Q3).
 *
 * Both refusals are about the same missing dependency - the HTML sanitizer,
 * whose `jsdom`/`dompurify` are outside every bundle:
 *
 *   1. A slide type this bundle does not know. In practice that is a
 *      database-backed type, whose template sanitises its interpolated output
 *      on every render. Rendering it from the *current* registry instead would
 *      make the edition mutable, which is the thing being prevented.
 *   2. Author markup in a `markup: true` field, which the live canvas
 *      sanitises. Rendering it here would escape it instead: the same deck,
 *      quietly different.
 *
 * Pure and bundle-safe: the entry imports it from inside the sealed worker.
 */

import {
  SLIDE_TYPES,
  getSlideType,
} from '../../../shared/slide-types/registry.js';

/**
 * @typedef {Object} UnsealableSlide
 * @property {'unknown_slide_type'|'author_markup'} reason
 * @property {number} index - Zero-based position in the list
 * @property {string|null} type
 * @property {string|null} field - The markup field, for `author_markup`
 * @property {string} message
 */

/**
 * Every slide in one list that the bundle cannot render from the input.
 *
 * @param {Array<object>} slides - One slide list of a projected deck
 * @param {Record<string, object>} [registry] - Defaults to the bundle's own;
 *   tests pass one to reach the fork-type half
 * @returns {UnsealableSlide[]}
 */
export function findUnsealableSlides(slides, registry = SLIDE_TYPES) {
  const out = [];
  const list = Array.isArray(slides) ? slides : [];
  for (const [index, slide] of list.entries()) {
    const def = getSlideType(slide?.type, registry);
    if (!def) {
      out.push({
        reason: 'unknown_slide_type',
        index,
        type: slide?.type ?? null,
        field: null,
        message: `slide ${index + 1} has type "${slide?.type}", which this render bundle does not carry; a database-backed slide type cannot be frozen into an edition (docs/reference/renderer-bundle.md)`,
      });
      continue;
    }
    for (const field of Array.isArray(def.fields) ? def.fields : []) {
      if (field?.markup !== true) continue;
      const value = slide?.content?.[field.key];
      if (typeof value === 'string' && value.trim()) {
        out.push({
          reason: 'author_markup',
          index,
          type: slide.type,
          field: field.key,
          message: `slide ${index + 1} (${slide.type}) carries author markup in "${field.key}", which needs the HTML sanitizer; that dependency is not in the render bundle`,
        });
      }
    }
  }
  return out;
}
