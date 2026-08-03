/**
 * AI Schema Validation Module
 *
 * Re-exports the schema validators consumers actually import via this barrel.
 * Import the sibling module (`refined-slide.js`) directly for the individual
 * Zod schemas.
 *
 * Usage:
 * ```js
 * import { validateSlideContent } from './schemas/index.js';
 *
 * // Validate Phase 2 slide content
 * const { valid, issues } = validateSlideContent('list-slide', content);
 * ```
 */

// Phase 2: Refined slide content schemas
export { validateSlideContent } from './refined-slide.js';
