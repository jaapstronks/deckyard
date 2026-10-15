# Editing-surface division: canvas / inspector / own surface

A design principle for where an editable setting lives in the Deckyard editor.
It governs every slide-type element (image, text, chart, video, embed, …) and
is the rule to apply when adding a new element type. This document describes the
principle as it now stands; the track that established and rolled it out shipped
across PRs #181–#196 (see the planning archive for that history).

## The problem it solves

Without a rule, the same setting drifts into two places. An image's fit choice,
for example, could sit both as a floating pill over the slide _and_ in the
inspector. That is not just duplicated code: it stops the user building a mental
model of where things live. The principle removes the duplication by giving
every setting exactly one home.

## Principle

> **Canvas** = what you manipulate.
> **Inspector** = what you set.
> **Own surface** = what you input that doesn't fit either.
>
> Every setting exists in exactly one place.
> One entry per element: the inspector tab.
>
> Content has two postures on the same fields (canvas and Fields); settings
> have one home.

The inspector line matters most. Even when an edit opens elsewhere (a chart's
data in its own data editor, say), the inspector element tab stays the single
place where you see what is settable for an element, and the entry point to that
edit.

The last line is the newest (D335). Writing and checking a slide is another posture than
shaping it, so the canvas column has two tabs, **Canvas | Fields**: the canvas
to shape a slide, the Fields form (`client/views/editor/fields-view.js`) to
write and check it, every content field in schema order with Tab from one to
the next. Both show the same content; Fields renders no setting, because the
inspector stands beside it and is a setting's one home. A second posture for
_content_ is not a second home for a _setting_.

## The underlying axis

The split is not _content vs. settings_. It is **what does the edit need?**

| Need                                                         | Surface            |
| ------------------------------------------------------------ | ------------------ |
| See what you type in the real typography and width           | In-place on canvas |
| Spatial, continuous, dragging (crop-focus, resize, position) | Canvas             |
| Pick a value from a set                                      | Inspector          |
| Metadata you cannot point at (alt text, caption, source)     | Inspector          |
| Space and structure (many rows, columns, fields)             | Own wide editor    |

Rule of thumb: if the user must see the result _while_ dragging or typing, it
belongs on the slide. If it is a discrete choice, it belongs in the inspector.

## Per surface, in short

**Canvas** carries direct manipulation only: selection, dragging a crop-focus, `contenteditable` text in the slide itself, and a floating formatting toolbar for the caret or selection (bold, italic, link, list). The toolbar appears throughout a rich edit; linking requires selected text. Nothing on the canvas covers the content the user is judging, and nothing explains a gesture: a single click selects an image (a solid ring plus a small toolbar _below_ it with Replace and Settings), a double-click replaces it directly, and a desktop file dropped on it replaces it too.

**Inspector** carries discrete choices and unpointable metadata: fit mode,
alignment, text-size scale, colour override, alt text, caption, source, delete.
Where a canvas drag and an inspector control set the _same_ value (crop-focus
drag ↔ 3×3 focus grid), that is one value with two representations, which is
fine; two places to _choose_ is not.

**Own surface** is for input that fits neither — chart data is data, not layout,
and a table does not fit a narrow column. Chart data has one route (D338): the
data editor (`client/views/editor/chart-data-modal.js`), a wide modal with the
grid beside a live preview. It writes live like every other edit, so the chart on
the canvas moves as you type; it has no Cancel/Save, only **Done** (or Escape,
Ctrl/⌘+Enter), and the whole session is one undo step, so Cmd+Z after Done takes
it all back. Every way in opens it: the inspector's "Edit data…", a click on the
chart on the canvas, and the data summary that stands in the Fields form (in
the deck editor and in the slide library) in place of the grid.

## Single-element types

When a slide's only job is to show one element (image-slide, video-slide), the
normal tab split still stays — no special casing:

- Even then there is something else to select: the canvas around the element
  carries slide-wide settings (background etc.); the element is not necessarily
  full-bleed.
- Clicking the element already opens its tab directly, so reaching its settings
  costs one natural click.

Corollary: element inputs that have no canvas surface (video source/ID, player
settings, embed URL) are **inspector material** — they must never end up with
the Fields form as their only home, because the Fields form renders no setting
and they would render nowhere. (Content may rely on canvas plus Fields; a
setting never on Fields — the _parity invariant_, guarded by
`tests/slide-type-docs.test.js`.)

## The Fields form in two contexts

The Fields form is one form with two contexts (`FIELDS_CONTEXTS` in
`fields-view.js`), and the context picks its surface row in
`client/views/editor/editor-form/surfaces.js`:

| Context   | Where                                                                   | Surface   | Carries                                                |
| --------- | ----------------------------------------------------------------------- | --------- | ------------------------------------------------------ |
| `deck`    | the deck editor's canvas column                                         | `fields`  | content only; the inspector beside it has the settings |
| `library` | the slide-library editor (one slide, no deck, `single-slide-editor.js`) | `library` | content and settings: it is the slide's only surface   |

The library editor has no canvas and no inspector, so there the form is the one
home of every field; nothing else claims a setting, so nothing duplicates one.

## Why the inspector is the carrier

- **Scalability.** Designing bespoke floating chrome per element type is
  unsustainable; an inspector tab per element type is not.
- **Room for later.** Theme overrides, animation and collab locks can join
  without polluting the canvas.
- **Learnability.** One entry per element means the user learns the pattern once.

## Checklist for a new element type

- [ ] Does every setting exist in exactly one place, and never only in the
      Fields form?
- [ ] Is the inspector tab the only entry to everything settable for this element?
- [ ] Is there nothing on the canvas that covers the content itself?
- [ ] Is every canvas control spatial or direct manipulation — not a chooser?
- [ ] If an own surface is needed: is it non-blocking, and does the slide stay
      visible?

## Related

- `editor-inspector.md` — the inspector's tab machinery and the per-type
  coverage table (which field is surfaced where).
- `wysiwyg-inline-editing.md` — the in-place text editing and selection toolbar.
- `image-property-ownership.md` — the slide-level vs. element-level test used to
  decide which surface owns an image property.
