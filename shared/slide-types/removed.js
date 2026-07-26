/**
 * Core slide types that used to exist and no longer do.
 *
 * A removed type does not simply vanish: decks stored before the removal still
 * carry its `type` string, and parts of the codebase legitimately keep naming it
 * (a DB migration records the conversion; a successor type explains where an odd
 * field shape came from). Everything else — a stale comment, a doc row, a
 * hand-written list in a test — is rot, and rot is what made the freeform
 * removal a 25-file archaeology exercise (see
 * `docs/reference/slide-type-removal.md`).
 *
 * So the record is explicit, and `tests/removed-slide-types.test.js` enforces it
 * in both directions:
 *
 * - no file outside `allowedReferences` may name a removed type;
 * - every path in `allowedReferences` must still name it, so the list cannot
 *   quietly become a junk drawer.
 *
 * Adding an entry here is the last step of a removal. The test then reports
 * every leftover reference as a worklist, instead of leaving them to `grep` and
 * good intentions.
 *
 * @typedef {Object} RemovedSlideType
 * @property {string} removed - When it went, and under which change.
 * @property {string|null} successor - Registered type stored decks should move
 *   to, or `null` when there is no equivalent.
 * @property {string} reason - Why it was removed, in one line.
 * @property {string|null} migration - Path to the migration that converted
 *   stored decks, or `null` when no deck used the type.
 * @property {Record<string, string>} allowedReferences - `path` → why this file
 *   is allowed to keep naming the type.
 */

/** @type {Record<string, RemovedSlideType>} */
export const REMOVED_SLIDE_TYPES = {
  'agenda-timeline-slide': {
    removed: 'consolidated into timeline-slide (DB migration 030)',
    successor: 'timeline-slide',
    reason:
      'visually near-identical to timeline-slide; two types for one layout, ' +
      'differing only in field names (time/label/body vs date/text).',
    migration:
      'server/db/migrations/030_migrate_agenda_timeline_to_timeline.js',
    allowedReferences: {
      'server/db/migrations/030_migrate_agenda_timeline_to_timeline.js':
        'the migration itself — it converts stored decks and must name both types',
      'shared/slide-types/types/timeline-slide.js':
        'the successor explains where the legacy {time,label,body} item shape comes from',
      'server/utils/ai/schemas/refined-slide.js':
        'the AI schema accepts the legacy `time` field and says why',
      'docs/reference/slide-type-removal.md':
        'cites this removal as the model case: migrated, with a successor',
    },
  },
  'freeform-slide': {
    removed: '2026-07-26, PR #377',
    successor: null,
    reason:
      'a free-positioning canvas: too easy to make inaccessible slides, no ' +
      'semantic projection (it degraded to nothing in the reader/reflow view), ' +
      'and it never earned an authoring surface after #252 retired the canvas editor.',
    migration: null, // scan-slide-type.js reported no decks using it
    allowedReferences: {
      'tests/slide-types-policy.test.js':
        'asserts the type is off the registry and a stored slide degrades safely',
      'docs/reference/slide-type-removal.md':
        'the removal checklist uses this removal as its worked example',
    },
  },
};

/** @type {string[]} */
export const REMOVED_SLIDE_TYPE_NAMES = Object.keys(REMOVED_SLIDE_TYPES);

/**
 * The removal record for a type name, or `undefined` if it was never a core
 * type (or is still registered). Lets a caller tell "this type was deliberately
 * removed, and here is where its content should go" apart from "no idea what
 * this is" — a distinction the generic unknown-type render cannot make today.
 *
 * @param {string} name
 * @returns {RemovedSlideType|undefined}
 */
export function getRemovedSlideType(name) {
  if (typeof name !== 'string' || !name) return undefined;
  return Object.prototype.hasOwnProperty.call(REMOVED_SLIDE_TYPES, name)
    ? REMOVED_SLIDE_TYPES[name]
    : undefined;
}
