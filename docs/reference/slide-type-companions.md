# Slide-type companions — what a new type owes, and what it gets for free

Registering a slide type in `shared/slide-types/registry.js` gets you a working
type: the editor renders a form from `fields[]`, the JSON schema and validation
follow, i18n keys are scaffolded, the renderer is the type's own `renderHtml`.

What does _not_ follow are the **companions**: hand-maintained per-type entries
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

| Marker             | Meaning                                              | Effect                                                   |
| ------------------ | ---------------------------------------------------- | -------------------------------------------------------- |
| `deprecated: true` | renderable, not authorable (`isInsertableSlideType`) | owes no author-facing companion; a leftover entry is rot |
| `ai: false`        | deliberately not offered to agents (`isAgentOptOut`) | owes no agent-facing companion                           |

**Author-facing companions die with deprecation; editing-facing ones do not.**
A deprecated type is gone from every insertion path, but stored decks still
contain slides of that type and those slides still get opened in the editor. So
`deprecated` exempts a type from being _offered_, never from being _edited_ — the
inline-edit descriptor and inspector keep-list stay, the picker entries go.

## The gated companions

| Companion                                                 | Source of truth                                                         | Owed by                                                                                                  | Silent degradation                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI / MCP catalog **prose** (description, bestFor, notFor) | `shared/slide-types/types/<name>/ai.js`                                 | not `ai: false`, not deprecated                                                                          | derived entry flagged `documented: false`; category falls back to `content`                                                                          |
| AI prompt examples                                        | `shared/slide-types/types/<name>/ai.js` (`aiExamples`)                  | sparse by design (reverse only)                                                                          | prompt shows the schema without filled-in content                                                                                                    |
| v1 generator manual example                               | `server/utils/openai/slide-types-prompt.js` (`MANUAL_EXAMPLES`)         | sparse by design (reverse only)                                                                          | falls through to the catalog example, then to defaults                                                                                               |
| Picker description                                        | `shared/slide-types/types/<name>/authoring.js` (`description`)          | every insertable type                                                                                    | tile shows the bare label, no tooltip                                                                                                                |
| Dutch picker description                                  | `client/i18n/nl/editor.json` (`editor.slideTypeDesc.<name>`)            | every insertable type (Tier-1 pair)                                                                      | tile shows the English description to Dutch users — English tile among Dutch neighbours, suite still green                                           |
| Picker search aliases                                     | same file (`aliases`)                                                   | every insertable type                                                                                    | only findable by exact label                                                                                                                         |
| Picker schematic glyph                                    | `client/views/editor/slide-type-schematics.js`                          | every insertable type                                                                                    | generic text-only diagram                                                                                                                            |
| Sample content                                            | `shared/slide-types/types/<name>/authoring.js` (`sample`)               | every insertable type with content fields (exempt: `embed-slide`, `payoff-slide`, `follow-invite-slide`) | every preview renders from `defaults` — picker thumbnail, peek lightbox and settings curation tile show an empty slide where they promise an example |
| Curated group                                             | `shared/slide-types/types/<name>/authoring.js` (`group`)                | every insertable type                                                                                    | lands in the picker's computed "Other" group _and_ the settings tab's "Other" heading                                                                |
| Inline-edit descriptor                                    | `client/views/editor/inline-edit/descriptors.js` (`INLINE_DESCRIPTORS`) | every registered type                                                                                    | no on-canvas editing; every field is side-form only                                                                                                  |
| Inspector keep-list                                       | `shared/slide-types/types/<name>/inline-edit.js` (`inspectorKeeps`)     | sparse by design (reverse only)                                                                          | inspector shows every field the inline layer misses (the safe default)                                                                               |
| Element-tab offer                                         | `shared/slide-types/types/<name>/inline-edit.js` (`elementTab`)         | sparse by design (reverse only)                                                                          | no "This element" tab for a selected image or card; its settings stay reachable only through the slide-level form                                    |

A fork-local type in `custom/slide-types/` can satisfy the agent, schematic and
inline companions from its own definition (`ai: {}`, `schematic: {}`,
`inline: {}`) but cannot add rows to core's picker maps, so the matrix covers
**core types only** — the same line `git ls-files` draws in
`tests/removed-slide-types.test.js`.

Four rows are marked _sparse by design_: the entry exists only where the default
is wrong (an example the schema cannot convey, a picker group for the long tail,
an inspector override). Forward coverage there is a quality goal, so only the
reverse direction is a gate — which is exactly the drift #323 hit: examples for a
type whose catalog entry was already gone.

### `usage` — inside the catalog entry, deliberately never gated

The catalog entry carries an optional `usage` string: the rules _this
organization_ set for filling the type (sources, cut-off dates, mandatory
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
- **Reverse coverage is already free.** Because `usage` lives _inside_ the
  catalog entry rather than beside it, the `AI / MCP catalog entry` row's stale
  check retires it along with the entry. A second row would have restated the
  same iteration with a different exemption shape — the duplication this matrix
  exists to remove.

What no cheap test can catch: a `usage` rule that still applies to a live type
but names a field that has since been renamed. That is content rot, not
structural rot, and pretending otherwise would be worse than saying so here.
Rules and limits: `shared/slide-types/usage.js`.

## Derived — nothing to maintain

| Layer                                                 | Derived from                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Editor form, JSON schema, validation                  | `fields[]` on the definition                                                                    |
| Agent-facing content schema (MCP + generation prompt) | `fields[]`, via `deriveAgentSchema()` — hand-written before (T7, slice 3); see below            |
| i18n key scaffolding                                  | `addUiI18nKeysToSlideType()` at registry build                                                  |
| Agent-visible type list (MCP `get_slide_types`)       | the runtime registry, since #386 — was hand-maintained, and was the biggest hole in this matrix |
| Canonical type id (`eu.deckyard.slide.title`)         | `SLIDE_TYPE_IDS`                                                                                |
| Wire spelling of `slides[].type` (export/read)        | `canonicalSlideType()`                                                                          |

### The agent-facing schema, and how a field opts out

Before the agent schema was derived (T7, slice 3), the AI catalog carried a
hand-written `schema:` block per type —
a second copy of what `fields[]` already said. It drifted: of 135 field entries,
five named something no renderer reads (`payoff-slide.tagline`,
`video-slide.videoUrl`, and the deprecated `stages`/`steps` aliases on
funnel/cycle/process). The shape now has exactly one owner, the definition, and
the catalog carries prose only.

Which fields reach an agent is therefore a property of the field:

| On the field    | Meaning                                                                        | Reaches agents                                 |
| --------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| _(nothing)_     | an ordinary authorable field                                                   | yes — this is the default                      |
| `hidden: true`  | legacy mirror of a structured field; also skipped by the semantic projection   | no                                             |
| `ai: false`     | live and editable, but deliberately withheld (infrastructure, legacy counters) | no                                             |
| `helpText: '…'` | the editor's own prose about the field                                         | yes — becomes the schema entry's `description` |

The default is _offered_, matching the type-level rule from #386: withholding is
a decision somebody writes down, not something that happens by omission. The
`ai` key means the same thing on a field as it does on a type
(`isAgentOptOut`), one level down.

### Which keys each surface names

Three audiences read a type's content keys, and each needs a different slice
of the same declaration. The slices are one vocabulary in one module,
`shared/slide-types/declared-keys.js` (D359); a surface imports its predicate
and never writes its own.

| Surface                                                                                 | Predicate               | `fields[]` | `hidden` | `ai: false` | Global slide fields  | `instanceKeys`, `textStyles`, derived contrast keys | Undeclared key           |
| --------------------------------------------------------------------------------------- | ----------------------- | ---------- | -------- | ----------- | -------------------- | --------------------------------------------------- | ------------------------ |
| Writes: strict MCP, `validateSlideFields` (editor save, API v1, MCP add/update, create) | `declaredContentKeys()` | yes        | yes      | yes         | yes                  | yes                                                 | refused, `unknown_field` |
| Deck import (`normalizeDeckSlide`)                                                      | `declaredContentKeys()` | yes        | yes      | yes         | yes                  | yes                                                 | dropped                  |
| Published JSON Schema (`/api/v1/schema/*`): `properties`                                | `isPublishedField()`    | yes        | no       | yes         | yes                  | `textStyles` only                                   | —                        |
| Published JSON Schema: `propertyNames`                                                  | `declaredContentKeys()` | yes        | yes      | yes         | yes                  | yes                                                 | invalid                  |
| Agent catalogue (`get_slide_types` schema, generation prompts)                          | `isAgentField()`        | yes        | no       | no          | no (`globalOptions`) | no                                                  | —                        |

`derived` is the third kind of declared key beside fields and `instanceKeys`
(`DERIVED_SLIDE_CONTENT_KEYS`, `compose.js`): machine values no author writes,
declared once next to the field they derive from. Stored decks were held to
the write row by migration 102 (`server/db/migrations/102_strip_undeclared_content_keys.js`),
which stripped every key the read funnel neither folds nor the type declares;
there is no tolerant read path for a stray key (D360).

## Also owed, but not a companion: `structure` and `runtime`

Since #453 every **core** type must declare `structure` on its definition —
`singleton`, `collection`, `fixed-collection`, `tabular`, `dataset` or `chrome`
— and since the `runtime` facet landed it must also declare `runtime`:
`static`, `timed` or `live`. A `live` type owes one key more, `interaction`
(`poll` / `likert` / `feedback`), which is the contract `live` implies.

Neither is in the matrix above, and neither should be: a companion is a
hand-written entry in _another_ file that degrades quietly when missing, whereas
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

- **Translations** (`client/i18n/<locale>/slide-types.json`) — keys are derived
  from the registry (`scripts/lib/slide-type-i18n-keys.js`; `scripts/i18n-sync.js`
  prunes whatever the registry no longer produces), the Tier-1 values are added
  by hand when the type lands (`docs/developer/contributing.md`, step 5), and a
  missing key renders the English fallback baked into the definition — so there
  is no per-type matrix row to keep.
  `tests/i18n-coverage.test.js` guards the static `t()` surface.
- **A Dutch sample** — see the box below. The sample a type declares is
  preview-only, so it owes no per-deck-language variant.
- **Slide CSS** (`client/styles/slides/**`) — hand-maintained, but not one file
  per type: types share stylesheets, and a missing rule shows up the moment you
  look at the slide rather than silently.
- **PPTX export tier** — the pattern this matrix generalizes ("no tier → the
  build fails"), but the tier itself does not exist yet. It belongs here once
  the export tiers land (T4).
- **Behavioural subsets** — hardcoded `*-slide` arrays that answer a _behaviour_
  question rather than a coverage one: `NON_CONTENT_SLIDE_TYPES` and
  `SLIDE_ITEM_REQUIREMENTS` (`server/utils/ai/validate-slides/constants.js`),
  and the per-type branches in `server/utils/openai/convert-slide.js`,
  `server/utils/ai/validate-slides/fix.js`,
  `server/utils/convert-file/helpers.js`. A type absent from one of these is not
  degraded — it takes the default branch, which is usually the right answer.
  Asserting total coverage over them would mean asserting a judgement the list
  does not record. Consolidating them is a separate question (STRATEGY A7.1).

These five exclusions are judgements, and until recently nothing checked that
the list of judgements was complete. That is what the inventory below is for.

### Sample content is preview-only

A type's `sample` (in its `authoring.js`) is the filled-in example the picker
renders in a tile thumbnail, the peek lightbox, and the settings curation grid.
It is **never** what an inserted slide is seeded from — that is the slide
factory (`newSlide`), which reads `defaultsByLang[<deck lang>]` and so already
follows the deck language (`tests/insert-seeds-deck-language.test.js`).

Preview-only does not mean optional: a type without one previews as an empty
slide, so the sample is a gated companion like the rest (`picker-sample`). Three
types are exempt. `embed-slide`, because its content _is_ an external URL: the
picker draws it as a static browser-window mockup rather than rendering the
sample at all, and a hardcoded sample URL would turn the settings curation tile
into a live third-party iframe. `payoff-slide` and `follow-invite-slide`,
because they are **chrome** (`fields: []`) and their renderers never read
`content` — the one draws the theme's payoff logo, the other its own
per-language copy plus the session's join code. A type with no content fields
has nothing to exemplify, and the samples they used to carry named keys nothing
declared, rendered or stored. `video-slide` is not exempt but borrows the
`embed-slide` reasoning for one field: its sample leaves `source` blank on
purpose (D107), so its previews show an empty video frame instead of loading a
live third-party player.

**A sample names only keys the type declares** — a field, a global slide field,
or an instance key. It has to be said, because a sample that names something
else does not fail anywhere: the projection and the editor form both walk
`fields[]`, so the stray key is simply dropped and the preview quietly shows
`defaults` where it promises an example. Four samples had drifted that way
before anything checked it: a flat `metric1Value` model that had become an
items field, a `statement`/`labelLow` trio whose fields were renamed, and the
two chrome types above (B248). `tests/semantic-projection-snapshot.test.js`
now checks it for every core type. **And a sample is a declaration, not a draw**: `chart-slide` used to
pick one of three chart types at random on first import, so the tile showed a
different chart per server process and no tracked artifact could pin the
type's example.

**The sample is also what an agent copies** (D119): `get_slide_types` hands it
out as a type's `example` (`exampleFor()` in
`server/utils/ai/slide-catalog/agent-catalog.js`), so a sample has to pass the
type's own content schema as well — strict validation would refuse the copy
otherwise (D87). Where there is no sample, or the one there is leaves a required
field blank (`video-slide`, D107), the example is the type's `defaults` in the
requested language. `tests/strict-accepts-catalog-examples.test.js` pins both
lists.

This is why the locale-tiering work (A6 / A7.7) added **no** Dutch-sample
obligation. It was considered — a `sampleNl` per type, gated like the other
companions — and rejected: it would make every future slide type owe a second
translated sample (a new permanent per-type obligation, exactly what the
locale-tiering brief set out to _reduce_) to change a preview thumbnail that the
user never keeps. Inserted content — the part that becomes the deck — is already
correct. So the sample stays a single English example on purpose, and a Dutch
deck previews an English thumbnail but inserts Dutch content.

## The name-branching inventory — no hole in the matrix

The matrix guards the companions. Nothing guarded the matrix: it is itself a
hand-written list, so a module carrying per-type knowledge that nobody had ever
added simply was not checked. That has a cost on the record. When the List
type's Dutch alias was folded into `list-slide` (PR #451) the _offer_ companions
moved because the matrix named them, and `shared/slide-types/convert.js`,
`slide-form-router.js` and two special cases in `render-field.js` stayed behind
because it did not — so newly authored lists lost affordances that legacy lists
kept, with the whole **Convert** submenu missing.

`tests/slide-type-name-branching.test.js` closes that by _deriving_ the set
instead of declaring it: every tracked module that branches on **three or more**
core type names must be accounted for in `INVENTORY`
(`tests/helpers/slide-type-name-branching.js`), with a kind and a reason. The
gate is on the accounting, not the contents — a module may be a closed-set
special case; it may not be a surprise.

The threshold is the whole judgement, so it is written down rather than implied:
The inventory found both type-specific references and branches over several types. One or two names reads as type-specific behaviour (the chart data
modal exists for `chart-slide`) and no future type can be "missing" from
it; three or more is where a module stops being about a type and becomes a table
_of_ types.

Counts as measured on 2026-08-23 (24 entries; the table below had drifted from
the inventory it describes, so it is restated from a count rather than edited):

| Kind        | Count | What it means                                                                                   |
| ----------- | ----- | ----------------------------------------------------------------------------------------------- |
| `sparse`    | 12    | intentionally partial (repair rules, conversion pairs, the CSS map); only staleness is a defect |
| `specific`  | 5     | a closed set of types that behave differently; not a table                                      |
| `generated` | 3     | produced by a script from per-type sources, so it cannot drift                                  |
| `table`     | 3     | a row per eligible type; must name a companion, which gates it both ways                        |
| `source`    | 1     | the registry — the list every other list derives from                                           |

`specific` was 15 at the first reading. Ten of those entries left when the
`runtime` facet landed and the modules started asking the type instead of
recognising its name — which is the shape of progress this gate exists to
produce: the count drops because knowledge moved onto the types, not because the
threshold moved.

Two modules used to carry `promote: true` — the refine phase's per-type Zod map
and its per-type structural validator table (`STRUCTURE_VALIDATORS`) — both
companion-shaped (a type with no entry is silently unvalidated) and neither
gated. Both are now **gone**: the first when the content schema came to be
derived from `fields[]` (D87, B241), the second after a spell in the matrix as
**Structural validator** (B242). How they went is the more useful lesson.

A companion is a per-type table someone has to remember to fill in, and the gate
exists because they forget. But a table that restates what the definition
already says has a better fate than a gate: it can be derived and deleted.
That map was 32 hand-written Zod schemas of content whose shape `fields[]`
already declared, and it had drifted from it — the strict validator refused the
`example` `get_slide_types` offers for four types. It is now derived
(`server/utils/ai/schemas/content-schema.js`), so there is no coverage left to
check: a type has a content schema because it has fields.

**Ask of a companion whether it can be derived before you gate it.** A gate on a
derivable table is a maintained answer to a question nobody needs asked.
The structural validator looked like the exception and was not. It was gated
here on the argument that cardinality and per-item required fields "hold
together as a shape", a judgement about the type rather than a restatement of
it. Measured against `fields[]` (B242), every check was one of three things: a
restatement of `minItems`, `maxItems` and an item field's `required`, which the
content schema already derives; a disagreement with them; or a rule `fields[]`
cannot express. Five validators required item fields the type calls optional,
and three (`funnel-slide`, `cycle-slide`, `process-slide`) checked a key the
type does not declare, so every valid slide of those types logged a missing
array. One rule was the third kind: `logo-wall-slide` wanted each logo to have
a name or an image, an either-or that no single field's `required` can say. It
went with the table on purpose, and that is a known gap: a logo with neither
renders as the empty-image placeholder, and nothing logs it. A gate kept the
table complete; it could not keep it true. The refine phase now logs the derived
content schema alone.

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
but no consumer yet". There were nine. The test asserted a _floor_ on that count
so it would fail the moment the number dropped, which was the signal to delete
it and point at the facet instead — and that is what happened: see
[`slide-type-runtime.md`](./slide-type-runtime.md). The measurement survives as
a ceiling in `tests/slide-type-runtime.test.js`: no module may write the live
set out again.

**Conversion knowledge lives in three places**: `shared/slide-types/convert.js`,
`client/views/editor/editor-form/type-menu.js` and
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
  _derivation_ (opt-out rule, Tier-2 resolution, schema derivation). This
  document is about author discipline; that file is about behaviour.
- `tests/removed-slide-types.test.js` + `shared/slide-types/removed.js` — the
  same both-directions-with-reasons shape, for types that are gone entirely.
- `docs/reference/wysiwyg-inline-editing.md` — how the inline-edit descriptors
  above are consumed, and what a descriptor can declare.
- `docs/reference/editing-surfaces.md` — the audit rule behind `INSPECTOR_KEEPS`
  (what may be canvas-only and what may never be).

### Editorial field references

In `types/<type>/ai.js`, mark technical field references in `description`, `bestFor` and `notFor` with Markdown code spans: `layout`, `items.title` or `layout="two-column"`. Use the complete item path for nested fields and a JSON string for an enum value. `tests/agent-slide-type-contract.test.js` checks those references against that core type's own `fields[]`; ordinary English outside code spans is not parsed. This pins explicit names and enum values, not every factual claim in natural language. Examples have their own strict-validation gate.

Editorial copy may explain declared carried fields such as the table's hidden `colCount`; declaration membership is broader than the agent schema's offer. The global options contract uses `isAgentField()` and `GLOBAL_SLIDE_FIELD_KEYS` to pin membership, types, enum options, optionality and declared constraints across all core types. Accessibility title and summary are optional overrides, documented once in global options and omitted from each type's schema. Editorial defaults and focus-range suggestions are not registry constraints.
