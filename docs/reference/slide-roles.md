# Slide roles — the token vocabulary for slide CSS

**Normative target, decided 2026-08-03.** This document describes the single
vocabulary slide CSS is converging on. Implementation status, honestly: the
tokens below all exist in `client/styles/slides/00-tokens.css`, but adoption in
the slide stylesheets is partial (16–53% per axis at the 2026-08-03 census) and
the legacy alias families listed at the bottom still have live consumers. The
gate that ratchets adoption up is `tests/slide-css-tokens.test.js`; the sweep
that raises it is tracked in the planning repo (`css-role-vocabulary.md`).

## The system

```
theme (--t-*, the contract)
   │  read exclusively in client/styles/slides/00-tokens.css
   ▼
slide roles (--slide-*, the vocabulary)
   │  the only thing slide CSS may use on the axes below
   ▼
slide CSS (types compose roles; literals only on the allowlist)
```

One direction, one contract file. `00-tokens.css` is the seam: every theme
lever enters there and nowhere else, and slide stylesheets speak `--slide-*`
only. Radius has worked this way from the start and is the model:
`--slide-radius-md: var(--t-radius, 18px)` — slide role and theme lever cleanly
separated.

Two consequences, both machine-checkable once the sweep lands:

- **A theme is complete without knowing the type catalogue.** The theme
  contract is exactly the set of `--t-*` tokens `00-tokens.css` reads.
- **A new slide type cannot introduce a theme dependency** without touching the
  contract file, which makes it a deliberate, reviewable diff.

## Typography roles

The 10-step size scale (`--slide-text-xs` … `--slide-text-5xl`, ~1.25 ratio)
and the KPI display sizes carry the values; roles bind meaning to a step:

| Role | Token | Bound to |
| --- | --- | --- |
| Title | `--slide-font-size-title` | `--slide-text-4xl` |
| Heading | `--slide-font-size-heading` | `--slide-text-2xl` |
| Subheading | `--slide-font-size-subheading` | `--slide-text-lg` |
| Body | `--slide-font-size-body` | `--slide-text-base` |
| Caption | `--slide-font-size-caption` | `--slide-text-sm` |
| Label | `--slide-font-size-label` | `--slide-text-xs` |
| Card title | `--slide-font-size-card-title` | `--slide-text-md` |
| Card body | `--slide-font-size-card-body` | `--slide-text-sm` |

The card bindings are the starting anchors for the card pattern (the census
found 91 unique card sizes spread across types); they get their carriers during
the sweep and may be re-anchored there — the *role* is the stable part.

Leading uses the five-step scale: `tight` 1.1 · `snug` 1.2 · `compact` 1.25 ·
`normal` 1.35 · `relaxed` 1.5. The `compact` step exists because the census
found a real 1.25 rhythm (18 declarations) in card titles and dense description
text — the same "the scale should carry what exists" reasoning that gave the
app spacing scale its fine band (`css-tokens.md` § *Why the fine band exists*).

### One word list, two projections

`TEXT_ROLES` in `shared/slide-types/text-roles.js` (the affordance model: which
style controls a field offers) and the size roles above (which size a role
renders) are **one vocabulary with two projections**, not two role systems. The
size layer is finer-grained where the affordance layer does not need to be:

| Affordance role (`TEXT_ROLES`) | Size role(s) |
| --- | --- |
| `heading` | title / heading / subheading (the affordance layer does not distinguish levels) |
| `prose` | body |
| `list-item` | body (marker-anchored; alignment is the axis that differs, not size) |
| `quote` | type-scaled display (quote-slide's own scaling; allowlisted) |
| `caption` | caption |
| `label` | label |

## Spacing roles

The 10-step scale (`--slide-space-1` … `--slide-space-16`, 8px base) carries
the values. Roles: `--slide-padding`, `--slide-header-gap`,
`--slide-section-gap`, `--slide-card-gap`, `--slide-card-padding`,
`--slide-item-gap`, `--slide-text-gap`.

**Composites write every length as a token** —
`padding: var(--slide-space-4) var(--slide-space-6)`, never a token beside a
raw length. This is the same conversion rule as the app layer
(`css-tokens.md` § *Migrating hardcoded px*): convert a declaration only when
*every* length in it lands on the scale, so the change is value-identical by
construction and reviewable by reading.

## Colour roles

The role list; today's spellings fold into the `--slide-*` family during the
theme-decoupling phase of the sweep:

| Role | Exists today as |
| --- | --- |
| `surface` | `--t-color-background` |
| `surface-raised` | `--slide-surface-white(-solid)`, per-type card/table backgrounds |
| `on-surface` / `on-surface-muted` | `--color-text` / `--color-text-muted` (alias layer in `theme.css`) |
| `accent` / `on-accent` | `--t-color-accent` / `--t-color-accent-contrast` (derived) |
| `border` | `--slide-border-*` (opacity-derived) |
| `emphasis` | table header/first-column planes, kickers |
| series palette | `--t-chart-{0..7}` (numbered accent colours; the only series palette) |

The contextual rebinding mechanism in `00-patterns.css` (a surface class
rebinds the text role for everything inside it) is correct and stays, including
the contrast derivation in `theme-normalize.js` — only the spelling changes.

## Radius, shadow, opacity

Already on the model: `--slide-radius-*` → `--t-radius*`, `--slide-shadow-*` →
`--t-shadow-scale`, and the opacity scale is slide-internal. Slide CSS goes
through the `--slide-*` role, never `var(--t-…)` directly.

## The theme seam

What a theme may set — the full contract, ~30–35 tokens, zero type names:

- **Colour**: the role list above, the `--t-slide-bg-*` surface variants,
  `--t-chart-{0..7}`, `--t-color-brand-{1..3}`, link colour.
- **Typography**: `--t-font-{heading,body,caption,mono}`,
  `--t-heading-{weight,transform,letter-spacing}`, and the scale multiplier
  `--t-slide-text-scale` (contract point; multiplier not yet implemented).
  **No per-role px sizes for themes** — that would re-couple every theme to
  every role.
- **Spacing**: `--t-slide-space-scale` (same model, same status).
- **Radius**: `--t-radius{,-sm,-lg}`. **Shadow**: `--t-shadow-scale`.
- **Layout/branding**: `--t-logo-url`, gradient tokens, title layout.

Per-type `--t-<type>-*` tokens (icon-card-grid, per-KPI-tile, table, quote and
chapter families) are **removed, not aliased** — the KPI tiles join the
`--t-chart-*` series palette, table planes reduce to surface/emphasis roles.
This is a deliberate breaking change during beta (see `versioning.md` § *The
beta stance*): a theme that sets a removed token does not break — unknown
tokens do nothing — but the deck renders with role-derived styling instead;
the release notes name each family.

## Markdown output is styled per surface

Decided 2026-08-03 (the batch 2.1 review found the seam). `shared/markdown.js`
emits the same `md-*` classes on every surface that renders markdown, but the
surfaces do not share a vocabulary — so they do not share rules either:

- **Slide canvas** — `client/styles/slides/01-layout-and-title/32-markdown-and-actions.css`
  scopes every `md-*` rule under `.slide` and speaks `--slide-*` only. Inside
  `.slide` the tokens always resolve (they are defined on that scope in
  `00-tokens.css`), the code palette stays theme-overridable per deck, and the
  rules no longer leak into app chrome.
- **App chrome** (speaker-notes view, presenter console) — one shared block in
  `client/styles/base/04-editor-and-misc/60-notes.css`, keyed on the
  `.notes-body` class, speaking `--ps-*`/`--app-*`. Both chrome containers
  carry the class; a new chrome surface that renders markdown opts in the same
  way. Prism and KaTeX only run on slide roots (`slide-render.js`,
  `server/utils/prism-katex.js`), so chrome shows code and math as plain
  source text and styles it as such — there is no second copy of the syntax
  palette.

No fallback values bridge the two surfaces: a rule that needs a token it
cannot reach is on the wrong surface, not a candidate for a `var(…, literal)`
double.

## The allowlist

Values outside the scales are allowed **per category with a reason**, not per
occurrence:

- `50%` and corner composites on `border-radius` (circles and asymmetric
  corners are shapes, not scale steps);
- `line-height: 1` and below on **single-line display glyphs** — a numeral in
  a circle badge, a KPI figure, an arrow, the countdown digits. There the line
  box *is* the layout: raising it to `tight` decentres the badge. The leading
  steps describe text rhythm, and these carriers have none. Marked in place
  with an `allowlist:` comment;
- the `--tf-size-scale` expressions of the text-style controls;
- em-based micro-typography (letter-spacing-relative sizing);
- private locals as readability aliases (`--team-gap-x`) — allowed only when
  they resolve to a token; a local introducing a new literal counts as a
  literal.

## What disappears

Legacy alias families with live consumers today; the sweep migrates the
consumers and then deletes the family. None of these is a valid spelling for
new code:

1. ~~`--font-size-title/subtitle/heading/body` + `--line-height-body`~~ —
   **done** (batch 2.2a): consumers migrated, family deleted from `theme.css`;
2. the `--color-*` spelling of the text-colour alias layer (becomes
   `--slide-*`);
3. the five `--t-*` legacy aliases (`--t-primary`, `--t-accent`,
   `--t-bg-dark`, `--t-brand-1/2`);
4. ~~direct `var(--t-radius…)` reads in slide CSS~~ — **done** (batch 2.2a):
   all reads go through `--slide-radius-*`.

## Enforcement

`tests/slide-css-tokens.test.js` — a value that exactly equals a slide token
must be written as that token, per-file burndown budgets that only go down.
Presenter chrome inside the slide bundle is excluded by file, with the reason
in the test.

The same file carries the first slice of the end-state contract check: **no
`var(--t-radius…)` anywhere in the slide bundle outside `00-tokens.css`**. That
became true in batch 2.2a and is asserted from batch 2.3a on, so the direct
path cannot reopen. Colour and typography still have direct reads; phase 3
widens the check to all of `--t-*` and adds the seam table as a snapshot.
