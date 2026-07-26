# CSS design tokens (app chrome)

Deckyard's app UI is built on a small set of named scales in
**`client/styles/shared/ui-tokens.css`**: spacing, z-index, typography, radius,
transitions, and the `--app-*` colour tokens. This document covers the two that
have a rule attached — **spacing** and **z-index** — and the one trap that makes
a token silently resolve to nothing.

For the breakpoint ladder, see [CSS breakpoints](css-breakpoints.md). For slide
*theme* variables (`--t-*`), see [Theme config](theme-config.md) — those are a
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
> `server/mcp/preview.js` bundles `slides.css` *alone* (deliberately — skipping
> `app.css` saves ~458KB), so a `var(--ps-*)` or `var(--z-*)` written inside
> `client/styles/slides/**` resolves to **nothing** there, with no error.
>
> This is the only such consumer: the HTML/PNG/PDF export
> (`server/export/css-bundle.js`) loads `app.css` too, and the embed shell goes
> through `embed.css`, which imports the tokens directly.
>
> So: **do not put `--ps-*` or `--z-*` inside `client/styles/slides/**`.** If you
> need to, fix the bundle first (import `ui-tokens.css` from `slides.css`, or add
> it to the preview bundle), then migrate. One fix unblocks both scales.

## Spacing — a 4px scale

Nine steps, named after their multiple of 4. The root element sets no
`font-size`, so `1rem = 16px` and each token is exactly the pixel value in its
name.

| Token | Value | px |
|---|---|---|
| `--ps-space-1` | 0.25rem | 4 |
| `--ps-space-2` | 0.5rem | 8 |
| `--ps-space-3` | 0.75rem | 12 |
| `--ps-space-4` | 1rem | 16 |
| `--ps-space-5` | 1.25rem | 20 |
| `--ps-space-6` | 1.5rem | 24 |
| `--ps-space-8` | 2rem | 32 |
| `--ps-space-10` | 2.5rem | 40 |
| `--ps-space-12` | 3rem | 48 |

Note the gaps: there is no `-7`, `-9` or `-11`. The scale thins out as it grows,
because large spacing does not need 4px resolution.

Use the no-fallback form — `var(--ps-space-3)`, not
`var(--ps-space-3, 12px)`. A fallback would let the trap above pass silently.

### Migrating hardcoded px onto the scale

Existing CSS is being moved onto the scale file by file, not in one sweep. The
rule below is what makes such a change reviewable by reading it, rather than by
opening a browser:

> **Convert a declaration only when *every* length in it lands on the scale.**
> If any value is off-scale (2, 6, 10, 14, 60px) or the declaration carries
> `!important`, leave the whole declaration alone.

The point is that **no declaration ever mixes a raw px and a token**. A reviewer
can then verify the change is behaviour-preserving from the table above, without
judging pixels by eye. Applied this way the conversion is value-identical by
construction.

Two consequences worth knowing before you start:

- **Negative values and `0` stay literal.** The scale has no negative members.
  Watch for pairs — a `margin: -8px` that bleeds out and a `padding: 8px` that
  pads back in belong together; tokenising only one half means a later change to
  the scale breaks the pairing.
- **A high skip-rate is a finding, not leftover work.** When a file's spacing was
  never designed against a grid, most declarations will fail the rule. In
  `100-analytics.css` 76 of 92 declarations converted; in `75-share-viewer.css`
  and `92-comments-panel.css` only 84 of 148, because those files are built on a
  6/10/14px rhythm that has no place on a 4px scale. That is a signal about the
  files, and the honest response is a design decision (refine the scale, or
  declare those values deliberately off-scale) — not a looser conversion rule.

## Z-index — named stacking tiers

Fourteen tiers, so cross-component overlap has one source of truth instead of
scattered magic numbers. The full list with per-tier intent lives in
`ui-tokens.css` itself; the shape is:

| Band | Tiers | For |
|---|---|---|
| In-flow | `--z-behind` (-1) → `--z-raised` (10) | decorative layers, lifted siblings |
| Chrome | `--z-sticky` (50) → `--z-drawer` (200) | sticky bars, nav, headers, drawers |
| Overlay | `--z-overlay` (1000) → `--z-toast` (1200) | modal backdrops, dialogs, banners, toasts |
| Full-screen | `--z-loading` (2000) → `--z-skip-link` (5000) | veils, lightboxes, the consent gate, the skip-link |
| Ceiling | `--z-drag` (999999) | the drag ghost |

Rules:

- **Reach for the nearest tier; do not invent a value.** If two things must sit
  within one tier, order them with the token plus a small offset:
  `calc(var(--z-header) + 1)`.
- **Local sibling ordering stays plain integers.** `z-index: 0/1/2` *inside* one
  component's own stacking context — a slide's background/content/overlay layers,
  a card, a thumbnail — is not an app layer and deliberately does not use this
  scale. Roughly 108 such values exist and are correct as they are.
- **The top of the scale is ordered by obligation, not by importance.** The
  WCAG skip-link sits above the cookie-consent gate on purpose: a keyboard user
  must be able to escape a modal legal gate.

## Where the other tokens are

The remaining scales in `ui-tokens.css` carry no migration rule and are used
directly:

- **Typography** — `--ps-text-xs` … `--ps-text-2xl`, plus `--ps-font-sans` /
  `--ps-font-mono`. Being moved onto tokens is still open work.
- **Radius** — `--ps-radius-sm` … `--ps-radius-2xl`, `--ps-radius-full`.
- **Transitions** — `--ps-transition-fast` / `-normal` / `-slow`.
- **Colour** — the `--app-*` tokens, defined for light mode on `:root` and
  overridden under `:root[data-ui-mode='dark']`. Note there is deliberately no
  plain `--app-accent`: accent comes in three non-interchangeable flavours
  (`-primary` paints shapes, `-text` lightens in dark mode, `-soft` is a tinted
  surface).
- **Layout constants** — `--ps-topbar-height`, the slides-rail widths, and the
  editor column max-widths.
