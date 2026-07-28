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
| AI / MCP catalog **prose** (description, bestFor, notFor) | `server/utils/ai/slide-catalog/` (`SLIDE_TYPE_CATALOG`) | not `ai: false`, not deprecated | derived entry flagged `documented: false`; category falls back to `content` |
| AI prompt examples | `server/utils/ai/slide-catalog/examples/` | sparse by design (reverse only) | prompt shows the schema without filled-in content |
| v1 generator manual example | `server/utils/openai/slide-types-prompt.js` (`MANUAL_EXAMPLES`) | sparse by design (reverse only) | falls through to the catalog example, then to defaults |
| Picker description | `client/views/editor/slide-type-picker/data.js` (`SLIDE_TYPE_DESC`) | every insertable type | tile shows the bare label, no tooltip |
| Picker search aliases | same file (`SLIDE_TYPE_ALIASES`) | every insertable type | only findable by exact label |
| Picker schematic glyph | `client/views/editor/slide-type-schematics.js` | every insertable type | generic text-only diagram |
| Curated picker group | `client/views/editor/slide-type-picker/data.js` (`PICKER_GROUPS`) | sparse by design (reverse only) | lands in the picker's computed "Other" group |
| Inline-edit descriptor | `client/views/editor/inline-edit/descriptors.js` (`INLINE_DESCRIPTORS`) | every registered type | no on-canvas editing; every field is side-form only |
| Inspector keep-list | `client/views/editor/editor-form/inspector-form.js` (`INSPECTOR_KEEPS`) | sparse by design (reverse only) | inspector shows every field the inline layer misses (the safe default) |
| Settings curation category | `client/views/settings/tabs/slide-types-tab/categories.js` | every insertable type | lands in the "Other" group |

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
| Canonical type id (`core/title-slide`) | `SLIDE_TYPE_IDS` |
| Deck type manifest | `collectSlideTypeManifest()` |

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

## Also owed, but not a companion: `structure`

Since #453 every **core** type must declare `structure` on its definition —
`singleton`, `collection`, `fixed-collection`, `tabular`, `dataset` or `chrome`.
It is not in the matrix above and should not be: a companion is a hand-written
entry in *another* file that degrades quietly when missing, whereas `structure`
lives on the definition itself and its absence is a hard CI failure. Different
shape, different gate — `tests/slide-type-structure.test.js` rather than
`slide-type-companion-coverage.test.js`.

The reason it is mentioned here anyway is that this page is where a contributor
looks for "what does a new type owe", and the answer now includes one key that is
not a companion. Fork-local types in `custom/slide-types/` are **not** required to
declare it (the gate iterates `CORE_SLIDE_TYPE_NAMES`), the same core-only line
the matrix draws.

What the facet is for, and the four assertions that keep the declaration honest,
are in [`slide-type-structure.md`](slide-type-structure.md).

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
added simply was not checked. That has a cost on the record. When
`lijstje-slide` was folded into `list-slide` (PR #451) the *offer* companions
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
94 modules *name* a type, 46 branch on three or more. One or two names reads as
type-specific behaviour (the custom-HTML guard exists for `custom-html-slide`)
and no future type can be "missing" from it; three or more is where a module
stops being about a type and becomes a table *of* types.

| Kind | Count | What it means |
|---|---|---|
| `table` | 14 | a row per eligible type; must name a companion, which gates it both ways |
| `sparse` | 15 | intentionally partial (repair rules, conversion pairs, the CSS map); only staleness is a defect |
| `specific` | 15 | a closed set of types that behave differently; not a table |
| `generated` | 1 | produced by a script from per-type sources, so it cannot drift |
| `source` | 1 | the registry — the list every other list derives from |

Two entries carry `promote: true`: `server/utils/ai/schemas/refined-slide.js`
and `server/utils/ai/validate-slide-structure.js`. Both are companion-shaped —
a type with no entry is silently unrefinable, or silently unvalidated — and
neither is gated. They are the shortlist for the next companion.

### What the inventory measured

**Nine `specific`-kind modules re-derive the live-interaction quartet**
(`poll` / `likert` / `likert-slider` / `feedback`) by hand, to answer one
question: does this slide collect answers from the audience? None of them wants
to know which type it is; they all want a capability the type does not declare.
They already disagree at the edges — the presenter's live set includes
`follow-invite`, the session storage covers three of the four — and every one is
a place a fifth interaction type would be forgotten.

That is the `runtime` facet, which
[`slide-type-structure.md`](./slide-type-structure.md) deferred with "real, but
no consumer yet". There are nine consumers. The test asserts a *floor* on that
count, so it fails when the number drops — which is the moment to delete it and
point at the facet instead.

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
