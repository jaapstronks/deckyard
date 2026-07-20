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
| image-text | **S + I** 🚩 | `imageFit` (base) + item `fit` (override) | slide `image-text-slide.js:437`; item wins `:501-506` | slide via layout-opts `slide-forms/image-slide.js:159-165`; item via `image-text-images.js:203`, `image-element-card.js:198` | `cover` |
| content-columns | N | `col{n}ImageFit` | `content-columns-slide.js` col render | `inspector-form.js:332`; element card `{n}` mode | none (per column) |
| gallery / team-cards / logo-wall / quote | — | no `fit` (cover fixed, or derived from `imageShape`/`imageAspect`) | — | — | — |

One concept, **four** storage strategies and **three** names
(`layout`, `imageFit`+`fit`, `col{n}ImageFit`). `image-slide`'s `layout` also
folds in a value that is *not* a fit value: `bleed` (edge-to-edge) = `cover`
plus a frame bit.

### focus — crop point 🚩

| Type | Level | Field(s) | Render precedence |
|---|---|---|---|
| image-slide | S | `focusX`/`focusY` | `content` (`image-slide.js:256`) |
| image-text | **S + I** 🚩 | slide `focusX/Y` + item `focusX/Y` | item wins; item 0 falls back to slide — `image-text-slide.js:497-500` |
| content-columns | N | `col{n}ImageFocusX/Y` | per column |
| gallery | I | `images[i].focusX/Y` | item |
| team-cards | I | `members[i].`**`imageFocusX/Y`** 🚩 *name diverges* | item |

`team-cards` uses `imageFocusX/Y`; everyone else uses `focusX/Y` — the naming
rule exists to stop exactly this.

### alt 🚩

| Type | Level | Field(s) | Render precedence |
|---|---|---|---|
| image-slide | S | `alt` (+`altNl`/`altEn`) | `content` (`image-slide.js:242-252`) |
| image-text | **S + I** 🚩 | slide `alt` + item `alt` | item wins; item 0 falls back to slide — `image-text-slide.js:481-486` |
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

What that did **not** fix — and step 2 must — is a **display-baseline bug**, not
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
harness — including in image types nobody is actively looking at.

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
   canvas drag + inspector). Pure refactor, render byte-identical. Removed the
   inline repetition; the display-baseline bug is what remains for step 2.
2. **De-duplicate image-text S + I → `ImageRef`.** Make `images[i]` the single
   canonical `ImageRef` for fit/focus/alt; retire the slide-level item-0 fallback
   (migrating the legacy slide-level alt/focus into `images[0]`, preserving the
   alt-translation fallback). Fixes the display-baseline bug (grid then reads the
   canonical value). The only step carrying real data-loss risk — add the generic
   write → render round-trip check here.
3. **Split image-slide `layout` → `ImageRef.fit` + `bleed`.** Cheap once the
   shape is fixed: content migration + renderer + `convert.js` (which becomes
   lossless).
4. **Normalize content-columns `col{n}*` → `ImageRef`.** Resolve the
   numbered/array duality by resolving each column into an `ImageRef`.

The editing-surface UI work (`docs/plans/editing-surfaces.md`) sits on top of
step 1-2: once "This image" reads a single per-element `ImageRef`, the tab split
is mechanical.
