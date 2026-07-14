# Custom Slide Types: Frontend Implementation

> Status: **Implemented**

## What Was Built

Full settings UI for creating, editing, and managing custom slide types. This completes the frontend layer on top of the already-implemented backend (migration, storage, API routes, template compiler, runtime builder).

### New Files

| File | Purpose |
|------|---------|
| `client/views/settings/slide-type-editor/field-editor.js` | Collapsible field list editor with reorder, type selection, nested items support |
| `client/views/settings/slide-type-editor/preview.js` | Live iframe preview with 16:9 ratio, client-side template rendering (300ms debounce) |
| `client/views/settings/slide-type-editor/index.js` | Two-column editor component (form + sticky preview), mirrors theme-editor layout |
| `client/styles/base/04-editor-and-misc/89-slide-type-editor.css` | All styles: card grid, editor layout, field list, preview, badges, context menus |

### Modified Files

| File | Change |
|------|--------|
| `client/styles/base/04-editor-and-misc.css` | Added `@import` for the new CSS file |
| `client/views/settings/tabs/slide-types-tab.js` | Added custom types section (CRUD, card grid, context menu, publish toggle), editor open/close, "Duplicate as Custom" on core types |
| `client/views/editor/slide-type-picker.js` | Added "Custom" group between "Interaction" and "Other" for types with `isCustom` or `custom-` prefix |
| `client/views/editor/editor-form.js` | Added blue "Custom type" badge with "Based on: X" tooltip |

---

## How to Test

### Prerequisites

- PostgreSQL running with migration `035_custom_slide_types` applied
- `npm run dev` with `STORAGE_MODE=postgres`
- Logged in as a user with **designer** or **admin** role

### Test Flow

1. **Navigate to Settings > Slide Types tab**
   - Verify you see two sections: "Custom Slide Types" (with Create button) and "Slide Type Curation" (existing toggles)
   - The custom types section should show an empty state message

2. **Create a custom type**
   - Click "Create Type"
   - Fill in name (e.g. "Hero Banner"), slug auto-generates
   - Pick a base type (optional, e.g. "Content slide")
   - Add fields: a `string` field "title", a `markdown` field "body", an `image` field "backgroundImage"
   - Set defaults JSON: `{"title": "Welcome", "body": "**Hello** world"}`
   - Add a template:
     ```html
     <div class="hero-banner">
       <h1>{{esc title}}</h1>
       <div class="hero-body">{{markdown body}}</div>
     </div>
     ```
   - Add CSS: `.hero-banner { padding: 3em; text-align: center; }`
   - Verify the live preview on the right updates as you type
   - Click Save -- verify toast success, card appears in the list with "Draft" badge

3. **Publish the type**
   - Click the three-dot menu on the card, select "Publish"
   - Badge should change to "Published"

4. **Use the type in the editor**
   - Open any presentation in the editor
   - Open the slide picker (+ button)
   - Scroll to the "Custom" category -- your type should appear
   - Insert it -- the slide should render (loading placeholder then server-rendered HTML)
   - In the editor form, verify:
     - Fields render correctly (title input, body markdown, image picker)
     - Blue "Custom type" badge appears in the header

5. **Edit the custom type**
   - Go back to Settings > Slide Types
   - Click "Edit" on the card
   - Change the template or add a field
   - Save -- verify the toast and updated card

6. **Duplicate**
   - Three-dot menu > "Duplicate" -- a copy should appear in the list

7. **Duplicate a core type**
   - In the curation section below, hover over any core type row
   - A "Duplicate" button appears -- click it
   - Editor opens pre-populated with the core type's fields and defaults
   - Save as a new custom type

8. **Delete**
   - Three-dot menu > "Delete" on a custom type
   - Confirm the prompt -- type disappears from list and picker

9. **Unpublish**
   - Three-dot menu > "Unpublish" on a published type
   - Badge changes to "Draft", type no longer appears in the slide picker

---

## Architecture Notes

- **Field editor** supports all 6 backend field types: `string`, `markdown`, `image`, `images`, `enum`, `items` (with recursive nesting for items sub-fields)
- **Preview** renders client-side only (no API call), using simple `{{esc key}}`, `{{#if}}`, `{{#each}}` substitution with sample/default values
- **Picker** detects custom types via `isCustom` flag on the definition or `custom-` key prefix
- **Editor form** already handles custom types via the default case in `slide-form-router.js` (renders all fields in order) -- no changes needed there
- **Rendering pipeline** for actual slides goes through the server: `slide-render.js` detects non-bundled types, fetches from `/api/presentations/:id/render-slide`, server uses compiled templates

---

## Next Steps

### Short-term

- [ ] **Field validation in the editor form** -- custom fields with `required: true` should show validation errors before save (currently only enforced server-side)
- [ ] **Sort order** -- add drag-to-reorder for custom types in the settings card grid (the `sortOrder` column exists in the DB but the UI doesn't expose it yet)
- [ ] **Template syntax documentation** -- add a help link or expandable reference for the template syntax (`{{esc}}`, `{{markdown}}`, `{{#if}}`, `{{#each}}`, available CSS classes)
- [ ] **Import/export custom types** -- JSON export of type definitions for sharing between instances or backing up

### Medium-term

- [ ] **Template editor enhancements** -- syntax highlighting (CodeMirror or similar), auto-complete for field keys, preview error messages when template has invalid syntax
- [ ] **Version history for custom types** -- the `presentation_versions` pattern could be adapted to track custom type changes
- [ ] **Marketplace / sharing** -- allow publishing custom types to other organizations (cloud feature)
- [ ] **AI-assisted template generation** -- "Describe your slide layout" prompt that generates template + CSS

### Integration with existing features

- [ ] **Markdown import mapping** -- add custom types to the heuristic matching in `server/utils/markdown-import/map.js` (e.g. via frontmatter `layout: custom-hero-banner`)
- [ ] **AI deck generation** -- the AI pipeline already handles custom types via `buildMergedSlideTypes()` but could benefit from training examples in the custom type definition
- [ ] **Export pipeline** -- verify PDF/PPTX/PNG exports render custom types correctly (should work via server-side rendering but needs testing with complex templates)
