/**
 * Shared validation constants.
 *
 * What is left here is the fix pipeline's own behaviour: which types it repairs
 * an item count for, and which types do not count toward the slide budget.
 *
 * The max-length tables are gone (D87). They were a second spelling of
 * `fields[].maxLength` and disagreed with it in nineteen places; both
 * validators now read the declaration — strict through
 * `schemas/content-schema.js`, the fix pipeline through `truncate.js`. The
 * item-count *numbers* were already read off the definition; what stays is the
 * judgement about which three types get padded or downgraded rather than
 * refused, and that is behaviour, not a constraint.
 */

import { SLIDE_TYPES } from '../../../../shared/slide-types/registry.js';

// Slide types whose item count the AI validators enforce strictly. This is a
// behavioural judgement, not coverage: a type that is absent takes the default
// branch (no strict item check), which is usually the right answer — 19 other
// types also declare minItems/maxItems and are deliberately not listed here.
// The *numbers* are no judgement at all, so they are read off the definition
// (`fields[].minItems`/`maxItems`) instead of being written out a second time.
const ITEM_REQUIREMENT_TYPES = [
  'list-slide',
  'timeline-slide',
  'kpi-metrics-slide',
];

export const SLIDE_ITEM_REQUIREMENTS = Object.fromEntries(
  ITEM_REQUIREMENT_TYPES.map((type) => {
    const field = (SLIDE_TYPES[type]?.fields || []).find(
      (f) => f.minItems != null || f.maxItems != null,
    );
    if (!field) {
      throw new Error(
        `SLIDE_ITEM_REQUIREMENTS: "${type}" has no field with minItems/maxItems — ` +
          'remove it from ITEM_REQUIREMENT_TYPES or restore the constraint on its definition',
      );
    }
    return [
      type,
      { field: field.key, min: field.minItems, max: field.maxItems },
    ];
  }),
);

// Global accessibility fields that are added to all slide types
export const GLOBAL_A11Y_FIELDS = ['a11yTitle', 'a11ySummary'];

// Slide types that don't count toward "content" slide budget
export const NON_CONTENT_SLIDE_TYPES = new Set([
  'title-slide',
  'chapter-title-slide',
  'payoff-slide',
  'follow-invite-slide',
]);
