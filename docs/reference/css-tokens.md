# CSS design tokens (app chrome)

Deckyard's app UI is built on a small set of named scales in
**`client/styles/shared/ui-tokens.css`**: spacing, z-index, typography, radius,
transitions, and the `--app-*` colour tokens. This document covers the two that
have a rule attached — **spacing** and **z-index** — and the one trap that makes
a token silently resolve to nothing.

For the breakpoint ladder, see [CSS breakpoints](css-breakpoints.md). For slide
_theme_ variables (`--t-*`), see [Theme config](theme-config.md) — those are a
different system on purpose, and `ui-tokens.css` must never depend on them.

## Scope: app chrome, not slides

These tokens style the application around the deck: the editor, the topbar,
panels, modals, the analytics view. They are deliberately **not** available to
slide rendering. A slide's spacing comes from its own `--slide-*` variables, so
that a slide renders identically whether it is on screen, in a PDF, or in an
agent's preview — none of which share the app's chrome.

> **The trap.** `client/styles/slides.css` does **not** import `ui-tokens.css`.
> In a browser you will not notice, because the editor loads `app.css` and
> `slides.css` together and the token resolves anyway. But
> `server/mcp/preview.js` bundles `slides.css` _alone_ (deliberately — skipping
> `app.css` saves ~458KB), so a `var(--ps-*)` or `var(--z-*)` written inside
> `client/styles/slides/**` resolves to **nothing** there, with no error.
>
> This is the only such consumer: the HTML/PNG/PDF export goes through
> `client/styles/export.css` (`server/export/css-bundle.js`), which imports
> `ui-tokens.css` directly — as does the embed shell's `embed.css`.
>
> So: **do not put `--ps-*` or `--z-*` inside `client/styles/slides/**`.** If you
> need to, fix the bundle first (import `ui-tokens.css` from `slides.css`, or add
> it to the preview bundle), then migrate. One fix unblocks both scales.

## Spacing — two resolutions

Tokens are named after their multiple of 4px, so `-3` is 12px and the
half-steps land between two ticks: `-2-5` is 10px. The root element sets no
`font-size`, so `1rem = 16px` and each token is exactly the pixel value in its
name.

**Up to 20px the scale ticks every 2px. Above 20px it ticks every 4px.**

| Token            | Value    | px  |     | Token           | Value   | px  |
| ---------------- | -------- | --- | --- | --------------- | ------- | --- |
| `--ps-space-0-5` | 0.125rem | 2   |     | `--ps-space-6`  | 1.5rem  | 24  |
| `--ps-space-1`   | 0.25rem  | 4   |     | `--ps-space-7`  | 1.75rem | 28  |
| `--ps-space-1-5` | 0.375rem | 6   |     | `--ps-space-8`  | 2rem    | 32  |
| `--ps-space-2`   | 0.5rem   | 8   |     | `--ps-space-9`  | 2.25rem | 36  |
| `--ps-space-2-5` | 0.625rem | 10  |     | `--ps-space-10` | 2.5rem  | 40  |
| `--ps-space-3`   | 0.75rem  | 12  |     | `--ps-space-12` | 3rem    | 48  |
| `--ps-space-3-5` | 0.875rem | 14  |     | `--ps-space-15` | 3.75rem | 60  |
| `--ps-space-4`   | 1rem     | 16  |     |                 |         |     |
| `--ps-space-4-5` | 1.125rem | 18  |     |                 |         |     |
| `--ps-space-5`   | 1.25rem  | 20  |     |                 |         |     |

> **Squint at the half-steps.** `--ps-space-1-5` is the **half-step** between
> `-1` and `-2` — 6px. `--ps-space-15` is **fifteen ticks** — 60px. The two are
> one hyphen apart and ten times apart in value. The naming is the
> Tailwind-familiar idiom and stays, but it is a genuine lookalike hazard: when
> reviewing a spacing diff, read the whole token name before nodding.

There is no `-11` (44px), `-13` (52px) or `-14` (56px): not one
`margin`/`padding`/`gap` in scope uses those values, and the scale should carry
what exists rather than what might. The upper additions that _did_ earn a token
are 28px (6 uses), 36px (2) and 60px (1).

### Why the fine band exists

The scale was 4px-only until 2026-08-02, and the app did not obey it. A census
of `client/styles/**` found **683 loose px values** beside the tokens, of which
**587 (86%) were even but not multiples of 4** — 2, 6, 10, 14, 18 — and **27 of
57 substantial sheets sat ≥60% off-scale**.

That is not drift in a few files. The dense UI was drawn on a **2px rhythm**,
and the 4px scale simply did not describe it. Both alternatives were weighed and
rejected:

- **Rounding the 587 values to the 4px grid** needs a visual judgement per case.
  That is a redesign of the dense surfaces, not a conversion, and it cannot be
  reviewed by reading a diff.
- **Declaring them permanently off-scale** is a second spacing regime over half
  the app, forever.

So the scale was refined to match the rhythm that exists. Above 20px the
resolution genuinely is not needed, which is why the fine band stops there — the
handful of 22/26/30px values up there do get rounded during conversion.

The slide layer faced the same near-miss question and resolved it the same
way on 2026-08-03: snap to the scale, except where the census shows a real
rhythm — which earned the slide leading scale its `compact` (1.25) step. See
`slide-roles.md`.

Use the no-fallback form — `var(--ps-space-3)`, not
`var(--ps-space-3, 12px)`. A fallback would let the trap above pass silently.

### Migrating hardcoded px onto the scale

Existing CSS is being moved onto the scale file by file, not in one sweep. The
rule below is what makes such a change reviewable by reading it, rather than by
opening a browser:

> **Convert a declaration only when _every_ length in it lands on the scale.**
> If any value is off-scale (3, 5, 7, 13, 22px) or the declaration carries
> `!important`, leave the whole declaration alone.

This holds for `rem` spellings too: `padding: 0.625rem 0.75rem` is 10px and 12px
and converts to `var(--ps-space-2-5) var(--ps-space-3)`. A token value written
in `rem` is not a second legal form — it is the same violation in a different
alphabet, and the gate counts it as one.

The point is that **no declaration ever mixes a raw length and a token**. A reviewer
can then verify the change is behaviour-preserving from the table above, without
judging pixels by eye. Applied this way the conversion is value-identical by
construction.

Two consequences worth knowing before you start:

- **Negative values and `0` stay literal.** The scale has no negative members.
  Watch for pairs — a `margin: -8px` that bleeds out and a `padding: 8px` that
  pads back in belong together; tokenising only one half means a later change to
  the scale breaks the pairing. A declaration carrying a negative length is
  therefore left alone **as a whole**: in `margin: -6px 12px` the `12px` stays
  literal too. The gate skips such declarations for the same reason, so those
  lengths are invisible to it — the deliberate cost of not asking for a
  conversion the rule forbids.
- **A high skip-rate is a finding, not leftover work.** When a file's spacing was
  never designed against a grid, most declarations will fail the rule. That
  signal is what produced the fine band: the 6/10/14px rhythm in
  `75-share-viewer.css` and `92-comments-panel.css` turned out to be the app's
  rhythm, not those files' quirk, so the honest response was a design decision
  about the scale — not a looser conversion rule. Values the scale still does
  not carry (13, 22, 30px) stay literal.

### The gate

`tests/css-spacing-tokens.test.js` enforces exactly one thing:

> **A spacing length that exactly equals a token must be written as that token.**

Not "every value must be on the scale" — an off-scale value is a design signal
and is not counted. Only the value-identical case is caught, so a failure is
always something a reviewer can fix by reading.

Scope is `client/styles/**` minus `slides/**` (the trap above) and
`cookie-consent.css` (parked). It looks at the `margin` / `padding` / `gap`
families only, in **both** the `px` and the `rem` spelling. Skipped, per the
rule above: `!important` declarations, `0`, and any declaration that contains a
negative length.

`var(…)` expressions are stripped from a value rather than excusing it, so a
half-converted `padding: 2px var(--ps-space-2)` is still caught — mixing a raw
length and a token in one declaration is exactly what the rule forbids.

The values that already existed when the gate landed are recorded as
per-file counts in **`css-spacing-suppressions.json`**, mirroring
`eslint-suppressions.json`. A count may only go **down**: a file with a budget
still fails if it grows a new violation, and a file that converts some of its
values fails until the number is lowered. After a conversion batch:

```sh
UPDATE_CSS_SPACING_SUPPRESSIONS=1 node --test tests/css-spacing-tokens.test.js
```

Never raise a budget to make the gate pass.

## Z-index — named stacking tiers

Seventeen tiers, so cross-component overlap has one source of truth instead of
scattered magic numbers. The full list with per-tier intent lives in
`ui-tokens.css` itself; the shape is:

| Band        | Tiers                                         | For                                                |
| ----------- | --------------------------------------------- | -------------------------------------------------- |
| In-flow     | `--z-behind` (-1) → `--z-raised` (10)         | decorative layers, lifted siblings                 |
| Chrome      | `--z-sticky` (50) → `--z-drawer` (200)        | sticky bars, nav, headers, drawers                 |
| Overlay     | `--z-overlay` (1000) → `--z-toast` (1200)     | modal backdrops, dialogs, banners, toasts          |
| Full-screen | `--z-loading` (2000) → `--z-skip-link` (5000) | veils, lightboxes, the consent gate, the skip-link |
| Ceiling     | `--z-drag` (999999)                           | the drag ghost                                     |

Rules:

- **Reach for the nearest tier; do not invent a value.** If two things must sit
  within one tier, order them with the token plus a small offset:
  `calc(var(--z-header) + 1)`.
- **Local sibling ordering stays plain integers.** `z-index: 0/1/2` _inside_ one
  component's own stacking context — a slide's background/content/overlay layers,
  a card, a thumbnail — is not an app layer and deliberately does not use this
  scale. Roughly 108 such values exist and are correct as they are.
- **The top of the scale is ordered by obligation, not by importance.** The
  WCAG skip-link sits above the cookie-consent gate on purpose: a keyboard user
  must be able to escape a modal legal gate.

## Typography — a fixed 6-step scale

Six named font sizes, plus `--ps-font-sans` / `--ps-font-mono`. Because the root
element is `16px` and `rem` is always root-relative, each token equals a fixed
pixel value regardless of nesting — so a raw `font-size` and its token are
value-identical:

| Token            | Value     | px  |
| ---------------- | --------- | --- |
| `--ps-text-xs`   | 0.6875rem | 11  |
| `--ps-text-sm`   | 0.8125rem | 13  |
| `--ps-text-base` | 0.875rem  | 14  |
| `--ps-text-lg`   | 1rem      | 16  |
| `--ps-text-xl`   | 1.125rem  | 18  |
| `--ps-text-2xl`  | 1.375rem  | 22  |

### Migrating hardcoded font-size onto the scale

The same rule as spacing: **convert a `font-size` only when its value lands
exactly on the scale** (11/13/14/16/18/22px or the `rem` equivalent). Leave
everything else literal — `!important` declarations, `em`/unitless/`%` sizes, and
off-scale px (10, 12, 15, 20, 24, 26, 28…). A high skip-rate is the same finding
as with spacing: those files were sized against a rhythm the 6-step scale does
not carry, and closing that gap is a design decision, not a conversion.

Two things stay literal by construction:

- **The root anchor.** `html { font-size: 16px }` defines what `1rem` _is_;
  tokenising it to `var(--ps-text-lg)` would be circular. It stays `16px`.
- **`slides/**` and parked stylesheets.** Same trap as spacing — a `--ps-text-*`
  inside `client/styles/slides/**` resolves to nothing in the MCP preview bundle.
  `cookie-consent.css` is parked (not in the load path), so it is left alone too.

## Where the other tokens are

The remaining scales in `ui-tokens.css` carry no migration rule and are used
directly:

- **Radius** — `--ps-radius-sm` … `--ps-radius-2xl`, `--ps-radius-full`.
- **Transitions** — `--ps-transition-fast` / `-normal` / `-slow`.
- **Colour** — the `--app-*` tokens, defined for light mode on `:root` and
  overridden under `:root[data-ui-mode='dark']`. Note there is deliberately no
  plain `--app-accent`: accent comes in three non-interchangeable flavours
  (`-primary` paints shapes, `-text` lightens in dark mode, `-soft` is a tinted
  surface).
- **Layout constants** — `--ps-topbar-height`, the slides-rail widths, and the
  editor column max-widths.
