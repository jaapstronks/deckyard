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
   of AI generation and MCP (`isAgentOptOut`, since #386), still registered and
   still rendering stored decks. Reversible, non-destructive. Rung 1 also means
   dropping the type's **companions** (picker description, search aliases,
   schematic, `group`, catalog entry, examples):
   `tests/slide-type-companion-coverage.test.js` fails on an entry that outlives
   the type it describes — see
   [`slide-type-companions.md`](./slide-type-companions.md). **Unless the type
   is an alias** — read the next section before touching a single companion.
2. **Migration** — `scripts/scan-slide-type.js <type>` reports every deck and
   slide still on the type, so each hit is consciously converted, exported as an
   image, or accepted as a loss. Exit code 1 while any deck still uses it, so a
   CI/maintenance step can gate on a clean scan.
3. **Removed** — the definition, its CSS and every reference are gone. Decks
   that still carry the type render as an *archived slide*: named, explained and
   with their content still visible (see "The render contract" below). Only take
   this rung after rung 2 comes back clean.

`deprecated` is a fine waypoint and a bad end state: a deprecated type is still
mounted, still a support promise, and still an exception every later refactor
has to route around.

## Deprecating a *type* versus deprecating an *alias*

The ladder above describes retiring a type: a definition nobody should author
any more, and the companions that describe it go with it. An **alias** is a
different operation wearing the same word, and treating it like a deprecation
breaks the type you are keeping.

An alias is two registry names resolving to **one definition** — the state
`lijstje-slide` and `list-slide` were in until #451. There is one field schema,
one renderer, one stylesheet; the second name exists only so stored decks keep
resolving. Retiring the alias is a **rename**, and the rule follows from that:

> **On a real deprecation, companions are dropped. On an alias, every companion
> moves to the surviving name.**

Nothing is deleted, because nothing became unauthorable: the shape is still
offered, still edited, still convertible — under one name instead of two. A
companion left behind on the retired name is not just rot, it is a **hole in the
survivor**.

That failure is not hypothetical. The first version of #451 moved the
*authoring* companions (picker description, aliases, schematic, category) to
`list-slide` and left the *editing* companions (`INLINE_DESCRIPTORS`,
`INSPECTOR_KEEPS`) plus the conversion map, the form router and the field
special-cases pointing at `lijstje-slide`. Newly authored lists lost affordances
that legacy lists kept — the asymmetry exactly inverted — and the **Convert**
submenu vanished entirely, because `getConvertibleSlideTypes('list-slide')`
returned `[]`.

Two things to carry into the next one:

- **Sweep on the name, not on the matrix.** The companion matrix covers the
  authoring side plus two editing tables; the conversion map in
  `shared/slide-types/convert.js`, the form router and the field special-cases
  in `render-field.js` are outside it. `grep -rn "'<old-name>'"` is the actual
  worklist, and every hit is a *move*.
- **Pin the parity while both names exist.** For the list consolidation a
  dedicated test asserted that no module branched on one name without the other
  — the cheap guardrail an alias needs between rung 1 and rung 3. It was written
  to delete itself when rung 3 lands, and did. (A general version — assertion 5
  in `docs/plans/briefs/slide-type-structure-facet.md` — derives the set of
  name-branching modules instead of enumerating them.)

Rung 3 landed for this alias in #485, and it changed what rung 2 means. The
surviving name is still the `successor` in `shared/slide-types/removed.js`, but
**a clean deck scan is not what clears the way** — a scan reads the store it is
pointed at, and on a fresh file-store install that store is empty, so it reports
"clean" about decks it has never seen (the trap #464 walked into). What actually
clears the way is a **numbered migration**: `056_rename_lijstje_slide_to_list_slide.js`
renames the type across every stored surface on every install, as part of the
normal upgrade, whether or not anyone ran a script. See the migration step in the
checklist below.

## The removal checklist

Run the scan first — `node scripts/scan-slide-type.js <type>` — and stop if it
reports hits. On a Postgres-backed install, point `--dir` at an export of the
decks, and scan every deployment, not just the dev machine.

**A "clean" scan is only as wide as the store you pointed it at.** It says
nothing about the installs you do not have on disk — every fork, every
self-host — so treat it as a check on *your* deployment, not as permission.
Where the type has a successor with the same field schema, the honest answer is
step 0 below; where it has none, the tombstone plus the archived-slide render is
what stored decks fall back on.

The `lijstje-slide` rename is the hard number behind that rule. Upstream's own
stores were clean and the alias was assumed to be barely used; the fork ran the
rename against its production Postgres on 2026-07-31 and found **45 of 118
decks / 565 slides** still carrying the old name, plus 28 version snapshots /
127 slides. Shipping rung 3 without the migration would have turned those 565
slides into *archived* placeholders in a live deployment. The scan that said
"clean" was not wrong — it was answering about a store that had never seen those
decks.

Then, in rough dependency order:

0. **If the type has a successor, ship a numbered DB migration** in
   `server/db/migrations/` that rewrites the stored name. This is what makes the
   removal safe on installs you will never see: the migration runner applies it
   on every upgrade, while a `scripts/` one-off only ever runs where someone
   remembers to run it. Keep it **self-contained SQL** — `056_rename_lijstje_slide_to_list_slide.js`
   walks the jsonb columns with a recursive `pg_temp` function rather than
   importing the equivalent script, because a migration is a historical record
   and the script it mirrors is free to move. Keep the script too: file-store
   installs have no migration runner, and exports still need converting.

1. **Delete the definition** — `shared/slide-types/types/<type>.js`.
2. **Delete the stylesheet** — `client/styles/slides/**/<n>-<type>.css`, and
   remove its `@import` from the section aggregator
   (`client/styles/slides/0*-<section>.css`). **Not every type owns a file**:
   older types carry their rules as a block inside a shared section sheet
   (split-partner's 118 lines sat at the top of
   `02-content-and-media/02-layouts.css`), so read the class off the
   definition's `renderHtml` and grep *that* before deleting anything. The
   removal guardrail matches the type **id** and a CSS class is not derived from
   it — nothing will tell you `.slide-partner-split` outlived
   `split-partner-title-slide`.
3. **Deregister** — the import and the `CORE_SLIDE_TYPES` entry in
   `shared/slide-types/registry.js`.
4. **Remove the per-type entries in the hand-maintained tables that live outside
   the type.** Most of these are now enumerated by the companion matrix, so
   `node --test tests/slide-type-companion-coverage.test.js` reports the ones you
   missed by name — see
   [`slide-type-companions.md`](./slide-type-companions.md) for the full list
   (`SLIDE_TYPE_DESC`, `SLIDE_TYPE_ALIASES`, the AI catalog entry and its
   examples). The ones a type in the directory form owns — its descriptor, its
   `inspectorKeeps`, its `schematic`, its `sample`, its `group` — go with the
   directory in step 3 and need no separate visit.
   Not in the matrix, still by hand — each one branches on the type *name* and
   nothing checks that the set is complete (#451 hit all three):
   - the conversion map in `shared/slide-types/convert.js`, if the type was a
     conversion source or target.
   - the `case` in `client/views/editor/editor-form/slide-form-router.js`, if
     the type had a curated side form.
   - the per-type special cases in
     `client/views/editor/editor-form/render-field.js` (slide-list label
     refresh, items-editor layout).
   - (`EXCLUDED_TYPES` in `server/utils/openai/slide-types-prompt.js` no longer
     exists: #386 replaced it with `isAgentOptOut()`, so the definition's own
     `deprecated`/`ai: false` marker is what withholds a type from the generator.)
5. **Update the tests that enumerate types by name** — several suites carry
   hand-written per-type lists (placeholder coverage, policy, ydoc round-trip).
   Replace the type's archival test with a removal test that asserts it is off
   the registry and that a stored slide still degrades to the unknown-type
   render rather than throwing.
6. **Update the docs that carry per-type rows.** The per-type tables in
   `docs/reference/editor-inspector.md` and
   `docs/reference/wysiwyg-inline-editing.md` are still hand-maintained — one row
   per type — so delete the removed type's row from each.
   **Type counts are no longer a manual step.** Every count in committed Markdown
   lives inside a `<!--gen:slide-type-count-->` span that
   `scripts/generate-slide-type-docs.js` rewrites — `ROADMAP.md` included since it
   joined `COUNT_MARKER_FILES` (it was the line that kept being missed) — and
   `tests/slide-type-count-prose-guard.test.js` fails on any bare count that sits
   next to a "slide types" / "core types" phrase outside a span. Just run
   `node scripts/generate-slide-type-docs.js`; do not grep the number by hand.
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

- ~~**i18n**: deprecated types are excluded from extraction, so a type that
  spent time on rung 1 has no keys in `client/i18n/<locale>/slide-types.json`.~~
  **Wrong — corrected 2026-07-30.** `scripts/i18n-extract.js` walks
  `SLIDE_TYPES` and does not look at `deprecated`, so an archived type keeps its
  label and field keys in every locale. Split-partner still had six keys × 12
  locales when it was removed. **Every removal touches the 12 locale files**:
  delete the type's `slideType.<type>.*` keys, then `npm run i18n:validate`.
  `i18n:validate` still treats orphans as non-fatal, but
  `tests/slide-type-i18n-orphans.test.js` (added 2026-07-30) now **fails** the
  moment a `slideType.<id>.*` namespace names a type that has left the registry,
  reporting the locale and the id — so a forgotten prune is caught in the test
  suite instead of shipping forever. (`client/i18n/en.json` is a stale build
  artifact — ignore it.)
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
| **Registration / wiring** | 5 | registry import + map entry, the CSS aggregator `@import`, `INSPECTOR_KEEPS`, `EXCLUDED_TYPES`, the curated picker group (now the type's own `group`, so this row is one file smaller for the next removal) |
| **Duplicated knowledge** | 18 | 10 comments naming the type, 3 reference docs (per-type rows + a hand-written core-type count in 4 places), 5 tests enumerating types by hand |

Two of twenty-five files were actually *about* freeform. The other 23 changed
because the type's name is written into tables, prose and test fixtures that
nothing derives from the registry.

That ratio, not the raw 25, is the number worth tracking. After the slide-type
seam work the "owned" column should be one directory, the "registration" column
one line, and the "duplicated knowledge" column should be empty because those
consumers derive their lists from the registry instead of restating them.

## Second measurement: split-partner-title-slide (2026-07-30)

The KPI measurement that closes the slide-type-seam done-gate (A7.1 phase 2),
run *after* the fact-rollout landed (#403–#477). Same counting method as
freeform — every file the removal touches, grouped by why — so the two numbers
are comparable.

**Store measured: PostgreSQL** (this install is `STORAGE_MODE=postgres`).
`scripts/scan-slide-type.js` is file-based and the file store here is empty, so
it reports a meaningless clean scan — the #464 trap. Scanning the DB directly
(the `presentations.slides` jsonb plus `i18n.versions.*.slides`) found **4 decks
/ 7 slides** still carrying the type, all dev/test decks ("Split check", "SP
deckyard", "SP before", "SP sandbox-sage"). So the "probably zero decks"
assumption was wrong for this store; the render contract (`unresolved.js`)
degrades them to archived slides.

The **production** scan this removal owed ran on slides.ciiic.nl on 2026-07-31:
**2 presentations / 1 slide each**, both throwaway test decks ("test",
"welkokm"), and nothing in `presentation_versions` or `slide_library`. So no
real deck degrades and the removal ships without a conversion migration —
unlike `lijstje-slide`, where the same production store held 565 slides.

**28 files, 472 deletions.** Grouped by *why*:

| Group | Files | What was in them |
|---|---|---|
| **Owned by the type** | 4 | the definition (`types/split-partner-title-slide.js`, 147 lines), its directory companions (`authoring.js`, `inline-edit.js`), and its 118 lines of CSS — a block at the top of the shared `02-content-and-media/02-layouts.css`, not a file of its own |
| **Registration / wiring** | 3 | `registry.js` (the one hand edit) + the two **generated** aggregators `authoring.js` / `inline-edit.js` (regenerated, not hand-edited) |
| **Removal mechanism** | 2 | the `removed.js` tombstone and the archival→removal guardrail in `slide-types-policy.test.js` — every removal touches these by design |
| **Derived docs** | 2 | `README.md`, `slide-type-inventory.md` — machine-generated count/inventory, now *derived* rather than hand-restated |
| **Residual duplicated knowledge** | 5 | two hand table rows (`editor-inspector.md`, `wysiwyg-inline-editing.md`), a per-type coverage pin (`inspector-form.test.js`), per-type render tests (`theme-background-presets.test.js`), a sample-content allowlist entry (`i18n-audit-allowlist.json`) |
| **Locale payloads** | 12 | `slideType.split-partner-title-slide.*` — six keys in every `client/i18n/<locale>/slide-types.json`, which the type should never have had (see below) |

**Verdict: the done-gate is not met.** The gate is ≤3 files ideal, and anything
above 10 fails "regardless of how clean the architecture looks." 28 > 10 — and
even the like-for-like number against freeform (16 files, dropping the locale
payloads freeform never had) fails it.

What the seam *did* buy is real, and it is not the headline: files carrying
**hand-maintained duplicated knowledge** fell from freeform's 18 to 5, and the
type count and inventory became derivation instead of prose. What it did not
touch is the long tail — the CSS block, the two doc tables, the two per-type test
lists, the allowlist entry and twelve locale payloads all still had to be found
and edited by hand. That tail is the worklist to actually close the gate:

1. `docs/reference/editor-inspector.md` + `docs/reference/wysiwyg-inline-editing.md`
   — per-type tables that should be generated like `slide-type-inventory.md`.
2. `tests/inspector-form.test.js` — a per-type pin in a hand list that could
   iterate the registry.
3. `tests/theme-background-presets.test.js` — per-type render assertions that
   should live in (or derive from) the type's own directory.
4. `scripts/i18n-audit-allowlist.json` — sample-content entries that follow from
   each type's `authoring.js` and could be derived.
5. **Locale payloads** — nothing *prunes* `slideType.<type>.*` when a type leaves
   the registry, so the delete is still by hand — but it can no longer be
   forgotten silently: `tests/slide-type-i18n-orphans.test.js` (2026-07-30) fails
   on an orphaned namespace, naming the locale and id. A prune step in `i18n:sync`
   would make the deletion itself derivation too.
6. **Per-type CSS** — while a type's rules live in a shared section sheet, the
   only thing tying them to the type is the class name in `renderHtml`. Moving
   CSS into the type's directory would put it under the same guardrail as the
   rest.

### Two things the guardrail could not see

`tests/removed-slide-types.test.js` was green with both the CSS block and a
present-tense `editor-inspector.md` row still in the tree, because it matches the
type **id**, word-bounded:

- **the CSS class is not derived from the id.** `.slide-partner-split` never
  contains `split-partner-title-slide`, so 118 lines of dead CSS shipped to every
  client and no test objected. Step 2 of the checklist above now says to grep the
  class off `renderHtml` by hand.
- **prose drops the `-slide` suffix.** `editor-inspector.md` said
  "split-partner-title _(archived)_ … existing decks still render and their
  inspector keeps these" — false after removal, and invisible to a word-bounded
  match on the full id. Adding it to `allowedReferences` would not have helped
  either: that test checks the file mentions the *full* id, so the entry would
  have failed as stale.

Neither is fixable by tightening the regex (a looser match would flag every
historical mention in `CHANGELOG.md` and every migration comment). They are
arguments for the same thing as the worklist above: fewer places that restate a
type's name at all.

One side-note the measurement surfaced and did not act on: the definition still
sits *beside* its directory (`types/split-partner-title-slide.js` +
`types/split-partner-title-slide/`) rather than inside it — the state the
per-companion rollout left every type in, not specific to this one.

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
recognises — the distinction that makes the render contract below possible.

Two entries so far: `agenda-timeline-slide` (consolidated into `timeline-slide`,
with migration 030 converting stored decks — the model case) and `freeform-slide`
(no successor, no decks).

## The render contract

A deck outlives the code that rendered it. Removal is a code-side operation —
nothing rewrites stored deck JSON — so a slide with a retired type keeps its
`type` string forever, and something has to render it. What that something
promises is `shared/slide-types/unresolved.js`:

1. **Name the type.** The author sees exactly which type is missing.
2. **Say why, when the answer is known.** A type on the tombstone record renders
   as *archived* ("The `card-stack-slide` slide type was removed (…)"), with the
   successor when there is one ("Rebuild this slide as an *Icon card grid*
   slide"). A name that resolves to nothing renders as *unavailable* — a fork's
   custom type, a typo, a deck from a newer Deckyard. The record draws that line;
   the render never guesses.
3. **Keep the content visible.** Every stored field is shown as readable text,
   keyed by its stored key. Nothing is silently dropped, so the author can move
   the content into the successor by hand.
4. **Stay a slide, not an error.** It renders, exports, prints and reads as a
   quiet archival card. A deck with one of these is a deck with an old slide in
   it, not a broken deck.

Per surface:

| Surface | Behaviour |
|---|---|
| Canvas (editor, presenter, embed, HTML/PNG/PDF export) | `renderSlideHtml()` → `.slide-unresolved` placeholder. **Bounded** — a 1600x900 frame cannot grow, so it shows the first fields and says how many it withheld. |
| Reader / reflow (`server/export/reader.js`) | The archived note plus **every** field, no elision. This is the recovery surface: whatever the canvas truncates is readable here. |
| Deck import (`deckToPresentationParts`) | Becomes a real `content-slide` (an unregistered type would be neither editable nor saveable) carrying the same explanation and the original content as markdown. Import *persists* rather than renders, so what it drops is gone for good. |
| Client sync render | A tombstoned type skips the custom-type server round-trip: it is gone server-side too, so the client renders the placeholder directly instead of stalling on the "loading" box. |

The contract is pinned by `tests/unresolved-slide-render.test.js`, which asserts
the promise rather than one surface's markup.

**Why this matters for the next removal.** `freeform-slide` could go without it
(zero decks). `content-columns-slide` and `card-stack-slide` cannot: those were
in real use, so "the content is still in the JSON somewhere" is not an answer an
author can act on. The contract is the prerequisite for rung 3 on any type decks
actually used.

## Known gaps this removal exposed

- ~~**The unknown-type render is the entire migration story.**~~ Fixed by the
  render contract above (`shared/slide-types/unresolved.js`).
- ~~**Nothing fails when a reference is orphaned.**~~ Fixed by
  `tests/removed-slide-types.test.js` (step 7 above).
- **Per-type tables are deregistration points.** `INSPECTOR_KEEPS` and
  `EXCLUDED_TYPES` both had to have an entry *removed*; neither was derived from
  anything the type declares. `INSPECTOR_KEEPS` has since become exactly that —
  a type declares `inspectorKeeps` in its own `inline-edit.js` and the map is
  derived — so the next removal only has `EXCLUDED_TYPES` left in this row.

## See also

- `scripts/scan-slide-type.js` — the deck-population scan behind rung 2.
- `shared/slide-types/removed.js` — the removal record.
- `shared/slide-types/unresolved.js` — the render contract for a type that is gone.
- `tests/removed-slide-types.test.js` — the guardrail that enforces it.
- `docs/reference/editor-inspector.md` — the per-type inspector table.
- `docs/reference/wysiwyg-inline-editing.md` — the per-type inline-edit table.
