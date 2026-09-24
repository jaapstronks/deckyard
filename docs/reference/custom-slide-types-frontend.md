# Custom slide types — frontend

## Purpose & scope

Custom slide types let a designer define an organization-owned slide type — a
label, a set of typed fields, default values, a safe template and CSS — and use
it in the editor alongside the bundled core types. This document describes the
**frontend layer**: the Settings editor that authors a type, the picker and
form integration that make it usable in a deck, and the client-side rendering
seam. The server side (storage, API routes, template compiler, runtime builder)
is referenced where the flows cross into it but described in its own modules.

Scope is the browser code under `client/views/settings/slide-type-editor/`,
`client/views/settings/tabs/slide-types-tab/`, and the editor touch-points in
`client/views/editor/`. The public agent-facing surface (`get_slide_types`,
`custom-<slug>` naming, the `usage` string) lives in
[`mcp-server.md`](mcp-server.md).

## Module map

Settings editor (`client/views/settings/slide-type-editor/`):

- `client/views/settings/slide-type-editor/index.js` — two-column editor
  component (form + sticky live preview); mirrors the theme-editor layout.
- `client/views/settings/slide-type-editor/field-editor.js` — collapsible field
  list with reorder, type selection, and nested `items` sub-fields.
- `client/views/settings/slide-type-editor/preview.js` — live 16:9 iframe
  preview, rendered client-side with a 300ms debounce. It renders through
  `createTemplateSlideRenderer` (`shared/slide-types/custom-type-runtime.js`),
  the same seam the deck uses, so the markup and the scoped author CSS are the
  deck's; `tests/slide-type-preview-parity.test.js` pins that equality. The
  iframe supplies neutral chrome only — no theme tokens, no deck stylesheet.
- `client/views/settings/slide-type-editor/io.js` — pure import/export helpers
  (no DOM): portable-definition extraction, envelope serialize/parse,
  client-side slug derivation and collision handling. Unit-tested.
- `client/views/settings/slide-type-editor/template-help.js` — the template
  syntax reference, collapsed under the template field; mirrors the tokenizer in
  `shared/slide-types/template-compiler.js`.

Settings tab (`client/views/settings/tabs/slide-types-tab/`):

- `client/views/settings/tabs/slide-types-tab/index.js` — the "Custom Slide
  Types" section (card grid, CRUD, ⋮ menu, publish toggle, "Duplicate as
  Custom" on core types) plus the existing core-type curation toggles.

Editor integration (`client/views/editor/`):

- `client/views/editor/slide-type-picker.js` — a "Custom" group between
  "Interaction" and "Other" for types flagged `isCustom` or keyed `custom-…`.
- `client/views/editor/editor-form.js` — the blue "Custom type" badge with a
  "Based on: X" tooltip.
- `client/views/editor/editor-form/slide-form-router.js` — routes a custom type
  through its default case, rendering all declared fields in order.

Styles:

- `client/styles/base/04-editor-and-misc/89-slide-type-editor.css` — card grid,
  editor layout, field list, preview, badges, context menus (imported from
  `client/styles/base/04-editor-and-misc.css`).

One facet a DB type does not choose: `toRuntimeSlideType()` writes `fidelity: { pptx: 'raster' }` onto every composed record. A template plus author CSS has nowhere to put a declaration and no native PPTX mapper could exist for arbitrary markup, so this is what the kind of type _is_ rather than what it falls back to - see [`slide-type-fidelity.md`](./slide-type-fidelity.md).

## Data model

Custom types live in the `custom_slide_types` table
(`server/db/migrations/035_custom_slide_types.js`; the `usage` column was added
in `055_custom_slide_type_usage.js`):

| Column                      | Type               | Notes                                                                     |
| --------------------------- | ------------------ | ------------------------------------------------------------------------- |
| `organization_id`           | uuid               | FK → `organizations.id`, `ON DELETE CASCADE`; the tenancy anchor          |
| `slug`                      | varchar(80)        | unique **per organization** (`idx_custom_slide_types_org_slug`)           |
| `label`                     | varchar(255)       | display name                                                              |
| `base_type`                 | varchar(80)        | optional core type it derives from                                        |
| `fields`                    | jsonb              | field definitions (default `[]`)                                          |
| `defaults`                  | jsonb              | default field values (default `{}`)                                       |
| `defaults_by_lang`          | jsonb              | optional per-language defaults                                            |
| `template`                  | text               | safe Handlebars-like subset                                               |
| `css`                       | text               | per-type CSS                                                              |
| `usage`                     | text               | AI usage rules (max `USAGE_MAX_LENGTH`; travels to agents when published) |
| `is_published`              | boolean            | default `false`; draft until explicitly published                         |
| `sort_order`                | integer            | display order in picker and settings grid                                 |
| `created_at` / `created_by` | timestamptz / uuid | audit                                                                     |

The field editor supports all six backend field types: `string`, `markdown`,
`image`, `images`, `enum`, and `items` (with recursive nesting for `items`
sub-fields).

## Essential and required

Each top-level row in the field editor has two checkboxes that answer different questions (D211):

- **Required** refuses a save or publish of a slide that leaves the field empty.
- **Essential** says a slide of this type looks _unfinished_ without the field, not just sober. On an `items` or `images` row it means the first entry; later entries are always optional.

Both are stored the same way: `true`, or not at all. `cleanField` in `shared/slide-types/custom-field-definitions.js` drops a `false`, and the stored vocabulary (`CUSTOM_TYPE_PROPERTY_KEYS`) lists both. A value that is not a boolean is refused with `property_wrong_type` rather than dropped (D219); the same holds for every scalar the vocabulary types in `valueTypes` (`placeholder` and `helpText` take a string, `maxLength`, `minItems` and `maxItems` a number). An item sub-field (a row inside a repeater) has a Required box but no Essential one: a list is essential as a whole, and the shared field walk refuses `essential` on a sub-field with `essential_on_item_field`, whatever route the definition arrives by. `tests/slide-type-builder-declarations.test.js` pins the control and the round-trip; `tests/field-definition-rules.test.js` pins the stored shape and the refusal.

What the flag reaches for a database type is the agent side: `deriveAgentSchema()` carries `essential: true` to `get_slide_types`, and `GET /api/v1/slide-types/:type/schema` reports it beside `required` ([`mcp-server.md`](mcp-server.md)). It does not change the editor canvas of a database type, because such a type has no inline descriptor and so no inline layer; its template emits no `data-inline-field` hooks and every field is edited in the form. The canvas behaviour of `essential` on core and fork types is described in [`wysiwyg-inline-editing.md`](wysiwyg-inline-editing.md#empty-fields-essential-or-optional); the per-field decisions for the core types are in [`essential-fields.md`](essential-fields.md).

## Flows

- **Author a type.** Settings → Slide Types → "Create Type" opens the editor
  (`slide-type-editor/index.js`). The form drives `preview.js`, which renders
  client-side only (`{{esc key}}`, `{{#if}}`, `{{#each}}` over sample/default
  values) — no API call while editing. Save posts to
  `POST /api/custom-slide-types`; the card appears with a "Draft" badge.
- **Publish.** The ⋮ menu → "Publish" flips `is_published`. Once published, the
  type surfaces in the slide picker and its `usage` string travels to agents:
  `get_slide_types` lists it as `custom-<slug>`.
- **Insert into a deck.** The picker's "Custom" group inserts the type; the form
  router renders its fields. Actual slide rendering goes through the server
  when the type is either **not bundled** (the normal case for a custom type)
  or **bundled but overridden server-side** (a fork file that replaces a core
  name with `override: true`, named in `window.__DECK_SERVER_RENDERED_TYPES__`).
  Types on a tombstone record are excluded — they render the archived-slide
  placeholder client-side. Every render call declares where that render comes
  from as `renderVia` (D114); `client/lib/slide-runtime/slide-render.js` maps
  each kind to one route into the same server render (`serveSlideRender` in
  `server/routes/api/render-slide.js`). A missing or unknown kind refuses: the
  slide stays a placeholder and the console names the error. There is no
  fallback from a `presentationId`, which only says what a client renderer
  links to.
  - **`{ kind: 'deck', id }`** (editor, presenter, viewer — a signed-in
    session): `POST /api/presentations/:id/render-slide`
    (`server/routes/api/presentations/render-slide.js`). The deck authorizes the
    render and names the theme and language.
  - **`RENDER_VIA_THEME`** (the settings curation grid, the slide-type picker's
    preview tiles, the slide library, samples): `POST /api/render-slide` with
    `{ slide, mode, theme, lang }`, taken from the mount's own `theme` and
    `lang`. `theme` (a theme id, or `null` for the instance default) and `lang`
    (a deck language, or `null` for `NO_DECK_LANG`) are both required; a body
    silent about either is refused. A database theme UUID resolves under the
    session's organization only.

  Both use the request organization's merged registry
  (`buildMergedSlideTypes`), so a deckless render sees the same fork and
  published database types `/api/slide-types` lists.

  The anonymous surfaces hold no session, and both routes above sit behind the
  login gate. Each renders through the capability that already hands it the
  deck, mounted before the gate, and names a slide **by id**: the capability
  covers that deck's slides, not the organization's renderer, so the server
  renders its own copy with the deck's theme, language and organization
  registry (`serveDeckSlideRender`).
  - **`{ kind: 'share', token, grant }`** (share-link viewer):
    `POST /api/share/:token/render-slide` with `{ slideId, mode, grant }`.
    `verify` mints the grant, a signed 24-hour proof that this viewer passed
    the link's gate (its password, when it has one); the route also validates
    the link itself, so revocation and expiry apply at once. Only slides the
    view-only filter hands the viewer render.
  - **`{ kind: 'follow', id }`** (follow-along audience):
    `POST /api/follow/:id/render-slide` with `{ slideId, mode, lang }`, while
    the follow state is live; `lang` is the version the audience was served.
  - **`{ kind: 'session', id }`** (speaker-notes companion):
    `POST /api/live-sessions/:id/render-slide` with `{ slideId, mode }`.

  `tests/render-via-declaration.test.js` pins that every call site states
  `renderVia` and that no view `client/app.js` mounts without a login
  declares a kind whose route is behind the gate.

- **Reorder.** The settings grid drags cards
  (`editor/inline-edit/reorder-geometry.js`); the ⋮ menu offers "Move
  earlier"/"Move later". Both write the full id list to
  `PUT /api/custom-slide-types/reorder` in one call, so positions become sort
  orders atomically.
- **Import / export.** ⋮ → "Export as JSON" downloads `<slug>.slidetype.json`, a
  portable envelope carrying only the shape (label, base type, fields, defaults,
  template, CSS, usage) — no id/slug/publish-state/audit columns. "Import"
  parses the envelope or a bare definition (`io.js`), derives a unique slug
  against loaded slugs (`my-type` → `my-type-2`), and posts to the normal create
  endpoint. The server **always** stores an import as a draft, even if the
  payload asks for `isPublished: true`, so nothing goes live without review.

## Deleting a type that is in use

Nothing in the schema points at `custom_slide_types`, so a slide that carries a
deleted type's key (`custom-<slug>`) keeps its fields but renders as an unknown
type. `DELETE /api/custom-slide-types/:id` therefore counts the key first — base
slides and every language version's slides of every deck (trashed ones too; a
slide in several language versions counts once),
slide-library items of that type, and saved version snapshots — and refuses a
type with any usage: `409 in_use`, the count in `details.usage`
(`{ slides, decks, libraryItems, versions }`). `?force=true` deletes anyway. The
Slide Types tab asks first as before; on `in_use` it shows the count in a
second confirmation whose button sends the forced delete. Unpublishing is not a
softer route: the render registry reads published types only, so an unpublished
type's slides render as unknown too — only the stored record survives.

## Config & flags

No dedicated feature flag gates custom slide types. Two conditions apply:

- **Storage**: the feature is Postgres-only — it needs the `custom_slide_types`
  table, so it is inert under the JSON/dev storage mode.
- **Role**: authoring is designer-gated (see below).

## Authz & tenancy

Every mutating route (`POST`/`PUT`/`DELETE`/duplicate/reorder) checks
`canManage` (`server/utils/route-middleware.js`), i.e. designer or admin
capability resolved via `server/utils/designer.js`; non-designers get `403`.
Reads are org-scoped. Tenancy is the `organization_id` FK plus the
per-organization unique slug index; the general isolation rules (R1–R3) are in
[`tenant-isolation.md`](tenant-isolation.md), not repeated here.

## Implementation status (as of 2026-08-21)

The frontend described above is live: authoring, publish/unpublish, picker and
form integration, server-side rendering seam, reorder, and import/export all
ship. Required-field validation is flagged client-side
(`editor/fields/required.js`, wired through `editor/fields/basic.js`) and
re-validated on the server at save.

Known open work (template-editor enhancements such as syntax highlighting and
version history, AI-assisted template generation, markdown-import mapping) is
tracked in [`ROADMAP.md`](../../ROADMAP.md), not here. This document describes
what exists today; during beta the field/template contract can still change.
