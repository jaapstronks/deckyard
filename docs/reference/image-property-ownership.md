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

## Precedence is inline, not central 🚩

There is no single authority for "item vs slide wins". Each `renderHtml` repeats
the rule itself (`image-text-slide.js:497-500` for focus, `:481-486` for alt,
`:501-506` for fit). Consequences:

- **A dead inspector write.** image-text's "Layout options" focus picker writes
  slide-level `content.focusX/Y` (`slide-forms/image-slide.js:183-190`), but the
  renderer ignores those for cell 0 once `images[0]` has its own focus — so that
  control silently does nothing.
- **A CRDT footgun.** With Yjs, client A writing `content.focusX` and client B
  writing `images[0].focusX` both "succeed"; the item silently wins and A's edit
  vanishes with no conflict and no signal.

## Target model

Split `image-slide`'s conflated `layout` into two orthogonal, uniformly-named
axes and drop the word:

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
blemish, but image-text's S+I duplication is the one with silent data loss.

1. **Centralize precedence.** One `resolveImageProps(slide, item, idx)` every
   renderer calls; removes the inline repetition and the dead-write / CRDT
   footgun. No migration, immediate effect.
2. **De-duplicate image-text S + I.** Make `images[i]` canonical for
   fit/focus/alt and retire the slide-level item-0 fallback (preserving the
   alt-translation fallback). The only change carrying real data-loss risk.
3. **Split image-slide `layout` → `fit` + `bleed`.** Cheap once the target
   shape is fixed here: content migration + renderer + `convert.js`.
4. **Normalize content-columns `col{n}*`.** Resolve the numbered/array duality.

The editing-surface UI work (`docs/plans/editing-surfaces.md`) sits on top of
step 1-2: once "This image" reads a single per-element source, the tab split is
mechanical.
