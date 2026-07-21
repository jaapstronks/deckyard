/**
 * AI Slide Type Definitions
 *
 * This file re-exports slide type definitions from category-specific modules.
 * Edit the individual files to modify slide type definitions:
 *
 * - structural-slides.js: title, chapter, quote, payoff
 * - content-slides.js: content, lijstje, timeline, cards, etc.
 * - people-slides.js: team cards, logo wall
 * - interactive-slides.js: poll, likert, feedback
 * - media-slides.js: video
 *
 * Key principles:
 * - A specialized slide type is ALWAYS better than content-slide when it fits
 * - Variety matters: avoid repetitive slide types in sequence
 * - Each slide type has specific strengths and anti-patterns
 */

// Re-export from category modules
export { STRUCTURAL_SLIDES } from './structural-slides.js';
export { CONTENT_SLIDES } from './content-slides.js';
export { PEOPLE_SLIDES } from './people-slides.js';
export { INTERACTIVE_SLIDES } from './interactive-slides.js';
export { MEDIA_SLIDES } from './media-slides.js';

// Import for combined catalog
import { STRUCTURAL_SLIDES } from './structural-slides.js';
import { CONTENT_SLIDES } from './content-slides.js';
import { PEOPLE_SLIDES } from './people-slides.js';
import { INTERACTIVE_SLIDES } from './interactive-slides.js';
import { MEDIA_SLIDES } from './media-slides.js';

/**
 * Combined catalog of all core slide types
 */
const CORE_SLIDE_TYPE_CATALOG = {
  ...STRUCTURAL_SLIDES,
  ...CONTENT_SLIDES,
  ...PEOPLE_SLIDES,
  ...INTERACTIVE_SLIDES,
  ...MEDIA_SLIDES,
};

/**
 * Combined catalog of all slide types (core + custom)
 * Custom types are loaded lazily and merged via getFullSlideCatalog()
 */
export let SLIDE_TYPE_CATALOG = { ...CORE_SLIDE_TYPE_CATALOG };

/**
 * Merge custom AI definitions into the catalog.
 *
 * Called during server startup after custom types are loaded. The merge is a
 * per-key overlay, not a blanket replace, so a fork can do two things:
 *  - **Add** a brand-new type — the key doesn't exist in core, so the whole
 *    custom entry is set as-is (this is what `custom/slide-types/*.js` does).
 *  - **Override** a core type's AI copy — the key matches a core type, so the
 *    partial custom entry is overlaid onto the core entry. Overriding just
 *    `description`/`bestFor`/`notFor` leaves the core `schema`/`allowedIcons`
 *    intact (this is what `custom/ai/catalog.js` does; see
 *    `custom-catalog-loader.js`).
 *
 * @param {Object} customCatalog - Custom AI definitions (full new entries and/or
 *   partial core overrides), keyed by type name.
 */
export function mergeCustomAiCatalog(customCatalog) {
  if (customCatalog && typeof customCatalog === 'object') {
    const merged = { ...CORE_SLIDE_TYPE_CATALOG };
    for (const [type, entry] of Object.entries(customCatalog)) {
      merged[type] = CORE_SLIDE_TYPE_CATALOG[type]
        ? { ...CORE_SLIDE_TYPE_CATALOG[type], ...entry } // override core copy, keep schema/allowedIcons
        : entry; // brand-new custom type
    }
    SLIDE_TYPE_CATALOG = merged;
  }
}

/**
 * Get the core slide type catalog (without custom types)
 * @returns {Object} Core slide type definitions
 */
export function getCoreSlideCatalog() {
  return CORE_SLIDE_TYPE_CATALOG;
}