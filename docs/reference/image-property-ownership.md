# Image property ownership

Where each image-related property lives in the data model, per slide type, and
where it *should* live. This is the reference the editing-surface work
(`docs/plans/editing-surfaces.md`) leans on: the "This image / Slide" tab split
is only well-defined once the data model answers "does this property belong to
the element or the slide?" the same way for every type.

Read this before adding an image-bearing slide type, or before touching how an
image type's fit / focus / alt / role is stored or rendered.

## The naming rule (the durable contract)

> **One concept, one field name, across every slide type:** `fit`, `focusX` /
> `focusY`, `alt`, `bleed`, `role`. **`layout` means structure only**
> (split / corner / duo / rows / grid) and never fit. A new image-bearing slide
> type uses these names, or documents in its type definition why it must not.

The whole confusion this document exists to end is that `layout` today carries
two unrelated axes under one word: in `image-slide` it *is* the fit/crop axis,
in `image-text` it is the structural arrangement. Freeing the word — so `layout`
means structure everywhere and fit is always `fit` — is the point of the target
model below, not a side effect of it.

### The element-vs-slide test

To decide the record level of any image property, ask: **what survives deleting
the element?**

- Survives (stays meaningful with no image): slide-level. → `background`,
  structural `layout`.
- Does not survive: element-level. → `fit`, `focus`, `alt`, `role`, and
  **`bleed`** (a bled image edge means nothing once the image is gone — so
  `bleed` is element-level, even though it is *about* the slide edge).

## Current state (what the code does today)

Legend for the record level: **S** = slide (`content.<key>`), **I** = item in an
array (`content.images[i].<key>` etc.), **N** = flat numbered slide key
(`col{n}…`, `authorImage{n}…`). 🚩 marks the smell: one concept stored at
different levels across types, at two levels within one type, or an
inspector write path that disagrees with the render read path.

### fit — "how the image fills its frame" 🚩 (the core mess)

| Type | Level | Field(s) | Render reads | Inspector writes | Default |
|---|---|---|---|---|---|
| image-slide | S | **`layout`** (`full`/`bleed`/`centered`) 🚩 *name* | `image-slide.js:215` | `inspector-form.js:179` (`renderKeyInto('layout')`) | `full` |
| image-text | **I** (was S+I) ✅ | item `fit` canonical | every `.frame` carries its effective `is-fit-*` class (one mechanism); legacy `imageFit` is a read-only fallback, folded on edit (step 2b) | images manager only (silent-default UX) | `cover` (type default `IMAGE_TEXT_IMAGE_DEFAULTS.fit`, live) |
| content-columns | N | `col{n}ImageFit` | `content-columns-slide.js` col render | `inspector-form.js:332`; element card `{n}` mode | none (per column) |
| gallery / team-cards / logo-wall / quote | — | no `fit` (cover fixed, or derived from `imageShape`/`imageAspect`) | — | — | — |

One concept, **three** remaining storage strategies and names
(`layout`, `fit`, `col{n}ImageFit`); image-text is on the target shape.
`image-slide`'s `layout` also folds in a value that is *not* a fit value:
`bleed` (edge-to-edge) = `cover` plus a frame bit.

### focus — crop point 🚩

| Type | Level | Field(s) | Render precedence |
|---|---|---|---|
| image-slide | S | `focusX`/`focusY` | `content` (`image-slide.js:256`) |
| image-text | **I** (was S+I) ✅ | item `focusX/Y` canonical | folded to `images[i]` on edit (step 2); slide-level `focusX/Y` is now a read-only fallback for un-migrated decks |
| content-columns | N | `col{n}ImageFocusX/Y` | per column |
| gallery | I | `images[i].focusX/Y` | item |
| team-cards | I | `members[i].`**`imageFocusX/Y`** 🚩 *name diverges* | item |

`team-cards` uses `imageFocusX/Y`; everyone else uses `focusX/Y` — the naming
rule exists to stop exactly this.

### alt 🚩

| Type | Level | Field(s) | Render precedence |
|---|---|---|---|
| image-slide | S | `alt` (+`altNl`/`altEn`) | `content` (`image-slide.js:242-252`) |
| image-text | **I** (was S+I) ✅ | item `alt` canonical | folded to `images[i]` on edit (step 2); slide `alt`/`altNl`/`altEn` are read-only fallbacks (item alt is translated as an itemKey) |
| content-columns | N | `col{n}Alt` | per column |
| gallery / team-cards / logo-wall | I | `images[i]`/`members[i]`/`logos[i]`.`alt` | item (+ numbered mirror synced) |
| quote | **S + I** 🚩 | primary `authorImage{n}Alt` (flat) + extras `quotes[i].authorImageAlt` | flat for portraits 1-2 `quote-slide.js:85-99`; item for extra quotes `:108-118` |

### role, background, structural layout, media collection

| Property | image-slide | image-text | content-columns | gallery | team-cards | logo-wall | quote |
|---|---|---|---|---|---|---|---|
| `imageRole` (a11y exposure) | S `content` | S `content` (all cells) | — | — | — | — | — |
| `background` (slide bg) | S | S (+ `imageBackground` = *different* axis: image-area bg) | S | S | S | S | S |
| **structural `layout`** | ❌ none (its `layout` is fit) | S `split/corner/duo/rows` (toolbar chip) | ❌ (`columnCount`) | S `layout` (grid) | — | — | — |
| media collection | flat `image` | **`images[]`** (legacy flat → item 0) | flat `col{n}Image` | `images[]` | `members[]` (+`card{n}` mirror) | `logos[]` (+`logo{n}` mirror) | flat `authorImage{n}` + item `quotes[i].authorImage` 🚩 |

`imageRole` and `background` are **uniformly slide-level** — they do not exhibit
the smell. Only `fit`, `focus`, `alt` (and the portrait `image` in quote) do.

### Numbered ↔ array duality (a related, separate smell)

`team-cards` (`members[]`), `logo-wall` (`logos[]`), `icon-card-grid`
(`items[]`) and `text-blocks` (`rows[]`) each keep a legacy numbered mirror
(`card{n}`, `logo{n}`, `row{n}`). Render reads the **array first**; the
inspector writes the array and syncs the numbered mirror — so they agree, array
canonical (`ensureMembers` `descriptors.js:578`, `ensureLogos` `:638`).
`content-columns` is the exception: **numbered-only, no array**, so its
per-column fit/focus/alt are flat slide keys masquerading as per-item state.

## Precedence, and the display-baseline bug it leaves

Until PR #182 there was no single authority for "item vs slide wins": each
`renderHtml` re-derived the rule inline, and the canvas focal drag and inspector
each re-derived their own copy. **Step 1 (#182) centralized the read** into
`resolveImageTextCell(content, idx)` in `shared/slide-types/image-text-images.js`
— render, the canvas focal-point drag and the inspector's effective-fit all read
through it, so the three can no longer drift.

> **Fixed in step 2 (2026-07-20).** `ensureImageTextImages` now folds the
> slide-level focus/alt into `images[0]`, so the inspector's focus grid seeds
> from the canonical per-image value and shows the real crop start. The rest of
> this section describes the bug as it was; kept for the reasoning.

What that did **not** fix — and step 2 did — was a **display-baseline bug**, not
a dead write. Trace the three focus write paths and every write takes effect: the
inspector 3×3 grid always writes a number (0/50/100, Center = 50/50), the canvas
drag localizes to `images[idx]`, and render reads the item as soon as
`focusX !== ''`. The defect is what the user *sees*: for a cell-0 image with no
own focus, the inspector grid highlights **center** while the effective (rendered)
crop is the slide-level fallback (e.g. 25/75) — **the grid shows the wrong
starting position.** Verified live 2026-07-20 (grid dot = "Middle center" while
the canvas handle and render sat at 25/75).

The root cause is that fit/focus/alt still live at two record levels
(slide + item) with the item as the canonical crop but the grid seeded from the
raw item value. Step 2 removes the duality (below), which removes the wrong
baseline as a byproduct. (Frame the effect a user sees — "grid shows the wrong
start position" — not an architecture category like "dead write" or "CRDT
footgun"; the latter invites a stricter misreading than the code supports.)

## Target model

### The canonical shape: `ImageRef`

Every image — the single image of an `image-slide`, an item in an `images[]`
array, a numbered `col{n}Image` — resolves **to and from one value object**:

```
ImageRef = { src, alt, fit, focusX, focusY, bleed, role }
```

Once an image is always an `ImageRef`, the question this document exists to
answer — "does this property live on the slide or the element?" — **dissolves**:
an `ImageRef` is the element, always. The flat / numbered / array record-level
duality falls out as a byproduct of resolving each storage shape into an
`ImageRef`, rather than being fought property-by-property. This is the target the
per-step migrations below converge on; do not migrate `fit`, then `focus`, then
`alt` as independent axes — migrate the *shape*.

A generic **write → render round-trip check** over `ImageRef` (set each field via
the inspector seam, assert the render reflects it, assert the inspector re-reads
the same value) catches the whole class of baseline / stale-read bugs in one
harness — including in image types nobody is actively looking at. Shipped for
image-text in `tests/image-ref-round-trip.test.js`.

### Defaults live in the type definition, not in a record

What an `ImageRef` field falls back to when the item carries none is **config,
not a per-slide record** — the right-hand side of `images[i].fit ?? typeDefault`.
A per-image field being empty means "follow the type"; a value means "the user
chose this deliberately". That distinction is only preserved if the default is
never written into the data (a fan-out that stamps the default onto every item
freezes the deck against a future default change and erases the empty/explicit
signal).

Each image-bearing type therefore declares an `imageDefaults` bundle, e.g.
image-text (`IMAGE_TEXT_IMAGE_DEFAULTS` in `shared/slide-types/image-text-images.js`):

```js
imageDefaults = { fit: 'cover', focus: { x: 50, y: 50 }, aspectRatio: null, allowUpscale: true }
```

- **`focus` as a type default** is expressive in a way per-slide state is not: a
  persons-grid sets `focus: { x: 50, y: 35 }` so heads sit high with no per-photo
  correction. That knowledge belongs to the type.
- **`allowUpscale` / `aspectRatio`** are reserved in the shape so a later need
  (e.g. "never upscale a screenshot") does not arrive as a fourth ad-hoc field.
  Not enforced by the renderer yet.
- **Retroactive by design.** Changing a type default changes every deck that
  never overrode it — like a theme. That is usually what you want, but it is a
  behaviour change relative to stored values, so it is a deliberate, documented
  property, not a side effect.
- **Inspector UX for a silent default:** show the effective value as *derived*
  (ghost/placeholder, distinct from an explicit selection), label its origin
  ("Contain · from slide type"), and give an explicit "back to default" that
  **empties** the field (saving the default value would be a fan-out by another
  name).

> **Audit criterion (add to the scorecard):** *every default is lookupable in
> the type definition*, not hard-coded in a renderer or an inspector. The old
> matrix showed defaults scattered per type (`full` here, `cover` there, none for
> `content-columns`) — the same spread the field-name rule cleans up. Moving to
> type defaults without enforcing this just re-nests the spread in a new place.

> **Fit is live since step 2b** (PR #184): an image-text item without its own
> `fit` follows `imageDefaults.fit`, and the fold in `ensureImageTextImages`
> deliberately drops a stored base fit that equals the default instead of
> stamping it onto the items — exactly to preserve the empty/explicit signal
> described above. `focus` was already live as a type default.

### The fit/bleed split (part of `ImageRef`)

`ImageRef.fit`/`bleed` replace `image-slide`'s conflated `layout`. Split it into
two orthogonal, uniformly-named axes and drop the word:

```
content.fit   = 'cover' | 'contain'     // element-level, same vocab as image-text
content.bleed = true | false            // element-level (frame edge)
```

| Was (`image-slide.layout`) | Becomes |
|---|---|
| `full`     | `fit: cover`,   `bleed: false` |
| `bleed`    | `fit: cover`,   `bleed: true`  |
| `centered` | `fit: contain`, `bleed: false` |

Use the existing `cover`/`contain` vocabulary (what image-text already stores,
`convert.js:306`) — do not invent a third vocabulary. After the split:

- **`fit` is one concept, one field, everywhere** — the shared
  `image-element-card` renders the type's allowed fit set and writes `fit`, with
  no per-type branch and no encode/decode shim.
- **`layout` means structure only** — image-text keeps `split/corner/duo/rows`
  on the slide (toolbar chip); nothing else calls its fit "layout".
- **`bleed` becomes expressible where it was not**, e.g. `contain + bleed`
  (image fits, frame runs to the edge) — a legitimate state the old three-value
  enum could not represent.

Why not a declarative remap on the card (`{id:'full-bleed', store:'bleed'}`):
`full-bleed` is not a fit value, so encoding three UI values onto one stored
`layout` field freezes the conflation in data instead of code, keeps
`contain+bleed` unexpressible, and re-introduces the per-type asymmetry (three
fit values for image-slide, two for the rest) we set out to remove. A correct
version would need a two-axis codec over one field — at which point migrating
the field is cheaper.

### Conversion becomes lossless

Today `convert.js:306` demotes both `full` and `bleed` to `cover`; the
edge-to-edge distinction is lost. After the split, `bleed` simply travels as a
property image-text does not yet use, and the reverse direction
(image-text → image-slide, currently not offered) becomes worth building — there
is nothing left to guess.

## Migration path (tracked in planning)

Ordered so the highest-risk, data-losing item comes before the cosmetic one.
The matrix above is what fixes the ordering: `image-slide`'s naming is a design
blemish, but image-text's S+I duplication is the one with silent data loss. All
steps converge on the `ImageRef` shape above — migrate the shape, not each
property.

1. ~~**Centralize precedence.**~~ ✅ **Shipped — PR #182 (2026-07-20).** One
   `resolveImageTextCell(content, idx)` is the single read authority (render +
   canvas drag + inspector). Pure refactor, render byte-identical.
2. ~~**De-duplicate image-text S + I → `ImageRef` (focus + alt).**~~ ✅ **Shipped
   — datamodel step 2, PR #183 merged (2026-07-20).** `ensureImageTextImages` folds the
   slide-level `alt`/`focusX`/`focusY` into `images[0]` and clears them; the
   inspector now reads the canonical per-image focus, so the focus grid shows the
   real crop start — the **display-baseline bug is fixed**. The slide-level focus
   picker is gone (focus is per-image). `altNl`/`altEn` stay as a read fallback.
   Guarded by a generic write → render round-trip harness over the ImageRef
   (`tests/image-ref-round-trip.test.js`). **`fit` was deliberately *left out* of
   this step** — see step 2b below for why.
2b. ~~**Unify the fit CSS mechanisms, then move `fit` onto the `ImageRef`.**~~
   ✅ **Shipped — PR #184 (2026-07-20).** Fit could not migrate with focus/alt
   because slide-level `imageFit` and per-image `fit` rendered through two
   different CSS mechanisms (`.media` padding 0.65× vs `.frame` padding 0.35×)
   that coincided for multi-cell but not single-cell layouts. Landed in the
   planned order: (a) the class-level fit snapshots in the round-trip harness
   were the guard; (b) the CSS unified onto **one frame-based mechanism** —
   every frame carries its effective `is-fit-*` class, the container fit class
   is gone, so the HTML no longer betrays the record level. Padding unified on
   **0.35×** after rendering both candidates on the real single-cell contain
   slides in the browser (0.35 shows the contained image larger with ample
   margin, and matches what multi-cell + per-image fit already used); (c) the
   then-render-neutral fold in `ensureImageTextImages` fans a *deviating* base
   fit out to the items and simply drops a default-equal one, and the
   slide-level fit control is retired (images manager owns fit, silent-default
   UX). Legacy `imageFit` stays a read-only render fallback for un-migrated
   decks, like the flat `image`.
3. **Split image-slide `layout` → `ImageRef.fit` + `bleed`.** Rides on the fit
   CSS unification (2b): content migration + renderer + `convert.js` (lossless).
4. **Normalize content-columns `col{n}*` → `ImageRef`.** Resolve the
   numbered/array duality by resolving each column into an `ImageRef`.

The editing-surface UI work (`docs/plans/editing-surfaces.md`) sits on top of
step 1-2: once "This image" reads a single per-element `ImageRef`, the tab split
is mechanical.
