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
| schematic glyph | `authoring.js` | `slide-type-schematics.js` |
| picker sample content | `authoring.js` | `slide-type-sample-content.js` |
| picker group, curation category | `authoring.js` | picker + settings curation |
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

## Migrating a consumer

While a consumer still enumerates types itself, it imports the moved type's
companion and drops its own copy of the value:

```js
import iconCardGridAuthoring from '…/types/icon-card-grid-slide/authoring.js';

export const SLIDE_TYPE_DESC = {
  …,
  'icon-card-grid-slide': iconCardGridAuthoring.description,
};
```

Two facts resist that, because the consumer's data structure encodes **order** as
well as membership: the picker group and the settings curation category. Those
are declared in `authoring.js` as the authority, while the consumer keeps its
ordered array — and `tests/slide-type-directory-boundary.test.js` asserts the two
agree. That keeps a single authority during the transition instead of two sources
that can drift, and it is the pattern to reuse for any other ordered companion:
**declare the fact, gate the copy, convert the consumer later.**
