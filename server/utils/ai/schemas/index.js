/**
 * AI Schema Validation Module
 *
 * Re-exports the schema validators consumers actually import via this barrel.
 * Import sibling modules (`refined-slide.js`, `outline.js`) directly for the
 * individual Zod schemas.
 *
 * Usage:
 * ```js
 * import { validateSlideContent, validateOutlineResponse } from './schemas/index.js';
 *
 * // Validate Phase 2 slide content
 * const { valid, issues } = validateSlideContent('list-slide', content);
 *
 * // Validate Phase 1 outline response
 * const { valid, issues, data } = validateOutlineResponse(response);
 * ```
 */

// Phase 2: Refined slide content schemas
export { validateSlideContent } from './refined-slide.js';

// Phase 1: Outline response schemas
export { validateOutlineResponse } from './outline.js';
