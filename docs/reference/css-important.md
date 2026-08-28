# `!important` inventory (app CSS)

> The CSS scales — spacing, z-index, typography, breakpoints — live in
> [CSS design tokens](css-tokens.md) and [CSS breakpoints](css-breakpoints.md).
> This document is the companion audit of the other cascade smell: every
> `!important` under `client/styles/**`, sorted into the ones that are
> unavoidable and the ones that are patches worth unwinding.

**Measured on `main` @ `63c5a908`, 2026-08-28.** Reproduce with:

```sh
git grep -o -e '!important' -- client/styles | wc -l   # 72 occurrences
```

Three of those 72 are comments that merely mention the keyword (listed at the
bottom), so there are **69 `!important` declarations**. Every occurrence today
sits on its own line; if one ever carries two, a line-based count under-reports.

Out of scope on purpose: `client/vendor/**` (katex ships one) and the four
`!important`s that `server/export/print.js`, `server/export/pdf-slides.js` and
`server/render/png.js` inject as export-only print CSS. `client/go.css` has none.

## The split: 40 unavoidable, 29 candidates

A declaration is **unavoidable** when it must beat something no selector can
out-specify:

- an inline style written by JS (inline beats every stylesheet selector),
- a class that exists precisely to override at the call site (utilities),
- a published accessibility pattern whose canonical form carries `!important`
  (`.sr-only`, `prefers-reduced-motion` resets).

Everything else is a **cascade-patch**: a rule reaching for `!important` to win
a fight against _another stylesheet rule_, which a better selector could win
instead. Some patches are inert (the selector already out-specifies its rival,
or the rules never apply at the same time); those are free to remove. Others are
load-bearing today and need the rival selector reshaped first.

Removing an `!important` changes what wins the cascade, and Deckyard has no
visual-regression net over most of this UI, so each candidate is unwound **one
at a time, verified in a browser** — not in a sweep.

> **Why this file drifted before.** The previous revision claimed 91/77/14 and
> nine of its fourteen line numbers pointed at the wrong line. Line numbers rot
> on every CSS edit, so the tables below key on **file + selector**, and the
> counts carry the SHA they were measured at.

## Unavoidable — leave these (40)

| Family                       | Where                                                                                        | Count | Why `!important` is the only tool                                                                                                                                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Utility classes**          | `base/01-core/90-utilities.css`                                                              |    12 | `.hidden`/`[hidden]`, `.is-hidden`, `.is-mt-8`, `.is-flex`, `.is-items-center`, `.is-items-start`, `.is-justify-between`, `.is-gap-2`, `.is-gap-3`, `.is-truncate` (×3). A utility exists to override component styles at the call site; this is the one place `!important` _is_ the design. |
| **Screen-reader only**       | `slides/03-components/60-accessibility.css` — `.sr-only`                                     |     9 | The canonical visually-hidden block. All nine declarations are `!important` in the published pattern so no component can reveal or reflow it.                                                                                                                                                |
| **Reduced-motion resets**    | `10-payoff`, `52-morph-transition`, `50-presenter-layout`, `82-auto-advance`                 |     8 | `@media (prefers-reduced-motion: reduce)` forcing `animation`/`transition`/`transform`/`opacity: none`. The WCAG-recommended shape, and it must also beat animation set inline.                                                                                                              |
| **Print animation reset**    | `slides/02-content-and-media/40-quote.css`, `slides/03-components/30-chapter-title.css`      |     2 | `@media print` forcing `animation: none` on the quote's and the chapter title's animated `::before` gradients. Same must-beat-inline-animation shape, keyed on print/export.                                                                                                                 |
| **Video-layer mobile docks** | `base/04-editor-and-misc/72-video-layer.css` — `[data-mobile-position='bottom'/'top'/'pip']` |     9 | `left`/`top`/`width` for the three docks. `client/lib/slide-runtime/video-layer.js:169-171` writes `el.style.left/top/width` **inline** from the deck's position config; only `!important` beats that.                                                                                       |

## Cascade-patches — candidates to unwind (29)

Listed with what each one actually fights and what the fix looks like. **Inert**
means the selector already wins on specificity or source order, so removing the
keyword should change nothing — still worth a browser check, never a sweep.

### Inert — the `!important` is redundant (14)

| Where                                                                                                                         | Declaration(s)                           | Why it's redundant                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slides/03-components/50-presenter-layout.css` — the four `[data-slide-transition='cube']:not(.is-cube-animating)` idle rules | `transition`/`opacity`/`visibility` (×9) | They compete only with `.deck-slide` (0,1,0) and `.deck-slide.is-active` (0,2,0) and are themselves 0,3,0–0,4,0. The sibling `.is-cube-animating` block does the same job with no `!important` at all — that block is the proof. **Highest-risk item here**: 3D transitions, no regression net; unwind last and check the cube transition by hand. |
| `slides/03-components/50-presenter-layout.css` — `[data-slide-transition='cube'] .deck-slide.is-far`                          | `display: none`                          | Nothing else sets `display` on `.deck-slide`.                                                                                                                                                                                                                                                                                                      |
| `base/04-editor-and-misc/72-video-layer.css` — `[data-mobile-position='hidden']`                                              | `display: none`                          | Its only rival is `.video-layer[data-visible='false']` at equal specificity, earlier in the file; JS never sets `style.display`.                                                                                                                                                                                                                   |
| `base/01-core/10-shell-topbar-dropdown.css` — `@media (max-width: 768px) .topbar-save-status`                                 | `display: none`                          | Same specificity as the base `.topbar-save-status { display: inline-flex }` and later in source order.                                                                                                                                                                                                                                             |
| `base/01-core/20-editor-layout.css` — `@media (min-width: 769px)` drawer rules                                                | `display: none` (×2)                     | `.slides-drawer-toggle` / `.slides-drawer-backdrop` get their `display` inside `@media (max-width: 768px)` — the two queries never both apply.                                                                                                                                                                                                     |

### Load-bearing — reshape the rival selector first (15)

| Where                                                                           | Declaration(s)                                       | What it fights, and the fix                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base/04-editor-and-misc/95-viewer-mode.css` — `.viewer-shell …`                | `display: block` / `display: none`                   | Loses to `.is-editor:not(.is-slides-expanded-override) …` in `20-editor-layout.css` (0,5,0 vs 0,4,0). Fix: exclude the viewer shell from the editor's collapse rules instead.       |
| `slides/03-components/51-presenter-console.css` — `html.is-fullscreen …`        | `display: none`                                      | Loses to `.presenter-shell.is-console .presenter-console`. Fix: add the fullscreen negation to that rule.                                                                           |
| `base/04-editor-and-misc/105-inline-edit.css` — `.thumb.is-ie-dragging …`       | `opacity: 0`                                         | Loses to the `.thumb.is-inline-edit:hover …` reveal rules (one class more). Fix: `:not(.is-ie-dragging)` on the hover selectors.                                                    |
| `base/04-editor-and-misc/85-settings.css` — `.app-shell.settings-page`          | `display: grid`, `flex-direction: unset`             | Overrides `.app-shell { display: flex }`; the extra class already out-specifies it. `flex-direction: unset` is additionally **inert under `display: grid`** and removable outright. |
| `base/04-editor-and-misc/85-settings.css` — `.settings-page > .settings-topbar` | `position: relative`                                 | Overrides a sticky/fixed topbar base; check whether the child combinator already wins.                                                                                              |
| `base/04-editor-and-misc/100-analytics.css` — `.analytics-date-input`           | `font-size: 12px`, `padding: 6px 8px`                | Specificity fight with the base `input` rule. Fix: scope the base rule or raise the component's.                                                                                    |
| `base/04-editor-and-misc/89-slide-type-editor.css` — `.code-textarea`           | `font-family`, `font-size: 13px`, `line-height: 1.5` | Forcing monospace over the base `textarea` font. Same shape as the analytics one.                                                                                                   |
| `base/03-controls-and-forms.css` — `.danger`                                    | `border-color`                                       | A bare state class overriding component borders. A component-scoped `.danger` would win without it.                                                                                 |
| `app/components.css` — `.csv-grid-td-actions`, `.csv-grid-th-actions`           | `border-right: none` (×2)                            | Cells inherit borders from `.csv-grid td` / `th`; a more specific selector wins without `!important`.                                                                               |

## The comments that only mention the keyword (3)

`base/02-lists-and-thumbs/35-slide-visibility.css`,
`base/04-editor-and-misc/10-modals-base.css` and
`slides/01-layout-and-title/00-base.css` mention `!important` in prose. The
modals-base one records that the `.ps-modal-close` stroke/fill patch **is gone**
— the close X became a masked `icon()` span, so injected slide SVG rules can no
longer reach it. They are not in the count above.
