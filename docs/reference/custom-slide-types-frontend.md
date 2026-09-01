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
  router renders its fields. Actual slide rendering goes through the server:
  `client/lib/slide-runtime/slide-render.js` posts to
  `POST /api/presentations/:id/render-slide`
  (`server/routes/api/presentations/render-slide.js`) when the type is either
  **not bundled** (the normal case for a custom type) or **bundled but
  overridden server-side** (a fork file that replaces a core name with
  `override: true`, named in `window.__DECK_SERVER_RENDERED_TYPES__`). Types on
  a tombstone record are excluded — they render the archived-slide placeholder
  client-side.
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
