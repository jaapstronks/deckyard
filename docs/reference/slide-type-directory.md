# The slide-type directory form

**What a slide type looks like when it owns itself.** One type, one directory,
one registration line — and every other layer reads that directory instead of
keeping its own description of the type.

This page describes the shape and the rules that hold it in place. It is
reference, not a plan: the migration that introduced it is tracked separately
(track A7.1) and only some types have moved so far. A type that has not moved is
a single `types/<name>-slide.js` module with its companions still scattered
across the consumers; both forms work, and the registry does not care which one
a type uses.

**Most types are mid-move, and that is the designed state.** The migration is
cut along the *consumer*, not along the type: one PR takes one consumer and
moves that one fact for every type at once. So a type's directory appears the
first time a companion of its is claimed, and fills up PR by PR while its
definition is still the flat `types/<name>-slide.js` next door. A directory
holding nothing but `authoring.js` is a type two-thirds of the way here, not a
mistake. The definition module moves in last, and until it does, that type is
absent from the checks below that only apply to `index.js`.

## The layout

```
shared/slide-types/types/icon-card-grid-slide/
  index.js         definition: label, fields[], defaults, renderHtml     isomorphic
  render.js        renderHtml                                            isomorphic
  authoring.js     picker copy, aliases, schematic, sample, group        editor
  inline-edit.js   inline-edit descriptor, inspector keep-list           editor
  ai.js            editorial copy for agents: description/bestFor/…      SERVER ONLY
  cards.js         (internal — whatever the type needs for itself)
```

**The directory name is the registry key.** `types/icon-card-grid-slide/` holds
`icon-card-grid-slide`. The mapping is mechanical on purpose, so a loader that
discovers types by scanning directories takes the name straight off the
directory rather than off a second declaration inside it.

**The five named files are the contract; anything else in the directory is the
type's own business.** `cards.js` above is not a slot — it exists because
`render.js` and `inline-edit.js` both need the same answer to "what cards does
this content hold", and neither is the natural owner of the other. Split
internals whenever that is true.

**Every companion is optional.** A type with no on-canvas editing has no
`inline-edit.js`; a type withheld from agents has no `ai.js`. Absence is a
legitimate answer, and which absences are *also* a gap is
`tests/slide-type-companion-coverage.test.js`'s question, not this page's.

## The one rule

> **`index.js` and `render.js` reach nothing sideways.** They import each other,
> the shared render helpers and the directory's own internals. They never import
> `authoring.js`, `inline-edit.js` or `ai.js`. Each companion is imported by the
> consumer that needs it.

Deckyard has no bundler, so an `import` in a module the browser loads is a file
the browser fetches. The registry pulls in every type's `index.js`, which makes
`index.js` the most expensive place in the codebase to put anything: today the
browser already downloads ~368 KB of type modules on a presenter page. The AI
catalog alone is ~168 KB of prose the browser never executes — colocating it and
importing it from `index.js` would have been a ~46% payload increase for nothing.

So colocation is about *where the file lives*, not about who imports it. The
directory groups the type's facts for a human; the import graph still runs from
each consumer down to the one companion it needs.

`tests/slide-type-directory-boundary.test.js` enforces this three ways: no core
module imports a companion; no `ai.js` is reachable by walking the real module
graph from the browser's render entry; and `ai.js` is imported from `server/`
only. The rule was an agreement first, and agreements drift — that is the whole
subject of the track this form came out of.

## What goes where

| Fact | Slot | Read by |
|---|---|---|
| label, `fields[]`, `defaults`, `defaultsByLang` | `index.js` | registry, editor form, validation, agent schema |
| `renderHtml` | `render.js` | presenter, editor preview, export |
| picker description, search aliases | `authoring.js` | `slide-type-picker/data.js` |
| schematic glyph, per-preset glyph overrides | `authoring.js` | `slide-type-schematics.js` (derived) |
| picker sample content | `authoring.js` | `slide-type-sample-content.js` |
| curated group (`group`) | `authoring.js` | picker shelves + settings curation (derived) |
| inline-edit descriptor | `inline-edit.js` | `inline-edit/descriptors.js` |
| inspector keep-list | `inline-edit.js` | `editor-form/inspector-form.js` |
| agent description / bestFor / notFor | `ai.js` | `ai/slide-catalog/` |
| agent examples | `ai.js` | `ai/slide-catalog/examples/` |

The agent-facing **schema** is deliberately absent from `ai.js`: it is derived
from `index.js`'s `fields[]` by `deriveAgentSchema()`. A hand-written second copy
of a field list can only ever be right by accident, and was not
(`docs/reference/` — see the agent contract work behind `agent-catalog.js`).

Two things that are *not* in the directory today:

- **The stylesheet.** `client/styles/slides/**` stays where it is; only the
  `@import` aggregators are derived, from the manifest in
  `scripts/generate-slide-css-aggregators.js`. Moving CSS is entangled with the
  separate question of what a slide type is even allowed to style.
- **The side-form renderer** (`client/views/editor/editor-form/slide-forms/`).
  It is behaviour, not data, and it depends on editor infrastructure (`h()`,
  field factories, collapsed-state); importing that from `shared/` would invert
  the layering. Its *data* half moves, though — see `cards.js`.

## Author-facing copy and i18n

`authoring.js` is scanned by the i18n hardcoded-copy gate
(`tests/i18n-audit.test.js`), because it carries free-form English copy that
would otherwise silently leave the gate's scope when a type migrates. `index.js`
is deliberately *not* scanned: its field labels are localised through the derived
`slideType.*` keys rather than `t()`.

## Reaching a companion: the authoring aggregator

Deckyard has no bundler, so a browser consumer cannot scan a directory — it needs
a static import per type. `shared/slide-types/authoring.js` is that import list,
and it exists so there is exactly **one** of them instead of one per consumer:

```js
import { SLIDE_TYPE_AUTHORING } from '…/shared/slide-types/authoring.js';

export const SLIDE_TYPE_SCHEMATIC = Object.fromEntries(
  Object.entries(SLIDE_TYPE_AUTHORING)
    .filter(([, authoring]) => authoring?.schematic)
    .map(([type, authoring]) => [type, authoring.schematic])
);
```

Each facet reads one field and filters on it. The picker's glyph and its sample
content both do this, in `shared/slide-types/authoring-companions.js`; the group
does it one file over in `authoring-groups.js`. A type with no `sample` key just
falls out of the map and the caller takes its default branch, never an error.
New facets follow the same shape.

## The aggregator seam rule

**The aggregator is core's answer, never the population.** It is generated over
`shared/slide-types/types/`, so a lookup that reads it *first* silently answers
a narrower question than it looks like — and the types it leaves out are exactly
the ones a fork owns. Five rules, and they apply to every companion derived this
way:

1. **Definition first, aggregator second.** A companion looked up at runtime is
   looked up against the definition *as it exists at runtime*.
2. **One lookup per facet, in the facet module.** Not in the consumer. Every
   consumer that writes its own precedence rule is a place the next drift starts.
3. **Enumerate the live map.** `typesInGroup(group, order, types)` takes the map
   the consumer already holds, rather than iterating the build artifact.
4. **Vocabulary closed, declarant open.** Anyone may declare; only the known
   values count.
5. **Unknown degrades, never breaks.** An unrecognised value falls back to the
   existing default — no warning, no invented shelf.

The catch that made this a rule rather than a bugfix: rules 1 and 2 were already
*written* for `schematic` and `sampleContent`, and did not fire. The editor does
not hold the registry, it holds the `GET /api/slide-types` response, and that
route served neither key — so the fallback branch existed on both sides of a wire
that dropped it. **A companion the browser needs travels on that route**, which is
the sixth thing to check when adding one. Measured cost of carrying all three:
+13 KB on an 800 KB response (+3 KB gzipped), once per deck opened.

Pinned by `tests/slide-type-api-companions.test.js` (the wire) and
`tests/slide-type-groups.test.js` (the precedence).

It is a **generated file** — `npm run gen:slide-authoring`, from
`scripts/generate-slide-authoring-aggregator.js` — because a hand-maintained
import list is a second registration list next to `registry.js`, and it would
drift the first time a type was added or retired. The generator globs: a
directory with an `authoring.js` is in, one without is out. Both directions are
gated by `tests/slide-authoring-aggregator.test.js`, byte-for-byte.

> **It is a sibling of `registry.js`, never a dependency of it.** The registry is
> what the browser loads to *render* a slide, and the presenter renders slides
> without ever offering one. An import from `registry.js` (or from any type's
> `index.js`) would put picker copy into the presenter's payload — the softer
> version of the `ai.js` mistake. `tests/slide-type-directory-boundary.test.js`
> walks the real module graph from the render entry and fails on any route into
> an `authoring.js`.

`inline-edit.js` has the same aggregator now —
`shared/slide-types/inline-edit.js`, generated by
`scripts/generate-slide-inline-edit-aggregator.js` and gated by
`tests/slide-inline-edit-aggregator.test.js`. The only shape difference is that a
descriptor legitimately holds functions (`cropMode`, `addPlacement`, `ensure`),
so it has no "plain data" gate. `descriptors.js` spreads it into
`INLINE_DESCRIPTORS` and keeps only the grammar doc and the two lookup helpers.
There is no equivalent aggregator for `ai.js` yet; its consumers still import per
type. When one is added it follows this shape.

## Migrating a consumer

A rollout PR takes one consumer and moves its fact for every type at once, so
the consumer stops holding a per-type map and derives one instead — the
`SLIDE_TYPE_SCHEMATIC` example above is the finished form. Before that, while a
consumer still enumerates types itself, it can import a single moved type's
companion and drop its own copy of that one value:

```js
import iconCardGridAuthoring from '…/types/icon-card-grid-slide/authoring.js';

export const SLIDE_TYPE_DESC = {
  …,
  'icon-card-grid-slide': iconCardGridAuthoring.description,
};
```

One fact needed a variation on that, because the consumer's data structure
encodes **order** as well as membership: which shelf a type is offered on. It is
declared as `group` in `authoring.js`, both consumers derive their membership
from it, and each keeps its own *order hint* — a partial list saying which types
lead, where a missing name costs a position and a stale name is ignored. See
[`slide-type-groups.md`](./slide-type-groups.md).

That is the pattern to reuse for any other ordered companion: **the fact belongs
to the type, the ordering belongs to the surface.** During the transition the
weaker form is fine too — declare the fact, gate the consumer's copy against it,
convert the consumer later — which is how `group` itself got there.

### Consumers converted so far

| Consumer | Fact | Landed |
|---|---|---|
| `client/views/editor/slide-type-schematics.js` | schematic glyph + per-preset overrides | A7.1 rollout PR 1 |
| `client/views/editor/slide-type-sample-content.js` | picker sample content | A7.1 rollout PR 2 |
| `client/views/editor/inline-edit/descriptors.js` | inline-edit descriptor (35 types) | A7.1 rollout PR 3 |
| `slide-type-picker/data.js` + `settings/…/categories.js` | curated group, 33 types (two disagreeing tables collapsed into one declaration) | A7.1 rollout PR 4 |
| `server/routes/api/slide-types.js` | `group` / `schematic` / `sampleContent` on the wire — the seam rule above, which the three lookups now share | A7.1 seam fix |
