# Editing-surface division: canvas / inspector / own surface

A design principle for where an editable setting lives in the Deckyard editor.
It governs every slide-type element (image, text, chart, video, embed, …) and
is the rule to apply when adding a new element type. This document describes the
principle as it now stands; the track that established and rolled it out shipped
across PRs #181–#196 (see the planning archive for that history).

## The problem it solves

Without a rule, the same setting drifts into two places. An image's fit choice,
for example, could sit both as a floating pill over the slide *and* in the
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

The last line matters most. Even when an edit opens elsewhere (a chart's data in
a bottom panel, say), the inspector element tab stays the single place where you
see what is settable for an element, and the entry point to that edit.

## The underlying axis

The split is not *content vs. settings*. It is **what does the edit need?**

| Need | Surface |
| --- | --- |
| See what you type in the real typography and width | In-place on canvas |
| Spatial, continuous, dragging (crop-focus, resize, position) | Canvas |
| Pick a value from a set | Inspector |
| Metadata you cannot point at (alt text, caption, source) | Inspector |
| Space and structure (many rows, columns, fields) | Own wide editor |

Rule of thumb: if the user must see the result *while* dragging or typing, it
belongs on the slide. If it is a discrete choice, it belongs in the inspector.

## Per surface, in short

**Canvas** carries direct manipulation only: selection, dragging a crop-focus,
`contenteditable` text in the slide itself, and a floating selection toolbar for
what applies to the *selection* (bold, italic, link, list). Nothing on the
canvas covers the content the user is judging — replacement is a double-click on
the element, not a button sitting over it.

**Inspector** carries discrete choices and unpointable metadata: fit mode,
alignment, text-size scale, colour override, alt text, caption, source, delete.
Where a canvas drag and an inspector control set the *same* value (crop-focus
drag ↔ 3×3 focus grid), that is one value with two representations, which is
fine; two places to *choose* is not.

**Own surface** is for input that fits neither — chart data is data, not layout,
and a table does not fit a narrow column. Preferred form: a non-blocking bottom
panel (the presenter-notes zone gained a sibling "Data" tab) so the chart moves
live as you type. The entry point still sits in the inspector ("Edit data…").

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
the bulk "All text" modal as their only home. (The bulk modal is a convenience,
never the only surface for any field — the *parity invariant*.)

## Why the inspector is the carrier

- **Scalability.** Designing bespoke floating chrome per element type is
  unsustainable; an inspector tab per element type is not.
- **Room for later.** Theme overrides, animation and collab locks can join
  without polluting the canvas.
- **Learnability.** One entry per element means the user learns the pattern once.

## Checklist for a new element type

- [ ] Does every setting exist in exactly one place?
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
