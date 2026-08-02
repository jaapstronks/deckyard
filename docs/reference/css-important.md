# `!important` inventory (app CSS)

> The CSS scales — spacing, z-index, typography, breakpoints — live in
> [CSS design tokens](css-tokens.md) and [CSS breakpoints](css-breakpoints.md).
> This document is the companion audit of the other cascade smell: every
> `!important` under `client/styles/**`, sorted into the ones that are idiomatic
> and the ones that are patches worth unwinding.

There are **91 `!important` declarations** across `client/styles/**` (plus two
comments that merely mention the keyword). **77 are `!important`-by-design** —
utilities, the screen-reader pattern, motion resets, and JS-driven state
machines that must beat animated base styles. **14 are cascade-patches**: a rule
reaching for `!important` to win a specificity fight it could win by other means.

This split is the point of the audit. Removing an `!important` changes what wins
the cascade, and Deckyard has no visual-regression net over most of this UI, so
each cascade-patch is unwound **one at a time, verified in a browser** — not in a
sweep. The by-design ones are catalogued here so a future reader does not mistake
them for patches and "clean them up".

## By-design — leave these (77)

| Family | Where | Count | Why `!important` is correct |
|---|---|---:|---|
| **Utility classes** | `base/01-core/90-utilities.css` | 28 | A utility (`.hidden`, `.mx-auto`, `.flex`, `.truncate`) exists precisely to override component styles at the call site. This is the one place `!important` is the design. |
| **Screen-reader only** | `slides/03-components/60-accessibility.css` | 9 | The canonical `.sr-only` visually-hidden block. Each of its nine declarations is `!important` so no component can accidentally reveal or reflow it. |
| **Reduced-motion resets** | `82-auto-advance`, `30-chapter-title`, `10-payoff`, `52-morph-transition`, `50-presenter-layout` | 9 | `@media (prefers-reduced-motion: reduce)` forcing `animation/transition/transform: none`. Must beat keyframe and inline animation — the WCAG-recommended shape. |
| **Print animation reset** | `40-quote` | 1 | `@media print` forcing `animation: none` on the quote's animated gradient — same must-beat-keyframe shape as the reduced-motion family, but keyed on print/export. |
| **Cube-transition state machine** | `slides/03-components/50-presenter-layout.css` | 10 | The 3D cube transition hard-hides non-active faces (`opacity/visibility/display`) against live `transform` states. JS drives `.is-active`/`.is-next`/`.is-cube-animating`; `!important` enforces the state over the animation. |
| **Video-layer mobile docks** | `base/04-editor-and-misc/72-video-layer.css` | 10 | `[data-mobile-position="…"]` forcing `fixed` position/width for bottom/top/pip/hidden docks over the desktop base. State selected by attribute, enforced with `!important`. |
| **`[hidden]` / collapse toggles** | `17-lead-capture`, `51-presenter-console`, `95-viewer-mode`, `20-editor-layout`, `10-shell-topbar-dropdown`, `105-inline-edit` | 8 | `display:none`/`display:block` that must win over responsive-collapse or slide CSS — e.g. `[hidden]{display:none}` beating a slide rule, hiding the drawer toggle on desktop, blanking drag-ghost overlays. |
| **Modal-icon injection defense** | `base/04-editor-and-misc/10-modals-base.css` | 2 | `.ps-modal-close svg path { stroke/fill !important }`, commented "always visible even if slide CSS injects global SVG rules". Guards app chrome against slide-CSS bleed. |

## Cascade-patches — candidates to unwind (14)

Each of these wins a fight it should not need `!important` for. Listed with the
direction of the fix; none are done here because each needs a browser check.

| File:line | Declaration | Note |
|---|---|---|
| `85-settings.css:9` | `display: grid !important` | Overrides the base `.app-shell { display:flex }`. A `.app-shell.settings-page` selector already out-specifies it — the `!important` is redundant with the extra class. |
| `85-settings.css:10` | `flex-direction: unset !important` | **Inert** under `display: grid` (flex-direction does nothing on a grid container). Removable with no visual change. |
| `85-settings.css:23` | `position: relative !important` | Overrides a sticky/fixed topbar base; check whether the `.settings-page >` selector already wins. |
| `86-settings-api-keys.css:238` | `max-width: 520px !important` | Widens a specific modal. Overriding `.ps-modal` default max-width — a modal-size modifier class would carry it without `!important`. |
| `86-settings-api-keys.css:298` | `max-width: 560px !important` | Same pattern, usage modal. |
| `100-analytics.css:575` | `font-size: 12px !important` | `.analytics-date-input` overriding the global input font. Specificity fight with a base `input` rule. |
| `100-analytics.css:576` | `padding: 6px 8px !important` | Same rule as above. |
| `89-slide-type-editor.css:299` | `font-family: … !important` | `.code-textarea` forcing monospace over the base textarea font. |
| `89-slide-type-editor.css:300` | `font-size: 13px !important` | Same rule. |
| `89-slide-type-editor.css:301` | `line-height: 1.5 !important` | Same rule. |
| `03-controls-and-forms.css:814` | `grid-template-columns: 1fr !important` | `.editor-title-row` forcing single column. Carries a comment explaining the intent; the `!important` guards against a responsive grid rule elsewhere — verify that rule still exists before removing. |
| `03-controls-and-forms.css:937` | `border-color: … !important` | `.danger` — a state class overriding a component border. A component-scoped `.danger` selector would win without it. |
| `app/components.css:307` | `border-right: none !important` | `.csv-grid-td-actions` removing a cell border. Table cells inherit borders from `.csv-grid td` — a more specific selector wins without `!important`. |
| `app/components.css:325` | `border-right: none !important` | `.csv-grid-th-actions`, same pattern. |

## The one comment worth keeping honest

`base/02-lists-and-thumbs/35-slide-visibility.css:121` and
`slides/01-layout-and-title/00-base.css:246` mention `!important` in comments but
carry no `!important` declaration. They are not in the count above.
