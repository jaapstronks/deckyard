# Removing a slide type

What it currently takes to delete a slide type from the codebase, and which of
those steps exist because the type owns something versus because knowledge about
the type is duplicated elsewhere.

Written from the `freeform-slide` removal (2026-07-26), the first type to go all
the way through the ladder. It doubles as the baseline measurement for the
slide-type seam work: a future removal should touch far fewer files.

## The deprecation ladder

A slide type is never deleted in one step. Three rungs:

1. **`deprecated: true`** — out of the picker (`isInsertableSlideType`) and out
   of AI generation (`EXCLUDED_TYPES`), still registered and still rendering
   stored decks. Reversible, non-destructive.
2. **Migration** — `scripts/scan-slide-type.js <type>` reports every deck and
   slide still on the type, so each hit is consciously converted, exported as an
   image, or accepted as a loss. Exit code 1 while any deck still uses it, so a
   CI/maintenance step can gate on a clean scan.
3. **Removed** — the definition, its CSS and every reference are gone. Decks
   that still carry the type fall back to the "Unknown slide type" render in
   `renderSlideHtml()`; the stored content survives in the deck JSON but is not
   shown. Only take this rung after rung 2 comes back clean.

`deprecated` is a fine waypoint and a bad end state: a deprecated type is still
mounted, still a support promise, and still an exception every later refactor
has to route around.

## The removal checklist

Run the scan first — `node scripts/scan-slide-type.js <type>` — and stop if it
reports hits. On a Postgres-backed install, point `--dir` at an export of the
decks, and scan every deployment, not just the dev machine.

Then, in rough dependency order:

1. **Delete the definition** — `shared/slide-types/types/<type>.js`.
2. **Delete the stylesheet** — `client/styles/slides/**/<n>-<type>.css`, and
   remove its `@import` from the section aggregator
   (`client/styles/slides/0*-<section>.css`).
3. **Deregister** — the import and the `CORE_SLIDE_TYPES` entry in
   `shared/slide-types/registry.js`.
4. **Remove the per-type entries in the hand-maintained tables that live outside
   the type.** These are the ones a `grep` for the type name finds but nothing
   keeps in sync:
   - `INSPECTOR_KEEPS` in `client/views/editor/editor-form/inspector-form.js`
   - `EXCLUDED_TYPES` in `server/utils/openai/slide-types-prompt.js`
   - the curated group lists in `client/views/editor/slide-type-picker/index.js`
   - `INLINE_DESCRIPTORS` in `client/views/editor/inline-edit/descriptors.js`,
     the AI catalog entry under `server/utils/ai/slide-catalog/`, the conversion
     map in `shared/slide-types/convert.js`, and the settings categories in
     `client/views/settings/tabs/slide-types-tab/categories.js` — each only if
     the type had one.
5. **Update the tests that enumerate types by name** — several suites carry
   hand-written per-type lists (placeholder coverage, policy, ydoc round-trip).
   Replace the type's archival test with a removal test that asserts it is off
   the registry and that a stored slide still degrades to the unknown-type
   render rather than throwing.
6. **Update the docs that carry per-type rows or a type count** —
   `docs/reference/editor-inspector.md`, `docs/reference/wysiwyg-inline-editing.md`,
   `docs/reference/ai-wizard-prompts.md`. The core-type count is written out by
   hand in several places.
7. **Record the removal and let the guardrail find the rest.** Add an entry to
   `REMOVED_SLIDE_TYPES` in `shared/slide-types/removed.js` (when it went, the
   successor or `null`, why, the migration if there was one), then run
   `node --test tests/removed-slide-types.test.js`. It reports every remaining
   reference as a worklist — comments, doc rows, hand-written test lists — so
   this step replaces the manual grep sweep. Fix each one, or add it to that
   type's `allowedReferences` **with a reason** if it must stay (a DB migration
   recording the conversion, or a successor type explaining a legacy field
   shape). The allowlist is checked in both directions, so an entry that
   outlives its reference fails too.
8. **Check for orphaned field keys.** A field key only that type declared leaves
   generic plumbing pointing at nothing (`bgCustomColor` after freeform). Either
   remove the plumbing or note in a comment that no core type declares it.
9. **Verify**: `npm test`, `npm run lint`, `npm run i18n:validate`.

### What you do *not* have to do

- **i18n**: deprecated types are excluded from extraction, so a type that spent
  time on rung 1 has no keys in `client/i18n/<locale>/slide-types.json` and no
  locale file needs touching. (`client/i18n/en.json` is a stale build artifact —
  ignore it.) A type removed straight from active use would touch 12 locale
  files.
- **Stored decks**: nothing rewrites deck JSON. Removal is a code-side operation;
  content already on disk keeps its `type` string.

## Baseline: what freeform's removal actually cost

**25 files, 715 deletions.** Freeform was the cheapest possible case — already
deprecated, its canvas editor already removed (#252), zero decks using it, no
i18n keys, no AI catalog entry, no inline-edit descriptor, no conversion target.
Grouped by *why* each file had to change:

| Group | Files | What was in them |
|---|---|---|
| **Owned by the type** | 2 | the definition (`types/freeform-slide.js`, 328 lines) and its stylesheet (`80-freeform.css`, 320 lines) |
| **Registration / wiring** | 5 | registry import + map entry, the CSS aggregator `@import`, `INSPECTOR_KEEPS`, `EXCLUDED_TYPES`, the curated picker group |
| **Duplicated knowledge** | 18 | 10 comments naming the type, 3 reference docs (per-type rows + a hand-written core-type count in 4 places), 5 tests enumerating types by hand |

Two of twenty-five files were actually *about* freeform. The other 23 changed
because the type's name is written into tables, prose and test fixtures that
nothing derives from the registry.

That ratio, not the raw 25, is the number worth tracking. After the slide-type
seam work the "owned" column should be one directory, the "registration" column
one line, and the "duplicated knowledge" column should be empty because those
consumers derive their lists from the registry instead of restating them.

## The removal record

`shared/slide-types/removed.js` is the tombstone list: every core type that used
to exist, why it went, what stored decks should move to, and which files are
still allowed to name it.

It exists because a removed type does not fully vanish. Decks stored before the
removal keep its `type` string, a DB migration may record the conversion, and a
successor type often has to explain where an odd legacy field shape came from.
Those references are legitimate; a stale comment or an orphaned doc row is not.
The record draws that line explicitly instead of leaving it to memory.

`getRemovedSlideType(name)` tells a deliberate removal apart from a name nobody
recognises — the distinction the generic unknown-type render cannot make today.

Two entries so far: `agenda-timeline-slide` (consolidated into `timeline-slide`,
with migration 030 converting stored decks — the model case) and `freeform-slide`
(no successor, no decks).

## Known gaps this removal exposed

- **The unknown-type render is the entire migration story.** A removed type
  falls back to a generic "Unknown slide type" box; the stored content is not
  shown and not exported. Acceptable when the scan is clean, wrong as a general
  contract. Now that `getRemovedSlideType()` can distinguish "deliberately
  removed, successor X" from "no idea what this is", a placeholder that names
  the missing type and surfaces its raw content is buildable — and it is a
  prerequisite for removing any type decks actually use.
- ~~**Nothing fails when a reference is orphaned.**~~ Fixed by
  `tests/removed-slide-types.test.js` (step 7 above).
- **Per-type tables are deregistration points.** `INSPECTOR_KEEPS` and
  `EXCLUDED_TYPES` both had to have an entry *removed*; neither is derived from
  anything the type declares. They are the clearest candidates for being owned
  by the type definition.

## See also

- `scripts/scan-slide-type.js` — the deck-population scan behind rung 2.
- `shared/slide-types/removed.js` — the removal record.
- `tests/removed-slide-types.test.js` — the guardrail that enforces it.
- `docs/reference/editor-inspector.md` — the per-type inspector table.
- `docs/reference/wysiwyg-inline-editing.md` — the per-type inline-edit table.
