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
 * @property {boolean} [losslessRename] - `true` when moving to `successor` is a
 *   pure rename: the two names share one field schema, so only the `type`
 *   string changes and `content` is left byte for byte alone. This is the one
 *   claim the schema funnel acts on — `SCHEMA_MIGRATIONS` rewrites the stored
 *   name on read for every entry that declares it, so the move reaches every
 *   install and every storage backend without a script being run. Declare it
 *   only when it is literally true: a successor that renames fields
 *   (`agenda-timeline-slide`) or adds them (`card-stack-slide`) is a
 *   conversion, and a conversion is never *derived* from `successor`. It
 *   reaches the funnel only by being written out in a step of its own, for
 *   that one type, after somebody decided it — which is what the v12 -> v13
 *   step does for `agenda-timeline-slide` (D80).
 * @property {string[]} migrations - Paths of the migrations that converted
 *   stored decks, in the order they ran. Empty when no deck used the type, or
 *   when the render contract degrades stored slides instead of converting
 *   them. More than one when a later migration finishes what an earlier one
 *   left half-applied.
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
    // 030 renamed the type and folded the items, but only in
    // `presentations.slides` and each snapshot's `slides` array — it skipped
    // `i18n` deliberately, so ~20 live fork decks kept the retired type in
    // every non-dominant language version and rendered *archived* there. 081
    // finishes it across `presentations.i18n` and the snapshot column; the
    // v12 -> v13 funnel step is what makes it true on every install and
    // backend, SQL or not (D80/B225).
    migrations: [
      'server/db/migrations/030_migrate_agenda_timeline_to_timeline.js',
      'server/db/migrations/081_backfill_agenda_timeline_i18n.js',
    ],
    allowedReferences: {
      'server/db/migrations/030_migrate_agenda_timeline_to_timeline.js':
        'the migration itself — it converts stored decks and must name both types',
      'server/db/migrations/081_backfill_agenda_timeline_i18n.js':
        'the backfill that finishes 030 across the columns it skipped; it must name what it converts',
      'shared/slide-types/schema-version.js':
        'the v12 -> v13 funnel step converts this one type by name, because a conversion is never derived from `successor`',
      'docs/reference/slide-type-removal.md':
        'cites this removal as the model case: migrated, with a successor',
      'tests/unresolved-slide-render.test.js':
        'the render contract needs a removal WITH a successor to pin the "rebuild it as X" promise',
      'tests/schema-version.test.js':
        'the unit tests of the v12 -> v13 step need a deck carrying the retired type, and the "conversions are left alone" assertion has to exclude the one the funnel converts by name',
      'tests/agenda-timeline-i18n-funnel.test.js':
        'the end-to-end test that a stored translation on the retired type reads back converted; the stored row has to carry the real name',
      'tests/pg/agenda-timeline-i18n-backfill.pgtest.js':
        'the real-PostgreSQL test of the backfill: it seeds rows carrying the retired type',
    },
  },
  'card-stack-slide': {
    removed:
      '2026-08-02, PR #543 (finishing the deprecated-layer removal, A7.8)',
    successor: 'icon-card-grid-slide',
    reason:
      'a coloured "stack of cards" list, archived (deprecated: true) and ' +
      'superseded by icon-card-grid-slide, which carries the same items[] ' +
      'card shape and adds icons. Removed as the last rung of the deprecation ' +
      'ladder; the render contract degrades stored decks to an archived slide ' +
      'that names icon-card-grid as the rebuild target.',
    // No numbered conversion migration: card-stack and icon-card-grid do not
    // share a lossless field schema (icon-card-grid adds icon/link), so the
    // move is a manual rebuild, not a rename. scripts/migrate-slides.js offers
    // the conversion for anyone who wants it; the archived-slide render keeps
    // every stored field visible for decks left on the type.
    migrations: [],
    allowedReferences: {
      'server/db/migrations/021_terminology_standardization.js':
        'a past migration that copied cardNLabel→cardNTitle on this type; it must keep naming it to stay a faithful record of what it did',
      'scripts/migrate-slides.js':
        'the standalone card-stack→icon-card-grid conversion for file-store installs and exports; it names both types by design',
      'tests/slide-types-policy.test.js':
        'asserts the type is off the registry and a stored slide degrades safely',
      'tests/collab-deck-ydoc.test.js':
        'the fixture for the undeclared-key rule (D79) needs a type that declares nothing at all — a removed one is exactly that, and it is what the fork actually stores',
      'docs/reference/slide-type-removal.md':
        'the render contract section uses this type as its worked example of an archived removal WITH a successor',
    },
  },
  'content-columns-slide': {
    removed:
      '2026-08-02, PR #543 (finishing the deprecated-layer removal, A7.8)',
    successor: null,
    reason:
      'a rich nested multi-column layout (heading + image + several sub-blocks ' +
      'per column), archived (deprecated: true) on 2026-07-22 as a near-copy of ' +
      'a one-off custom slide that barely earned its keep. No core successor ' +
      'holds the nested shape; the convert seams into it (image-text→columns, ' +
      'list→columns) went with it. The layout may return later as a custom ' +
      'slide or an explicit rich-nested type.',
    // No conversion migration: no core type carries the nested structure, so
    // the render contract (unresolved.js) degrades stored decks to an archived
    // slide with every field visible rather than converting them.
    migrations: [],
    allowedReferences: {
      'tests/slide-types-policy.test.js':
        'asserts the type is off the registry and a stored slide degrades safely',
      'docs/reference/slide-type-removal.md':
        'records this removal alongside card-stack as the deprecated-layer cleanup',
    },
  },
  'freeform-slide': {
    removed: '2026-07-26, PR #377',
    successor: null,
    reason:
      'a free-positioning canvas: too easy to make inaccessible slides, no ' +
      'semantic projection (it degraded to nothing in the reader/reflow view), ' +
      'and it never earned an authoring surface after #252 retired the canvas editor.',
    migrations: [], // scan-slide-type.js reported no decks using it
    allowedReferences: {
      'tests/slide-types-policy.test.js':
        'asserts the type is off the registry and a stored slide degrades safely',
      'docs/reference/slide-type-removal.md':
        'the removal checklist uses this removal as its worked example',
      'tests/unresolved-slide-render.test.js':
        'the render contract needs a removal WITHOUT a successor to pin the no-replacement wording',
      'docs/reference/versioning.md':
        'cites this removal as the worked example of a slide-type retirement that is NOT a breaking change',
    },
  },
  'lead-capture-slide': {
    removed: '2026-08-22, D50 — the lead-capture strip (B119)',
    successor: null,
    reason:
      'a name/email form on a slide, parked as `deprecated: true` on ' +
      '2026-07-24 because the marketing consent it gated on was never wired ' +
      'in. Stripped rather than revived (beta stance rule 5): the feature ' +
      'never ran in production, was barely tested, and dragged a whole ' +
      'privacy apparatus behind it (lead storage, GDPR self-service tokens, ' +
      'a retention job, a notification e-mail, a `lead.submitted` webhook). ' +
      'Collecting visitor details is meant to return as a designed feature — ' +
      'the plan replaces the code, it does not preserve it.',
    // No conversion migration: no core type carries a submitting form, so the
    // render contract (unresolved.js) degrades stored decks to an archived
    // slide with every field still visible. The deck scan on 2026-08-22 found
    // no deck on the type; a stored slide loses its form, which is the
    // breaking half of this removal and is called out in the release notes.
    migrations: [],
    allowedReferences: {
      'tests/slide-types-policy.test.js':
        'asserts the type is off the registry and a stored slide degrades safely',
    },
  },
  'lijstje-slide': {
    removed: '2026-07-30, rung 3 of the list consolidation (DB migration 056)',
    successor: 'list-slide',
    reason:
      'a back-compat alias, not a second type: since the drift fix it was ' +
      'literally `{ ...listSlide, ai: false }`, so the two names shared one ' +
      'definition and stood beside each other in the picker. Rung 3 drops the ' +
      'Dutch alias; every stored deck is renamed to `list-slide` (a lossless ' +
      'rename — same field schema, only the `type` string changes).',
    losslessRename: true,
    // Production scan, slides.ciiic.nl, 2026-07-31 (Postgres): 45 of 118
    // presentations / 565 slides still carried the old name, plus 28 version
    // snapshots / 127 slides; slide_library and comments were clean. Without
    // the rename those 565 slides would have rendered as *archived*. A second
    // dry-run after the real run reported 0 everywhere (idempotent).
    //
    // Since the funnel step (B223) the migration is the *backfill*, not the
    // correctness: `migratePresentation()` renames the type on every read, on
    // every backend, so a deck is never served under the old name again. What
    // the SQL still buys is persistence without a save — it writes the columns
    // once — and the surfaces the read funnel does not pass through
    // (version snapshots, slide_library, comment snapshots).
    migrations: [
      'server/db/migrations/056_rename_lijstje_slide_to_list_slide.js',
    ],
    allowedReferences: {
      'server/db/migrations/056_rename_lijstje_slide_to_list_slide.js':
        'the migration itself — it renames stored decks and must name both types',
      'scripts/migrate-lijstje-slide.js':
        'the standalone rename for file-store installs and exports (which have no migration runner); it names both types by design',
      'tests/lijstje-slide-migration.test.js':
        'exercises that rename script, so it must name the old type it renames',
      'tests/lossless-type-rename-funnel.test.js':
        'the end-to-end test of the schema funnel doing the rename: a stored deck has to carry a real retired name for the read path to prove anything',
      'docs/reference/slide-type-removal.md':
        'the "deprecating a type versus deprecating an alias" section uses this exact rename as its worked example',
    },
  },
  'split-partner-title-slide': {
    removed: '2026-07-30, PR #480',
    successor: null,
    reason:
      'a rarely-used "two partner logos side by side" title layout, archived ' +
      '(deprecated: true) on 2026-07-21 and removed as the A7.1 KPI measurement ' +
      'closing the slide-type-seam done-gate. The use case may return later as ' +
      'reusable editorial components rather than a bespoke type.',
    // No conversion migration: the render contract (unresolved.js) degrades
    // stored decks to an archived slide with content visible. The Postgres scan
    // on 2026-07-30 found 4 dev decks / 7 slides still carrying it. The
    // production scan the removal PR owed (slides.ciiic.nl, 2026-07-31) found
    // 2 presentations / 1 slide each, both throwaway test decks, and nothing in
    // presentation_versions or slide_library — so no real deck degrades.
    migrations: [],
    allowedReferences: {
      'server/db/migrations/020_rename_subtitle_to_subheading.js':
        'a past migration that renamed subtitle→subheading across several title types; it must keep naming this one to stay a faithful record of what it did',
      'tests/slide-types-policy.test.js':
        'asserts the type is off the registry and a stored slide degrades safely',
      'docs/reference/slide-type-removal.md':
        'records this removal as the second cost measurement (the KPI that closed the A7.1 done-gate), so it must name the type it measured',
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
