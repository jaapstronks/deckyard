/**
 * The AI slide-type catalog: which types an agent may author, and the
 * hand-written editorial copy that tells it when to pick each one.
 *
 * The copy is no longer written here, and no longer filed into category
 * modules. Every type declares it in its own
 * `shared/slide-types/types/<name>/ai.js`, and `./type-ai.js` — generated over
 * those directories — is the import list. Which "category module" a type's
 * prose used to sit in (structural / basic-content / visual-content / card /
 * diagram / people / interactive / media) was a filing decision nobody could
 * derive from the type, and it disagreed with the `category` field inside the
 * entries it held. The field survived; the filing did not.
 *
 * Key principles the copy itself follows:
 * - A specialized slide type is better than content-slide WHEN IT TRULY FITS
 * - Variety matters: avoid repetitive slide types in sequence
 * - Each slide type has specific strengths and anti-patterns
 *
 * ## Types deliberately without an `ai.js`
 *
 * Absence means "withheld from AI generation", and for a deprecated type that
 * is the point rather than a gap — `isAgentOptOut()` already withholds it, and
 * `tests/slide-type-companion-coverage.test.js` fails on an entry that outlives
 * the type it describes.
 */

import { SLIDE_TYPE_AI } from './type-ai.js';

/**
 * The order the catalog is *presented* in — to a model, not to a person.
 *
 * This is the one thing the category modules carried that was not a fact about
 * any type: three prompt surfaces iterate the catalog and emit one section per
 * type in map order (`buildPhase2CatalogPrompt`, `analyze-presentation.js`,
 * `refine-slides.js`), and an LLM does not read a list uniformly. So the order
 * survives the move as an explicit hint, the same split `group` made when the
 * picker's membership moved onto the types and `PICKER_GROUP_ORDER` stayed
 * behind: **the fact belongs to the type, the ordering belongs to the surface.**
 *
 * It is a *hint*, and partial by design: a type this list does not name sorts
 * after the ones it does (alphabetically among themselves), and a name here for
 * a type that no longer exists is ignored. So forgetting to place a new type
 * costs it a position in one prompt, never its presence.
 *
 * The sequence below is the one the category modules produced, preserved
 * deliberately rather than by accident — deck skeleton first, then content
 * types roughly by how often they fit, then people, interaction and media.
 *
 * @type {ReadonlyArray<string>}
 */
export const CATALOG_ORDER = Object.freeze([
  // The deck skeleton: opening, dividers, quote, closing.
  'title-slide',
  'chapter-title-slide',
  'quote-slide',
  'payoff-slide',
  'end-slide',
  // Content, plainest first — the prompt tells the model to prefer these.
  'content-slide',
  'list-slide',
  'image-text-slide',
  'image-slide',
  'gallery-slide',
  'table-slide',
  'chart-slide',
  'icon-card-grid-slide',
  'text-blocks-slide',
  'kpi-metrics-slide',
  'comparison-slide',
  'matrix-slide',
  'pyramid-slide',
  'funnel-slide',
  'cycle-slide',
  'process-slide',
  'timeline-slide',
  // People.
  'team-cards-slide',
  'logo-wall-slide',
  // The audience answers, or the slide runs on a clock.
  'poll-slide',
  'likert-slide',
  'likert-slider-slide',
  'feedback-slide',
  'countdown-slide',
  // Embedded payloads.
  'video-slide',
  'embed-slide',
]);

/**
 * Combined catalog of all core slide types, derived from the type directories
 * and laid out in `CATALOG_ORDER`.
 * @type {Readonly<Record<string, Object>>}
 */
const CORE_SLIDE_TYPE_CATALOG = Object.freeze(
  Object.fromEntries(
    Object.keys(SLIDE_TYPE_AI)
      .sort((a, b) => {
        const last = Number.MAX_SAFE_INTEGER;
        const rank = (t) => {
          const i = CATALOG_ORDER.indexOf(t);
          return i === -1 ? last : i;
        };
        return rank(a) - rank(b) || a.localeCompare(b);
      })
      .map((type) => [type, SLIDE_TYPE_AI[type]])
  )
);

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
