/**
 * Shared validation constants.
 *
 * Central home for the item-count requirements, max-length tables, and slide
 * type groupings used by the fix pipeline and the strict validator. Keeping
 * them here avoids the two validators drifting apart.
 */

import { SLIDE_TYPES } from '../../../../shared/slide-types/registry.js';

// Slide types whose item count the AI validators enforce strictly. This is a
// behavioural judgement, not coverage: a type that is absent takes the default
// branch (no strict item check), which is usually the right answer — 19 other
// types also declare minItems/maxItems and are deliberately not listed here.
// The *numbers* are no judgement at all, so they are read off the definition
// (`fields[].minItems`/`maxItems`) instead of being written out a second time.
const ITEM_REQUIREMENT_TYPES = ['list-slide', 'timeline-slide', 'kpi-metrics-slide'];

export const SLIDE_ITEM_REQUIREMENTS = Object.fromEntries(
  ITEM_REQUIREMENT_TYPES.map((type) => {
    const field = (SLIDE_TYPES[type]?.fields || []).find(
      (f) => f.minItems != null || f.maxItems != null
    );
    if (!field) {
      throw new Error(
        `SLIDE_ITEM_REQUIREMENTS: "${type}" has no field with minItems/maxItems — ` +
          'remove it from ITEM_REQUIREMENT_TYPES or restore the constraint on its definition'
      );
    }
    return [type, { field: field.key, min: field.minItems, max: field.maxItems }];
  })
);

// Global accessibility fields that are added to all slide types
export const GLOBAL_A11Y_FIELDS = ['a11yTitle', 'a11ySummary'];

// Max lengths for common fields (to avoid validation errors)
export const MAX_LENGTHS = {
  title: 120,
  subheading: 200,
  body: 2000,
  // list-slide items
  'items.title': 80,
  'items.text': 120,
  // card types (icon-card-grid, team-cards)
  cardLabel: 40,
  cardBody: 800,
  // text-blocks-slide
  blockTitle: 80,
  blockBody: 200,
  // timeline items
  'items.time': 60,
  // quote
  quote: 280,
  authorName: 80,
  authorTitle: 120,
  // misc
  tagline: 120,
  caption: 200,
};

// Max length table used both by truncation (fix mode) and strict validation.
// Mirrors MAX_LENGTHS / item-level limits defined elsewhere in this file.
export const STRICT_TEXT_LIMITS = {
  title: MAX_LENGTHS.title,
  subheading: MAX_LENGTHS.subheading,
  body: MAX_LENGTHS.body,
  tagline: MAX_LENGTHS.tagline,
  caption: MAX_LENGTHS.caption,
  quote: MAX_LENGTHS.quote,
  authorName: MAX_LENGTHS.authorName,
  authorTitle: MAX_LENGTHS.authorTitle,
};

export const STRICT_ITEM_LIMITS = {
  title: MAX_LENGTHS['items.title'],
  text: MAX_LENGTHS['items.text'],
  time: MAX_LENGTHS['items.time'],
};

// Slide types that don't count toward "content" slide budget
export const NON_CONTENT_SLIDE_TYPES = new Set([
  'title-slide',
  'chapter-title-slide',
  'payoff-slide',
  'follow-invite-slide',
]);
