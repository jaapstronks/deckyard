# Slide-type companions — what a new type owes, and what it gets for free

Registering a slide type in `shared/slide-types/registry.js` gets you a working
type: the editor renders a form from `fields[]`, the JSON schema and validation
follow, i18n keys are scaffolded, the renderer is the type's own `renderHtml`.

What does *not* follow are the **companions**: hand-maintained per-type entries
that live in other files. Every one of them degrades gracefully when it is
missing — the picker falls back to a label, the agent catalog derives a minimal
description, the curation list drops the type into "Other". Nothing breaks. The
type just gets quietly worse, which is why this drift went unnoticed for so long
(audit finding F6 found four such lists disagreeing; #323 and #386 each cleaned
up one instance by hand).

`tests/slide-type-companion-coverage.test.js` is the gate. It runs both
directions per companion:

- **forward** — a type that owes a companion and has none fails the build, naming
  both the type and the companion.
- **reverse** — a companion entry for a type that is gone, deprecated, or opted
  out fails too. Retiring a type means retiring its companions.

Exemptions live in `tests/helpers/slide-type-companions.js`, need a written
reason, and are themselves checked for rot: an exemption that is no longer needed
fails the build.

## Who owes what

Two markers decide whether a type owes a companion, and both already existed:

| Marker | Meaning | Effect |
|---|---|---|
| `deprecated: true` | renderable, not authorable (`isInsertableSlideType`) | owes no author-facing companion; a leftover entry is rot |
| `ai: false` | deliberately not offered to agents (`isAgentOptOut`) | owes no agent-facing companion |

**Author-facing companions die with deprecation; editing-facing ones do not.**
A deprecated type is gone from every insertion path, but stored decks still
contain slides of that type and those slides still get opened in the editor. So
`deprecated` exempts a type from being *offered*, never from being *edited* — the
inline-edit descriptor and inspector keep-list stay, the picker entries go.

## The gated companions

| Companion | Source of truth | Owed by | Silent degradation |
|---|---|---|---|
| AI / MCP catalog **prose** (description, bestFor, notFor) | `shared/slide-types/types/<name>/ai.js` | not `ai: false`, not deprecated | derived entry flagged `documented: false`; category falls back to `content` |
| AI prompt examples | `shared/slide-types/types/<name>/ai.js` (`aiExamples`) | sparse by design (reverse only) | prompt shows the schema without filled-in content |
| v1 generator manual example | `server/utils/openai/slide-types-prompt.js` (`MANUAL_EXAMPLES`) | sparse by design (reverse only) | falls through to the catalog example, then to defaults |
| Picker description | `shared/slide-types/types/<name>/authoring.js` (`description`) | every insertable type | tile shows the bare label, no tooltip |
| Dutch picker description | `client/i18n/nl/editor.json` (`editor.slideTypeDesc.<name>`) | every insertable type (Tier-1 pair) | tile shows the English description to Dutch users — English tile among Dutch neighbours, suite still green |
| Picker search aliases | same file (`aliases`) | every insertable type | only findable by exact label |
| Picker schematic glyph | `client/views/editor/slide-type-schematics.js` | every insertable type | generic text-only diagram |
| Curated group | `shared/slide-types/types/<name>/authoring.js` (`group`) | every insertable type | lands in the picker's computed "Other" group *and* the settings tab's "Other" heading |
| Inline-edit descriptor | `client/views/editor/inline-edit/descriptors.js` (`INLINE_DESCRIPTORS`) | every registered type | no on-canvas editing; every field is side-form only |
| Inspector keep-list | `shared/slide-types/types/<name>/inline-edit.js` (`inspectorKeeps`) | sparse by design (reverse only) | inspector shows every field the inline layer misses (the safe default) |
| Refine content schema | `server/utils/ai/schemas/refined-slide.js` (`SLIDE_SCHEMAS`) | every agent-emittable type (not `ai: false`, not deprecated) | `validateSlideContent` hits its "unknown type" branch and skips validation — refine never notices malformed content |
| Structural validator | `server/utils/ai/validate-slide-structure.js` (`STRUCTURE_VALIDATORS`) | every agent-emittable `collection` / `fixed-collection` type | `validateSlideContentStructure` returns no issues — a collection with too few items or a missing item field is accepted unvalidated |

A fork-local type in `custom/slide-types/` can satisfy the agent, schematic and
inline companions from its own definition (`ai: {}`, `schematic: {}`,
`inline: {}`) but cannot add rows to core's picker maps, so the matrix covers
**core types only** — the same line `git ls-files` draws in
`tests/removed-slide-types.test.js`.

Four rows are marked *sparse by design*: the entry exists only where the default
is wrong (an example the schema cannot convey, a picker group for the long tail,
an inspector override). Forward coverage there is a quality goal, so only the
reverse direction is a gate — which is exactly the drift #323 hit: examples for a
type whose catalog entry was already gone.

### `usage` — inside the catalog entry, deliberately never gated

The catalog entry carries an optional `usage` string: the rules *this
organization* set for filling the type (sources, cut-off dates, mandatory
explanations), as opposed to the editorial copy that says which type to pick.
It ships in `get_slide_types`, so an agent reads it before it builds the slide.
Written in one of three places, all resolving to the same field:
the catalog entry (core), `ai.usage` on a `custom/slide-types/*.js` definition,
`custom/ai/catalog.js` for a core-type override, or the `usage` column edited in
the Tier-2 builder UI.

It gets **no row of its own**, and that is the design, not an oversight:

- **Forward coverage would be actively harmful.** Requiring `usage` on every
  visible type produces invented filler on ~31 core types that have no
  organization whose rules to codify. Absence here means "no rule", which is the
  normal case and a true statement.
- **Reverse coverage is already free.** Because `usage` lives *inside* the
  catalog entry rather than beside it, the `AI / MCP catalog entry` row's stale
  check retires it along with the entry. A second row would have restated the
  same iteration with a different exemption shape — the duplication this matrix
  exists to remove.

What no cheap test can catch: a `usage` rule that still applies to a live type
but names a field that has since been renamed. That is content rot, not
structural rot, and pretending otherwise would be worse than saying so here.
Rules and limits: `shared/slide-types/usage.js`.

## Derived — nothing to maintain

| Layer | Derived from |
|---|---|
| Editor form, JSON schema, validation | `fields[]` on the definition |
| Agent-facing content schema (MCP + generation prompt) | `fields[]`, via `deriveAgentSchema()` — hand-written until T7-slice 3; see below |
| i18n key scaffolding | `addUiI18nKeysToSlideType()` at registry build |
| Agent-visible type list (MCP `get_slide_types`) | the runtime registry, since #386 — was hand-maintained, and was the biggest hole in this matrix |
| Canonical type id (`eu.deckyard.slide.title`) | `SLIDE_TYPE_IDS` |
| Wire spelling of `slides[].type` (export/read) | `canonicalSlideType()` |

### The agent-facing schema, and how a field opts out

Until T7-slice 3 the AI catalog carried a hand-written `schema:` block per type —
a second copy of what `fields[]` already said. It drifted: of 135 field entries,
five named something no renderer reads (`payoff-slide.tagline`,
`video-slide.videoUrl`, and the deprecated `stages`/`steps` aliases on
funnel/cycle/process). The shape now has exactly one owner, the definition, and
the catalog carries prose only.

Which fields reach an agent is therefore a property of the field:

| On the field | Meaning | Reaches agents |
|---|---|---|
| *(nothing)* | an ordinary authorable field | yes — this is the default |
| `hidden: true` | legacy mirror of a structured field; also skipped by the semantic projection | no |
| `deprecated: true` | legacy field kept for stored decks | no |
| `ai: false` | live and editable, but deliberately withheld (infrastructure, legacy counters) | no |
| `helpText: '…'` | the editor's own prose about the field | yes — becomes the schema entry's `description` |

The default is *offered*, matching the type-level rule from #386: withholding is
a decision somebody writes down, not something that happens by omission. The
`ai` key means the same thing on a field as it does on a type
(`isAgentOptOut`), one level down.

## Also owed, but not a companion: `structure` and `runtime`

Since #453 every **core** type must declare `structure` on its definition —
`singleton`, `collection`, `fixed-collection`, `tabular`, `dataset` or `chrome`
— and since the `runtime` facet landed it must also declare `runtime`:
`static`, `timed` or `live`. A `live` type owes one key more, `interaction`
(`poll` / `likert` / `feedback`), which is the contract `live` implies.

Neither is in the matrix above, and neither should be: a companion is a
hand-written entry in *another* file that degrades quietly when missing, whereas
these live on the definition itself and their absence is a hard CI failure.
Different shape, different gate — `tests/slide-type-structure.test.js` and
`tests/slide-type-runtime.test.js` rather than
`slide-type-companion-coverage.test.js`.

The reason it is mentioned here anyway is that this page is where a contributor
looks for "what does a new type owe", and the answer now includes one key that is
not a companion. Fork-local types in `custom/slide-types/` are **not** required to
declare it (the gate iterates `CORE_SLIDE_TYPE_NAMES`), the same core-only line
the matrix draws.

What the facets are for, and the assertions that keep the declarations honest,
are in [`slide-type-structure.md`](slide-type-structure.md) and
[`slide-type-runtime.md`](slide-type-runtime.md).

## Deliberately not in the matrix

- **Translations** (`client/i18n/<locale>/slide-types.json`) — a generated
  artifact (`scripts/i18n-extract.js`), not a hand-written per-type entry, and a
  missing key renders the English fallback baked into the definition.
  `tests/i18n-coverage.test.js` guards the static `t()` surface.
- **Slide CSS** (`client/styles/slides/**`) — hand-maintained, but not one file
  per type: types share stylesheets, and a missing rule shows up the moment you
  look at the slide rather than silently.
- **PPTX export tier** — the pattern this matrix generalizes ("no tier → the
  build fails"), but the tier itself does not exist yet. It belongs here when
  STRATEGY T4 lands.
- **Behavioural subsets** — hardcoded `*-slide` arrays that answer a *behaviour*
  question rather than a coverage one: `NON_CONTENT_SLIDE_TYPES` and
  `SLIDE_ITEM_REQUIREMENTS` (`server/utils/ai/validate-slides/constants.js`),
  and the per-type branches in `server/utils/openai/convert-slide.js`,
  `server/utils/ai/validate-slides/fix.js`,
  `server/utils/convert-file/helpers.js`. A type absent from one of these is not
  degraded — it takes the default branch, which is usually the right answer.
  Asserting total coverage over them would mean asserting a judgement the list
  does not record. Consolidating them is a separate question (STRATEGY A7.1).

These four exclusions are judgements, and until recently nothing checked that
the list of judgements was complete. That is what the inventory below is for.

## The name-branching inventory — no hole in the matrix

The matrix guards the companions. Nothing guarded the matrix: it is itself a
hand-written list, so a module carrying per-type knowledge that nobody had ever
added simply was not checked. That has a cost on the record. When the List
type's Dutch alias was folded into `list-slide` (PR #451) the *offer* companions
moved because the matrix named them, and `shared/slide-types/convert.js`,
`slide-form-router.js` and two special cases in `render-field.js` stayed behind
because it did not — so newly authored lists lost affordances that legacy lists
kept, with the whole **Convert** submenu missing.

`tests/slide-type-name-branching.test.js` closes that by *deriving* the set
instead of declaring it: every tracked module that branches on **three or more**
core type names must be accounted for in `INVENTORY`
(`tests/helpers/slide-type-name-branching.js`), with a kind and a reason. The
gate is on the accounting, not the contents — a module may be a closed-set
special case; it may not be a surprise.

The threshold is the whole judgement, so it is written down rather than implied:
94 modules *name* a type, 46 branched on three or more when the inventory was
first taken. One or two names reads as type-specific behaviour (the custom-HTML
guard exists for `custom-html-slide`) and no future type can be "missing" from
it; three or more is where a module stops being about a type and becomes a table
*of* types.

| Kind | Count | What it means |
|---|---|---|
| `table` | 16 | a row per eligible type; must name a companion, which gates it both ways |
| `sparse` | 13 | intentionally partial (repair rules, conversion pairs, the CSS map); only staleness is a defect |
| `specific` | 5 | a closed set of types that behave differently; not a table |
| `generated` | 1 | produced by a script from per-type sources, so it cannot drift |
| `source` | 1 | the registry — the list every other list derives from |

`specific` was 15 at the first reading. Ten of those entries left when the
`runtime` facet landed and the modules started asking the type instead of
recognising its name — which is the shape of progress this gate exists to
produce: the count drops because knowledge moved onto the types, not because the
threshold moved.

`server/utils/ai/schemas/refined-slide.js` and
`server/utils/ai/validate-slide-structure.js` used to carry `promote: true`:
both companion-shaped — a type with no entry is silently unvalidated by the
refine phase — and neither was gated. They have now been promoted to the matrix
(the two AI-refine companions above), so no inventory entry carries `promote`.
Their eligibility rules differ, which is the point of writing them down:

- **Refine content schema** is owed by *every* agent-emittable type
  (`!isAgentOptOut`), because the refine phase can emit any of them and a
  missing schema silently skips validation. Even a chrome type owes a trivial
  schema — it keeps the "unknown slide type" warning meaningful.
- **Structural validator** is owed only by the `collection` /
  `fixed-collection` types: its unique job over the flat field/Zod schema is
  checking a repeated-item array's cardinality and per-item required fields, and
  `singleton` / `dataset` / `tabular` / `chrome` types have no such invariant.

The next ungated per-type table should get `promote: true` again as the
signpost to the following promotion.

### What the inventory measured

**Nine `specific`-kind modules re-derived the live-interaction quartet**
(`poll` / `likert` / `likert-slider` / `feedback`) by hand, to answer one
question: does this slide collect answers from the audience? None of them wanted
to know which type it was; they all wanted a capability the type did not declare.
They had already drifted at the edges — the presenter's live set included
`follow-invite`, the session storage covered three of the four — and every one
was a place a fifth interaction type would be forgotten.

That is the `runtime` facet, which
[`slide-type-structure.md`](./slide-type-structure.md) had deferred with "real,
but no consumer yet". There were nine. The test asserted a *floor* on that count
so it would fail the moment the number dropped, which was the signal to delete
it and point at the facet instead — and that is what happened: see
[`slide-type-runtime.md`](./slide-type-runtime.md). The measurement survives as
a ceiling in `tests/slide-type-runtime.test.js`: no module may write the live
set out again.

**Conversion knowledge lives in three places**: `shared/slide-types/convert.js`,
`client/views/editor/editor-form/header-actions.js` and
`server/utils/openai/convert-slide.js` each write out which type turns into
which. That is the strongest argument in the inventory for deriving conversion
from the `structure` facet rather than maintaining three maps.

## Adding a companion to the matrix

Add an entry to `COMPANIONS` in `tests/helpers/slide-type-companions.js`: `id`,
`label`, `where`, `degradesTo` (the failure message quotes it), `appliesTo`,
`has`, `keys`, and `exempt`. Set `optional: true` if the list is sparse by
design. The test picks it up automatically, in both directions.

## Related

- `tests/agent-slide-type-contract.test.js` — unit-tests the agent-catalog
  *derivation* (opt-out rule, Tier-2 resolution, schema derivation). This
  document is about author discipline; that file is about behaviour.
- `tests/removed-slide-types.test.js` + `shared/slide-types/removed.js` — the
  same both-directions-with-reasons shape, for types that are gone entirely.
- `docs/reference/wysiwyg-inline-editing.md` — how the inline-edit descriptors
  above are consumed, and what a descriptor can declare.
- `docs/reference/editing-surfaces.md` — the audit rule behind `INSPECTOR_KEEPS`
  (what may be canvas-only and what may never be).
