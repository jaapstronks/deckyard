## Slide Types

Slide types are the canonical source of truth for:

- schema/fields (editor UI + validation)
- defaults (new slide content)
- HTML rendering (used by editor, presenter, follow-along, exports)
- AI wizard metadata (for AI-powered suggestions)

**Slide type locations:**
- `shared/slide-types/types/*.js` - Core slide types (shipped with the system)
- `custom/slide-types/*.js` - Custom slide types (for your organization)

Custom slide types are loaded automatically at startup and merged with core types. The `custom/slide-types/` directory is **gitignored**, so your custom slides won't be overwritten when you update from upstream.

Taking a type back *out* is the harder direction and has its own checklist:
`docs/reference/slide-type-removal.md` (deprecation ladder, the deck scan, and
every place a type name is currently duplicated).

### Type identity, namespaces & overriding core

Every slide type has a canonical identity, published as a **reverse-DNS id**
(see `shared/slide-types/type-id.js`):

- **Core** types live under the `eu.deckyard.slide` authority, with the
  historical `-slide` suffix dropped: `title-slide` publishes as
  `eu.deckyard.slide.title`. Whoever owns the domain defines the type, so
  collisions are structurally impossible rather than socially managed.
- **Custom** types default to the `custom` namespace (`custom/acme-hero`). A fork
  can declare its own namespace/version on the definition:

  ```javascript
  export default {
    label: 'Acme Hero',
    namespace: 'acme',   // optional; kebab-case label OR a reverse-DNS
                         // authority ('nl.ciiic.slide'). Defaults to "custom".
    version: '2',        // optional; free-form label recorded in the identity.
    // ...fields, render, etc.
  };
  ```

  Declaring an **authority** (a dotted namespace) is what earns a fork type a
  canonical reverse-DNS id of its own — `nl.ciiic.slide.hero` instead of
  `acme/hero`. A single-label namespace keeps the slash form: we cannot invent a
  domain on a fork's behalf.
- The registry **key** and a slide's stored `type` stay the bare name
  (`acme-hero`, `title-slide`), so existing decks and lookups keep working; the
  identity is an added layer, not a change to storage.
- The published format knows **one spelling** per type — the canonical id.
  The older spellings (`title-slide` bare on the wire, `core/title-slide`)
  still resolve during the beta convergence that folds them away
  (`ROADMAP.md`; beta stance in `docs/reference/versioning.md`).
  `resolveSlideTypeName()` (registry) maps any spelling to the registry key,
  `getSlideType()` to the definition, and `sameType()` compares two refs as
  identities. **Never compare type refs as strings** in engine code, never
  re-derive the suffix rule at a call site, and never add a surface that
  accepts a non-canonical spelling without normalizing through the resolver.

**Overriding a core type is no longer silent.** If a custom type's filename
matches a core type name, it is **refused** (the core type is kept) and a
warning is logged, unless the definition opts in explicitly:

```javascript
export default {
  label: 'My title slide',
  override: true,        // intentionally replace core/title-slide
  // ...
};
```

The portable deck export names each slide's type by its canonical id on
`slides[].type` (`eu.deckyard.slide.title`), which already records the definition
a deck was written against and MAY pin an `@version`. There is no separate
`slideTypes` manifest — `canonicalSlideType` projects the internal registry key
to the published id on export/read, and `resolveSlideTypeName` folds any spelling
back on import.

---

## Quick Start: Adding a Custom Slide Type

### 1. Create the slide type file

Create `custom/slide-types/my-title-slide.js`:

```javascript
import { bgClass, esc } from '../shared/slide-types/helpers.js';

export default {
  themeId: 'my-theme',  // Optional: tie to a specific theme
  label: 'My Title Slide',

  // Optional: which field to use as the slide label in the panel
  labelField: 'title',

  // Optional: auto-assign random background from theme presets
  autoBackgroundPreset: true,

  // Optional: sample content for slide type picker thumbnail
  sampleContent: {
    title: 'Welcome',
    subheading: 'Your presentation starts here',
    background: 'lime',
  },

  fields: [
    { key: 'title', label: 'Title', type: 'string', required: true },
    { key: 'subheading', label: 'Subheading', type: 'string' },
    {
      key: 'bgImage',
      label: 'Background image',
      type: 'image',
      presetSource: 'backgrounds',  // Shows theme background presets
    },
    { key: 'bgAlt', label: 'Alt text', type: 'string' },
    {
      key: 'background',
      label: 'Background color',
      type: 'enum',
      options: ['lime', 'mist', 'night'],
    },
  ],

  defaults: {
    title: 'New title',
    subheading: '',
    bgImage: '',
    bgAlt: '',
    background: 'lime',
  },

  renderHtml: (content, slide, ctx) => {
    const bg = bgClass(content?.background || 'lime');
    return `
      <div class="slide slide-my-title ${bg}">
        <div class="slide-inner">
          <h1>${esc(content?.title)}</h1>
          <p>${esc(content?.subheading)}</p>
        </div>
      </div>
    `;
  },
};
```

### 2. Add CSS (optional)

Create `client/styles/slides/custom/my-title-slide.css` and import it from your styles bundle.

### 3. Restart the server

Your new slide type appears in the editor slide picker.

### 4. Its companions elsewhere

A registered type works, but a few things do **not** follow automatically: the
AI/MCP catalog entry, the picker's description, search aliases, schematic
glyph and the shelf it is offered on ([`group`](../reference/slide-type-groups.md)). Each degrades quietly rather than
breaking, so `tests/slide-type-companion-coverage.test.js` fails the build naming
the type and the companion it is missing. Adding a **core** type means filling
those in; the inventory (and what a fork-local type can supply from its own
definition instead) is in
[`docs/reference/slide-type-companions.md`](../reference/slide-type-companions.md).

A core type also owes two keys on the definition itself: `structure` and
`runtime` (see the Extension Properties table below), plus `interaction` if it
declares `runtime: 'live'`. Those are not companions — a missing declaration
fails CI outright rather than degrading — and fork-local types are exempt.

---

## AI Wizard Integration

Custom slide types can include AI metadata so the AI wizard knows when and how to use them. This is essential if you want the AI analysis feature to suggest your custom slides.

### Adding AI Metadata

Add an `ai` property to your slide type definition:

```javascript
export default {
  label: 'Product Feature Cards',
  themeId: 'my-theme',  // Optional: tie to a specific theme

  // ... fields, defaults, renderHtml ...

  // AI wizard metadata
  ai: {
    // Category determines when AI considers this slide
    category: 'content',  // 'structural' | 'content' | 'interactive' | 'media' | 'people'

    // Phase 1 slides are resolved in the outline phase (title, chapter, closing)
    // Phase 2 slides are for content
    resolveInPhase1: false,

    // Multi-line description explaining the slide type to the AI
    description: `
      A grid of product feature cards, each with an icon, title, and description.
      Perfect for showcasing 3-6 product features or capabilities in a visually
      appealing grid layout.

      STRUCTURE:
      - featureCount: How many features (3-6)
      - Each feature has: feature{N}Icon, feature{N}Title, feature{N}Description

      VISUAL: Features are displayed in a responsive grid with icons prominently featured.
    `,

    // When the AI should choose this slide type
    bestFor: [
      'Product feature showcases',
      'Service capability lists',
      '3-6 distinct offerings with icons',
      'Marketing landing page content',
    ],

    // When the AI should NOT use this slide type
    notFor: [
      'More than 6 items (use multiple slides)',
      'Items without visual icons',
      'Detailed technical specifications (use table-slide)',
    ],

    // Example content for the AI (optional but recommended)
    examples: [
      {
        _variation: 'Product Features',
        title: 'Why Choose Us',
        featureCount: '4',
        feature1Icon: 'rocket-launch',
        feature1Title: 'Fast Deployment',
        feature1Description: 'Get started in minutes',
        feature2Icon: 'shield-check',
        feature2Title: 'Enterprise Security',
        feature2Description: 'Bank-level protection',
        feature3Icon: 'users',
        feature3Title: '24/7 Support',
        feature3Description: 'Always here to help',
        feature4Icon: 'chart-line-up',
        feature4Title: 'Analytics',
        feature4Description: 'Data-driven insights',
      },
    ],
  },
};
```

### AI Metadata Fields

| Field | Type | Description |
|-------|------|-------------|
| `category` | string | `'structural'`, `'content'`, `'interactive'`, `'media'`, or `'people'` |
| `resolveInPhase1` | boolean | `true` for structural slides (title, chapter, payoff), `false` for content |
| `description` | string | Multi-line description explaining the slide type to the AI. Include structure, visual layout, and key concepts |
| `bestFor` | string[] | List of use cases when this slide type is ideal |
| `notFor` | string[] | List of anti-patterns when NOT to use this slide type |
| `examples` | array | Example content objects. Use `_variation` to label different patterns |
| `usage` | string | Your organization's rules for *filling* this type (optional, max 1000 chars) |

Setting `ai` to `false` instead of an object is the explicit opt-out — see
[Withholding a type from agents](#withholding-a-type-from-agents).

#### `usage` — your rules, not the type's description

`description`/`bestFor`/`notFor` help an agent decide **which type to pick**.
`usage` tells it **how your organization requires that type to be filled**, and
it is the one field here that describes you rather than the type:

```js
ai: {
  category: 'content',
  description: 'Quarterly figures for the supervisory board.',
  bestFor: ['Quarterly reporting'],
  usage: `
    Figures come from the published quarterly report, never from a draft.
    Always state the cut-off date in the 'asOf' field.
    A deviation over 5% versus last quarter needs a note explaining it.
  `,
},
```

It travels in every `get_slide_types` response, so an agent reads it before it
builds the slide. Indentation is stripped, so writing it as an indented template
literal is fine. Over-long text is truncated here rather than rejected (losing
the tail beats losing the type); the builder UI and API reject instead, because
an author is standing right there. To put usage rules on a **core** type without
patching the OSS catalog, use `custom/ai/catalog.js` — `usage` is an overridable
field. Full contract: `docs/reference/mcp-server.md`.

### How the AI Uses This Metadata

1. **Prompt Construction**: The AI system builds prompts that include your slide type's description, best-for scenarios, and the schema derived from its `fields`
2. **Slide Selection**: When analyzing presentations, the AI considers your custom slides alongside core slides
3. **Content Generation**: When suggesting changes, the AI uses your examples and that same derived schema to generate valid content
4. **Theme Awareness**: If your slide has a `themeId`, the AI only suggests it for presentations using that theme

### Withholding a type from agents

Omitting the `ai` block does **not** hide a type. Every registered type is
offered to agents (the AI generator and MCP `get_slide_types` alike); without an
`ai` block it simply arrives with a schema derived from its `fields` and
`documented: false`, so the missing guidance is visible rather than the type
being invisible.

To withhold a type on purpose, say so:

```javascript
export default {
  label: 'Follow-along invite',
  ai: false, // deliberately not offered to agents — the app manages this slide
  // …
};
```

`ai: false` and `deprecated: true` are the only two ways out. Everything else is
offered. This is what keeps "deliberately withheld" distinguishable from
"someone forgot to write the copy" — the distinction that used to be expressed
by absence, and therefore not at all. The reader is
`isAgentOptOut()` in `server/utils/ai/slide-catalog/agent-catalog.js`.

### The agent-facing schema is derived — and so is withholding a *field*

An `ai` block carries prose only: `description`, `bestFor`, `notFor`,
`examples`, `usage`. It does **not** declare a schema. The shape an agent sees is
derived from `fields[]` (`deriveAgentSchema()`), the same array the editor
renders a form from and validation runs against, so the two cannot drift apart.
An `ai.schema` left over from an older fork is ignored, with a warning on boot.

The same defaults apply one level down: every field is offered unless it says
otherwise.

```javascript
fields: [
  { key: 'title', type: 'string', maxLength: 120 },
  // Legacy mirror of items[] — kept for stored decks, never authored fresh.
  { key: 'card1Title', type: 'string', deprecated: true },
  // Live and editable, but not something an agent should invent.
  { key: 'bunnyLibraryId', type: 'string', ai: false },
  // helpText travels with the field and becomes the schema's `description`.
  { key: 'sandbox', type: 'enum', options: ['restricted', 'permissive'],
    helpText: "'restricted' blocks scripts and forms." },
]
```

`hidden: true` (a legacy mirror the semantic projection also skips) withholds a
field for the same reason `deprecated: true` does. Everything else — including
layout and background enums — is part of the contract.

---

## Theme-Specific Slide Types

To create a slide type that only appears for a specific theme:

### 1. Set `themeId` in your slide type definition

```javascript
export default {
  themeId: 'acme-corp',  // Must match a theme ID
  label: 'Acme Hero Slide',
  // ...
};
```

### 2. Include it in your theme configuration

In `custom/themes/acme-corp.json`:

```json
{
  "id": "acme-corp",
  "label": "Acme Corporation",
  "slideTypes": {
    "include": ["acme-hero-slide"]
  }
}
```

### How Theme-Specific Slides Work

- **Editor**: The slide only appears in the slide picker when the theme is active
- **Rendering**: Existing slides still render regardless of current theme
- **AI Wizard**: The AI only suggests theme-specific slides for matching presentations

---

## Field Types Reference

### Basic Fields

| Type | Description | Extra Properties |
|------|-------------|------------------|
| `string` | Single-line text | `maxLength`, `required`, `placeholder`, `helpText` |
| `markdown` | Multi-line rich text (renders to HTML; **HTML is escaped**) | `maxLength`, `required` |
| `code` | Monospace textarea storing the raw string verbatim (no markdown, no escaping on input) | `maxLength`, `required`, `capability` |
| `csv` | Tabular text stored as a CSV/TSV string. Editor renders a chart-type-aware grid with a "Raw CSV" toggle (`client/views/editor/fields/csv-grid.js`); serialises to exactly the string the parser eats. Treated as a per-language, collaborative text field everywhere `markdown` is (validation, collab text-keys, i18n/translate filters). Used by the chart `data` field. | `maxLength`, `required` |
| `number` | Numeric input | `min`, `max`, `step` |
| `enum` | Dropdown selection | `options` (array of strings) |
| `boolean` | Toggle. Cleared fields use the `''` convention (like enums). | `required` |
| `color` | Colour value (theme token or raw string), rendered via the colour picker | `helpText`, `required` |

> The full set of valid `field.type` values is declared once in
> `shared/slide-types/field-types.js` (`FIELD_TYPES`). Validation, the editor
> field-renderer and this table all read from that vocabulary;
> `tests/field-types.test.js` fails the build if a definition uses an unknown
> type or this table drifts from the registry.

The `code` field supports `capability: 'customHtml'`: when set, the field is
read-only for users who lack the `canEditCustomHtml` capability (the server
enforces the same rule on write). Used by the built-in Custom HTML slide.

### Media Fields

| Type | Description | Extra Properties |
|------|-------------|------------------|
| `image` | Image picker | `presetSource` (`'backgrounds'` or `'partnerlogos'`) |
| `images` | Multiple images (gallery) | `maxCount` |
| `url` | A hyperlink target (http(s), mailto, or root-/protocol-relative). Validated + allowlisted (`javascript:`/`data:` rejected via `safeHref`); projects as an `<a href>` in the reader/reflow view. Not translatable, so link targets are never sent to translation. | `maxLength`, `required`, `placeholder`, `helpText` |

### Structured Fields

| Type | Description | Extra Properties |
|------|-------------|------------------|
| `items` | Repeating list of structured objects, each shaped by `itemFields`. Edited by the generic collection editor (add/remove, pointer reorder; `collapsible: true` adds per-item collapse, `relationField` names an enum item field describing the relation to the *next* item). Item fields may declare `formLayout`, `editor` and `hidden` like top-level fields. | `minItems`, `maxItems`, `itemFields`, `itemDefaults`, `itemDefaultsByLang`, `collapsible`, `relationField` |

`itemDefaults` is the skeleton a newly added item starts from — neutral
(English) placeholder copy. `itemDefaultsByLang` holds complete per-language
variants keyed like the type-level `defaultsByLang` (`nl`, `'en-GB'`); declare
only languages whose skeleton differs from the neutral one — anything else
falls back to `itemDefaults`. Both add-item surfaces (the collection editor
and the canvas inline editor) resolve through
`shared/slide-types/item-defaults.js` against the **deck** language
(`resolveDeckLang`), not the UI locale: placeholder copy in a new item is deck
content.

### Preset Sources

For image fields, `presetSource` controls which presets appear:

```javascript
{
  key: 'bgImage',
  type: 'image',
  presetSource: 'backgrounds',  // Shows theme.backgroundPresets
}

{
  key: 'logo',
  type: 'image',
  presetSource: 'partnerlogos',  // Shows partner logo presets
}
```

### Form layout (`formLayout`)

The editor renders `fields[]` in declaration order, one field per line. A field
may declare `formLayout: 'pair'` to say it belongs on the same row as its
neighbours: a run of consecutive `pair` fields becomes one `.field-grid` row.

```javascript
fields: [
  { key: 'variant', type: 'enum', formLayout: 'pair', options: [...] },
  { key: 'layout',  type: 'enum', formLayout: 'pair', options: [...] },
]
```

The vocabulary is closed (`shared/slide-types/form-layout.js`) and unknown
values degrade to the default, so a fork cannot land a hint the editor has no
rendering for. Both editing surfaces — the inspector and the bulk "Edit all
text" modal — read the same declaration.

`formLayout` also works on `itemFields`: when any item field declares it, the
generic collection editor renders the item body in declared rows (kpi-metrics
pairs `value` + `unit` this way) instead of the default flex grid.

**Width is deliberately not declarable.** A field's natural minimum width is a
property of its widget, not of the type, and the field renderers already stamp
it (`is-field-narrow|wide|full`). Rows are flex-wrap, so a pair that no longer
fits the dragged form column stacks by itself.

### Field editors (`editor`)

A field whose base widget (the one its `type` implies) is not the right tool
declares a richer one from the closed field-editor vocabulary
(`shared/slide-types/field-editors.js`), resolved by the generic field
renderer:

| Name | Widget | Declared on |
|------|--------|-------------|
| `csv-grid` | Spreadsheet-style data grid (also the base widget of the `csv` type) | chart `data` |
| `table-grid` | Full table editor: cell grid, row/column add/remove, markdown import/export. Also manages the sibling `colCount`/`headerRow` keys | table `rows` |
| `icon-picker` | Icon search/picker modal | icon-card-grid item `icon` |
| `card-link` | Slide-or-URL link picker | icon-card-grid / logo-wall item `link` |

```javascript
{ key: 'rows', type: 'items', editor: 'table-grid', … }
```

An unknown name — or a name the rendering surface has no widget for (the
per-item collection loop implements only the item-sized `icon-picker` and
`card-link`) — degrades to the base widget for the field's `type`; it never
breaks. Fields the editor manages wholesale but never shows as a control of
their own (table `colCount`) are declared `hidden: true`.

### Field visibility (`visibleWhen`)

A field that only means something while a sibling field holds certain values
declares the condition instead of relying on a hand-built form to hide it:

```javascript
{ key: 'showValues', type: 'enum', options: ['yes', 'no'],
  visibleWhen: { field: 'chartType', in: ['bar'] } }
```

Read by the generic field renderer on both surfaces
(`shared/slide-types/field-visibility.js`); the driving value falls back to
the type's default when unset. A malformed declaration degrades to *visible* —
hiding a field on a parse error would orphan its data. The chart type's
display toggles and axis/series labels are the canonical use.

---

## Extension Properties Reference

| Property | Type | Description |
|----------|------|-------------|
| `themeId` | string | Tie this slide type to a specific theme |
| `labelField` | string | Which content field to use as the slide label (default: checks for `title`) |
| `autoBackgroundPreset` | boolean | Auto-assign random background from theme presets when creating new slides |
| `sampleContent` | object | Sample content for the slide type picker thumbnail |
| `defaultsByLang` | object | Localized default content: `{ nl: {...}, 'en-GB': {...} }` |
| `ai` | object | AI wizard metadata (see AI Wizard Integration section) |
| `inline` | object | Inline (WYSIWYG) edit descriptor for the editor canvas (see below) |
| `structure` | string | The shape of the type's primary content: `singleton`, `collection`, `fixed-collection`, `tabular`, `dataset` or `chrome`. **Required on core types** and CI-enforced; optional on fork-local types. See [`docs/reference/slide-type-structure.md`](../reference/slide-type-structure.md) |
| `runtime` | string | What the presenting session has to do for the type: `static`, `timed` or `live`. **Required on core types** and CI-enforced; optional on fork-local types. See [`docs/reference/slide-type-runtime.md`](../reference/slide-type-runtime.md) |
| `interaction` | string | Which kind of answer a `live` type collects: `poll`, `likert` or `feedback`. Required on `live` types, forbidden on the others |

---

## Inline (WYSIWYG) editing for custom types

Core slide types opt into click-to-edit on the editor canvas via a descriptor
registry (`client/views/editor/inline-edit/descriptors.js`). A custom type
cannot edit that core file, so it declares an `inline` descriptor on the
slide-type definition itself, and that is what the lookup reads first:

```javascript
export default {
  label: 'My cards',
  fields: [ /* ... incl. an items field with itemFields ... */ ],
  inline: {
    // "+ <field>" chips for empty optional fields
    ghosts: [
      { field: 'subheading', anchors: [{ sel: '.header', pos: 'append', chip: 'below-start' }] },
    ],
    // add/remove buttons for repeatable items (schema minItems/maxItems apply)
    cards: { field: 'items', container: '.my-grid', itemSelector: '.my-card' },
    // fields fully covered inline; the settings inspector may omit these
    formText: ['title', 'subheading', 'items'],
  },
  renderHtml: (content) => { /* ... */ },
};
```

Two requirements, same as for core types:

1. `renderHtml()` must emit `data-inline-field="<path>"` on editable elements
   (`"title"`, `"items.0.title"`, ...) and `data-inline-item-index="<n>"` on
   repeatable item elements for `cards` to work.
2. The descriptor shapes are documented in the header of
   `client/views/editor/inline-edit/descriptors.js` (ghosts, itemGhosts,
   cards incl. two-level `cards.child`, media, formText).

The descriptor travels to the client via `/api/slide-types`, so it must be
plain JSON: function-valued options (like a dynamic `addPlacement`) only work
in the core registry.

**The definition wins.** `getInlineDescriptor()` reads `def.inline` first and
falls back to the core map — the same definition-first order as every other
companion. So if you override a core type *by name* (`override: true`), your
descriptor replaces core's rather than being shadowed by it, which is what you
want: the server renders your markup for that name, and a descriptor only makes
sense against the markup that was actually drawn. This order flipped on
2026-07-31 ([#507](https://github.com/jaapstronks/deckyard/pull/507)); before
that the core map won, because an override's markup never reached the browser.
See [`../reference/slide-type-directory.md`](../reference/slide-type-directory.md#the-aggregator-seam-rule).

---

## Rendering Rules

### HTML Structure

All `renderHtml()` functions must:

1. Return a single root `.slide` element
2. Include a `.slide-inner` child for content
3. Be **pure** (no DOM reads/writes, no timers, no fetch)

```javascript
renderHtml: (content, slide, ctx) => `
  <div class="slide slide-my-type slide-bg-${content?.background || 'lime'}">
    <div class="slide-inner">
      <!-- content here -->
    </div>
  </div>
`
```

### Security: Always Escape User Content

```javascript
import { esc } from '../shared/slide-types/helpers.js';
import { markdownToSafeHtml } from '../shared/markdown.js';

renderHtml: (content) => `
  <h1>${esc(content?.title)}</h1>
  <div class="body">${markdownToSafeHtml(content?.body)}</div>
`
```

### Theme Context

Access theme data in your render function:

```javascript
renderHtml: (content, slide, ctx) => {
  const theme = ctx?.theme;
  const logoSrc = theme?.assets?.logo || '/assets/images/logo.svg';
  // ...
}
```

---

## Custom Editor Forms (Advanced)

Slide types get their form generated from `fields[]`: definition order, one
field per line, `formLayout: 'pair'` where two controls share a row. Reach for
a hand-written form only when the type needs something a declaration cannot
express — a bespoke widget, a derived control, a toggle that is not a field.
Field order and pairing alone are not reasons; that is what the four forms
retired in the behaviour-abstraction track were doing.

### 1. Create a custom form component

`client/views/editor/editor-form/slide-forms/my-slide.js`:

```javascript
export function renderMySlideForm({ form, slide, add, used, fieldByKey, renderField }) {
  // Custom form rendering logic. Every renderer receives the same flattened
  // context and destructures the subset it uses.
}
```

### 2. Register in the router

`client/views/editor/editor-form/slide-form-router.js` — one row per type in
the `SLIDE_FORMS` table:

```javascript
import { renderMySlideForm } from './slide-forms/my-slide.js';

const SLIDE_FORMS = new Map([
  // …
  ['my-slide', renderMySlideForm],
]);
```

---

## Runtime Behavior (Advanced)

For slides that need JavaScript runtime (timers, event listeners, SSE):

### 1. Add data attributes in HTML

```javascript
renderHtml: (content) => `
  <div class="slide slide-my-type" data-interactive="true">
    <!-- content -->
  </div>
`
```

### 2. Implement runtime handler

`client/lib/slide-runtime/my-slide.js`:

```javascript
export function attachMySlideRuntime(slideEl) {
  const timer = setInterval(() => { /* ... */ }, 1000);

  // Return cleanup function (called when slide unmounts)
  return () => {
    clearInterval(timer);
  };
}
```

### 3. Mount from slide-render.js

Wire it up in `client/lib/slide-runtime/slide-render.js` to attach/cleanup on slide transitions.

---

## Directory Structure (Complete Custom Setup)

```
custom/slide-types/
├── acme-hero-slide.js      # Theme-specific slide
├── product-features.js      # Universal custom slide
└── _helpers.js              # Underscore = private (not loaded)

custom/themes/
└── acme-corp.json           # Theme configuration

custom/assets/
├── fonts/
│   └── AcmeSans.woff2
└── images/
    ├── logo.svg
    └── backgrounds/
        └── hero-bg.jpg
```

All `custom/` directories are gitignored in the OSS repo. They persist through upstream updates.

---

## Complete Example: AI-Enabled Theme-Specific Slide

`custom/slide-types/acme-hero-slide.js`:

```javascript
import { bgClass, esc } from '../shared/slide-types/helpers.js';
import { markdownToSafeHtml } from '../shared/markdown.js';

export default {
  // Tie to Acme theme
  themeId: 'acme-corp',
  label: 'Acme Hero',
  labelField: 'headline',
  autoBackgroundPreset: true,

  sampleContent: {
    headline: 'Transform Your Business',
    subheadline: 'With Acme Solutions',
    background: 'lime',
  },

  fields: [
    { key: 'headline', label: 'Headline', type: 'string', required: true, maxLength: 60 },
    { key: 'subheadline', label: 'Subheadline', type: 'string', maxLength: 120 },
    { key: 'body', label: 'Body', type: 'markdown' },
    { key: 'ctaText', label: 'CTA Button Text', type: 'string', maxLength: 30 },
    {
      key: 'bgImage',
      type: 'image',
      label: 'Background',
      presetSource: 'backgrounds',
    },
    {
      key: 'background',
      type: 'enum',
      label: 'Background color',
      options: ['lime', 'mist', 'night'],
    },
  ],

  defaults: {
    headline: '',
    subheadline: '',
    body: '',
    ctaText: 'Learn More',
    bgImage: '',
    background: 'lime',
  },

  renderHtml: (content, slide, ctx) => {
    const bg = bgClass(content?.background || 'lime');
    const bgStyle = content?.bgImage
      ? `background-image: url('${esc(content.bgImage)}'); background-size: cover;`
      : '';

    return `
      <div class="slide slide-acme-hero ${bg}" style="${bgStyle}">
        <div class="slide-inner">
          <h1 class="hero-headline">${esc(content?.headline)}</h1>
          ${content?.subheadline ? `<p class="hero-subheadline">${esc(content.subheadline)}</p>` : ''}
          ${content?.body ? `<div class="hero-body">${markdownToSafeHtml(content.body)}</div>` : ''}
          ${content?.ctaText ? `<button class="hero-cta">${esc(content.ctaText)}</button>` : ''}
        </div>
      </div>
    `;
  },

  // AI wizard integration
  ai: {
    category: 'structural',
    resolveInPhase1: true,

    description: `
      The Acme Hero slide is the primary opening slide for Acme Corporation presentations.
      It features a bold headline, optional subheadline, body text, and call-to-action button.

      USE THIS SLIDE FOR:
      - Opening slides in Acme presentations
      - Key announcement or product launch slides
      - Landing page style content with CTA

      VISUAL: Large headline with brand styling, optional background image, prominent CTA button.
    `,

    bestFor: [
      'Opening slide for Acme presentations',
      'Product launch announcements',
      'Key messaging with call-to-action',
      'Brand-forward hero content',
    ],

    notFor: [
      'Non-Acme themed presentations',
      'Detail-heavy content slides',
      'Multi-point bullet lists',
    ],

    examples: [
      {
        _variation: 'Product Launch',
        headline: 'Introducing Acme Pro',
        subheadline: 'The next generation of business tools',
        body: 'Faster. Smarter. More powerful than ever.',
        ctaText: 'Get Started',
        background: 'lime',
      },
      {
        _variation: 'Company Overview',
        headline: 'Welcome to Acme',
        subheadline: 'Transforming industries since 1990',
        body: '',
        ctaText: 'Learn More',
        background: 'mist',
      },
    ],
  },
};
```

With the theme config in `custom/themes/acme-corp.json`:

```json
{
  "id": "acme-corp",
  "label": "Acme Corporation",
  "assets": {
    "logo": "/custom/assets/images/acme-logo.svg",
    "logoAlt": "Acme Corp"
  },
  "cssVars": {
    "--t-color-accent": "#0066cc"
  },
  "slideTypes": {
    "exclude": ["title-slide"],
    "include": ["acme-hero-slide"]
  },
  "defaultTitleSlide": "acme-hero-slide"
}
```

This setup:
- Creates a custom hero slide only available for the Acme theme
- Excludes the default title-slide for Acme presentations
- Makes acme-hero-slide the default when creating new Acme presentations
- Teaches the AI wizard when and how to use the Acme Hero slide

---

## Custom HTML slide (raw escape hatch)

`custom-html-slide` (`shared/slide-types/types/custom-html-slide.js`) is a
first-class core type for bespoke, pixel-controlled layouts (org charts,
connected diagrams, one-off compositions) that no typed slide captures. The
author writes raw **HTML** and scoped **CSS** in two `code` fields.

**Rendering** is isomorphic, so the slide renders identically in the live
editor, present mode, audience follow-along, the public `/p/` share viewer, and
the Puppeteer PNG/PDF/OG export paths. PPTX export rasterizes it like any other
slide (no special handling needed).

**Security model:**

- The HTML is sanitized on every render via `sanitizeSlideHtmlSync()`
  (`shared/sanitize.js`). Rich structural markup plus SVG/MathML are kept;
  `<script>`, inline event handlers (`onclick=`…), `<iframe>`/`<object>`/
  `<embed>`, `<form>`/`<input>`, and external `<link>`/`<style>` are stripped.
  **JavaScript is never executed** on any path - Puppeteer *would* run scripts,
  but receives none.
- The CSS is **scoped to the slide root** (`.custom-html-root[data-chr="<id>"]`)
  so it cannot restyle the deck chrome, and is filtered for `@import`,
  `expression()`, and `</style>` breakouts. Author CSS can read theme tokens
  (`var(--t-accent)` …).

**Authoring gate:** writing the raw markup requires the `canEditCustomHtml`
capability. Resolution: a user is allowed if they are an admin, or their email
is listed in the `CUSTOM_HTML_EDITOR_EMAILS` env var (comma-separated). With
neither configured, no non-admin qualifies, so the feature degrades to
view-only on OSS installs. The gate is enforced:

- in the editor UI (the `code` fields render read-only, and the type is hidden
  from the slide-type picker for non-capable users);
- server-side on `PUT /api/presentations/:id` and the public API
  (`PUT`/`POST /api/v1/presentations/:id/slides…`) via
  `customHtmlEditViolation()` - a non-capable actor cannot create or change a
  custom-html slide's `html`/`css`, even by hand-crafting a request.

The type declares `ai: false` on its definition, so the AI generator and MCP
`get_slide_types` never surface or auto-pick it (see
[Withholding a type from agents](#withholding-a-type-from-agents)).

---

## See Also

- `docs/developer/themes.md` - Theme configuration
- `docs/developer/architecture.md` - System architecture overview
- `shared/slide-types/helpers.js` - Rendering helper functions
