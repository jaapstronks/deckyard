# Slide roles — the token vocabulary for slide CSS

**Normative target, decided 2026-08-03.** This document describes the single
vocabulary slide CSS is converging on. Implementation status, honestly: the
tokens below all exist in `client/styles/slides/00-tokens.css`, and the four
geometry/typography axes — leading, radius, font-size and spacing — are done,
down to the private locals that feed them; the live figures are the per-file,
per-category budgets in `slide-css-suppressions.json`, currently empty. Colour is
done too: the colour roles carry the whole slide bundle, the per-type
`--t-<type>-*` families and the five `--t-*` legacy aliases are removed, and
the contract is machine-checked — no `var(--t-…)` outside `00-tokens.css`,
with the seam pinned as a snapshot (`tests/fixtures/theme-contract.json`).
The gate is `tests/slide-css-tokens.test.js`; history in the planning repo
(`css-role-vocabulary.md`).

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

## Snapping a value to the scale

Every axis below carries a step scale, and the census keeps finding values that
sit _between_ two steps. One rule decides where each of them lands, and it is
the same rule on every axis.

**A value between two steps goes to the step it is nearest in _ratio_, which at
an exact midpoint is always the larger one.** Absolute distance cannot break
that tie — the arithmetic midpoint is equidistant by definition — but the ratio
can, because a scale is read as a series of relative steps, and the arithmetic
midpoint always lies _above_ the ratio midpoint (the geometric mean) of the two
steps it sits between. So 10px between `--slide-space-2` (8) and
`--slide-space-3` (12) goes up (`12/10 = 1.2` against `10/8 = 1.25`), and 18px
between `--slide-text-sm` (16) and `--slide-text-base` (20) goes up for exactly
the same reason. One rule applied to a whole axis is what keeps the conversion
reviewable by reading instead of by argument.

**Below the floor there is no tie to break**, because there is no lower step to
weigh against. The question there is whether the value is a step at all, and the
same ratio answers it: within one low-end step of the smallest step (4/3 = 1.33)
it snaps, beyond it (a full doubling) it is a _sub-step hairline_ and goes on
the allowlist. On the spacing scale that puts the line between 3px, which
converts, and the 1–2px hairlines, which do not.

Snapping is what B4 decided; the app layer answered the same question
differently (`css-tokens.md` § _Why the fine band exists_) because 587 values
could not be visually reviewed one by one, and the slide axes are small enough
that they can.

### The two exceptions

Both are ordering constraints, and both are written as a comment at the
declaration that takes them. **Ordering is a constraint, the tie-break is a
preference**: where they disagree the constraint wins and the value takes the
_smaller_ step.

- **Ladder-rung ordering.** A density or responsive ladder — `[data-count]`,
  `[data-rows]`, `.is-compact`, `.has-bottom-subheading`, a `@media` tier, a
  variant that overrides a base rule — is an _ordered_ set: a rung exists to be
  a step below the rung above it. Where the ratio-larger step would land on or
  above that rung, the value takes the smaller step instead. The scale is
  coarser than the ad-hoc ladders it replaces, so two rungs sometimes merge onto
  one step; that is the honest outcome of putting the ladder on the scale, not a
  reason to keep the off-scale value.
- **Documented overflow.** A rung that exists because the content otherwise
  overflows the slide — the text-blocks 4-row tier, the dense process tiers —
  keeps the smaller step even where nothing collides, because growing it is the
  failure the tier was added to prevent. The comment names the overflow.

**Whether a base rule is a rung is a fact about the renderer**, not about the
stylesheet. Funnel, pyramid and cycle clamp their count to a range whose default
falls through to the base rule (`clampInt(stages.length, 3, 6, 4)`), so their
base _is_ the rung for that count and carries the ordering constraint. Process
clamps to 3–7 and gives every count an explicit rung, so its base rule never
renders and takes the plain rule.

**A snap that makes an override identical to the rule it overrides deletes the
override** — the restated value is a fossil of the off-scale pair, not a
decision. Two things are not fossils and stay: an overridden rule that is itself
a rung (collapsing two rungs into one declaration hides an ordering the next
change would have to rediscover), and an override that still _decides_ something
in the cascade, because a later rule of lower specificity — typically a `@media`
tier — would win once it is gone. Delete only after checking what moves up; the
process step titles are the worked example, where dropping two apparently
redundant rungs handed counts 3 and 4 to the responsive tier at 1024px.

## Typography roles

The 10-step size scale (`--slide-text-xs` … `--slide-text-5xl`, ~1.25 ratio)
and the KPI display sizes carry the values; roles bind meaning to a step:

| Role       | Token                          | Bound to            |
| ---------- | ------------------------------ | ------------------- |
| Title      | `--slide-font-size-title`      | `--slide-text-4xl`  |
| Heading    | `--slide-font-size-heading`    | `--slide-text-2xl`  |
| Subheading | `--slide-font-size-subheading` | `--slide-text-lg`   |
| Body       | `--slide-font-size-body`       | `--slide-text-base` |
| Caption    | `--slide-font-size-caption`    | `--slide-text-sm`   |
| Label      | `--slide-font-size-label`      | `--slide-text-xs`   |
| Card title | `--slide-font-size-card-title` | `--slide-text-md`   |
| Card body  | `--slide-font-size-card-body`  | `--slide-text-md`   |

The two card rows are the only _contextual_ roles: a card re-declares them for
its own density and the values above are what a card inherits when it declares
nothing. That, and which patterns count as cards, is the section below.

Leading uses the five-step scale: `tight` 1.1 · `snug` 1.2 · `compact` 1.25 ·
`normal` 1.35 · `relaxed` 1.5. The `compact` step exists because the census
found a real 1.25 rhythm (18 declarations) in card titles and dense description
text — the same "the scale should carry what exists" reasoning that gave the
app spacing scale its fine band (`css-tokens.md` § _Why the fine band exists_).

The size axis follows the shared tie-break above, and it is the axis where the
two exceptions actually bite: nearly every slide type sizes its text down a
density ladder, so a midpoint value is more often a rung than a free choice.
Where the ratio-larger step is refused, the reason is at the declaration —
`ladder rung: …` for an ordering constraint, `overflow: …` for a tier that
exists to make content fit.

### One word list, two projections

`TEXT_ROLES` in `shared/slide-types/text-roles.js` (the affordance model: which
style controls a field offers) and the size roles above (which size a role
renders) are **one vocabulary with two projections**, not two role systems. The
size layer is finer-grained where the affordance layer does not need to be:

| Affordance role (`TEXT_ROLES`) | Size role(s)                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `heading`                      | title / heading / subheading (the affordance layer does not distinguish levels) |
| `prose`                        | body                                                                            |
| `list-item`                    | body (marker-anchored; alignment is the axis that differs, not size)            |
| `quote`                        | type-scaled display (quote-slide's own scaling; allowlisted)                    |
| `caption`                      | caption                                                                         |
| `label`                        | label                                                                           |

## The card pattern

A **card** is a repeated content unit that carries a title and a body which
size _together_ as one block, in a box the grid and the content set. The three
card roles — `--slide-font-size-card-title`, `--slide-font-size-card-body`,
`--slide-card-padding` — are the whole vocabulary a card's parts may speak on
those axes.

The members, measured rather than declared: the icon-card (both layouts), the
text block, the team card, the timeline card, the matrix cell, the KPI tile and
the follow-invite card. Two neighbours look like members and are not, for the
same reason: **`.comparison-side` is a column**, not a box — no surface, and
its padding is the gutter between the two halves; **the gallery tile and the
logo-wall cell** carry media and a caption, not a title/body pair.

### The roles are contextual

A card's text size is a function of its density, and density is a property of
the _card_, not of the text inside it: six cards in a row are smaller than one,
whatever their titles say. So the card element sets the roles and its parts
read them —

```css
.slide-text-blocks .text-block {
  --slide-font-size-card-title: var(--slide-text-lg);
  --slide-font-size-card-body: var(--slide-text-md);
}
.slide-text-blocks .text-blocks-row[data-count='3'] .text-block {
  --slide-font-size-card-title: var(--slide-text-md);
  --slide-font-size-card-body: var(--slide-text-base);
}
.slide-text-blocks .text-block-title {
  font-size: var(--slide-font-size-card-title);
}
.slide-text-blocks .text-block-body {
  font-size: var(--slide-font-size-card-body);
}
```

— which makes each rung of a density ladder **one rule that names the density**
instead of a title rule plus a body rule that have to be kept in step by hand.
The parts name a size exactly once, at the top. A card that has a single
density declares nothing at all and reads the bindings from `00-tokens.css`;
`.sfi-card` in `15-follow-invite.css` is the live case.

`--slide-card-padding` carries the card's **whole** padding, one step or a
shorthand of steps (`var(--slide-space-6) var(--slide-space-8)`), because a
card's padding is one decision even when it is asymmetric — splitting it into a
block and an inline role would make two tokens out of one concept.

### Title and body are an ordered pair

There are two card text roles rather than one because **the title never sits
below the body**: `card-title` ≥ `card-body`, on every rung of every ladder.
That is the same ordering constraint the tie-break above describes, applied
within the card instead of down a ladder, so it is read the same way — where
the ratio-larger step would put the body on or above the title, the body takes
the smaller step. The KPI tile is the worked example: label and note were both
26px, the label snapped up to `lg` on the plain rule, and the note stays at
`md` because it hangs _from_ the label. Expressing that as
`card-title: lg` / `card-body: md` is why the note needs no exception comment —
the roles carry the ordering that a comment used to have to assert.

### What this does not settle

Every card pattern still runs its **own** density ladder: a matrix cell starts
at `xl` where a timeline card starts at `base`, and the census's 91 unique card
sizes are all still there, now named rather than reduced. One shared card
ladder — density N takes size S(N) across types — is the change that would
actually collapse that count, and it is a value change on every card, so it is
its own piece of work, not a side effect of naming.

The diagram families (process, funnel, pyramid, cycle) present the same
title/body-on-a-count-ladder shape and are deliberately left out: their ladders
were just ratified value-by-value under the tie-break, and folding them in means
re-opening that record rather than reading it.

`.slide-card` in `00-patterns.css` is **not** the base of this pattern — nothing
renders it (a dead-CSS candidate, tracked in the dead-code audit). Each card
pattern owns its own box.

## Spacing roles

The 10-step scale (`--slide-space-1` … `--slide-space-16`, 8px base) carries
the values. Roles: `--slide-padding`, `--slide-header-gap`,
`--slide-section-gap`, `--slide-card-gap`, `--slide-card-padding`,
`--slide-item-gap`, `--slide-text-gap`.

**Composites write every length as a token** —
`padding: var(--slide-space-4) var(--slide-space-6)`, never a token beside a
raw length. This is the same conversion rule as the app layer
(`css-tokens.md` § _Migrating hardcoded px_): convert a declaration only when
_every_ length in it lands on the scale, so the change is value-identical by
construction and reviewable by reading.

The axis follows the shared tie-break above. The scale ticks by 4px below 24, so
the near-misses the census found are the odd 2px offsets — 6, 10, 14, 18, 22 —
and every one of them sits exactly between two steps, which is why one rule had
to decide all of them.

**A negative offset is on the scale too**, written as
`margin-top: calc(-1 * var(--slide-space-3))`. The gate skips declarations
carrying a negative length — tokenising only the positive half of a pull-up /
gap pair puts the pair out of step — so the negated form is the way to convert
one anyway, and only when its positive counterpart converts in the same step.

**A composite that snaps to one repeated step collapses to that step.** Once
`padding: 32px 34px` becomes `var(--slide-space-8) var(--slide-space-8)`, the
second value is a fossil of the off-scale pair, not a decision — write
`padding: var(--slide-space-8)`.

Lengths that are _not_ spacing stay out of this axis by definition: `inset`
(`left`/`bottom` on an absolutely-positioned caption), `width`/`height`, and
custom properties that feed them (`--marker-size`). A 20px inset and a 20px gap
are not the same concept even when the number matches.

**The scale carries two steps wider than the slide padding**,
`--slide-space-20` (80px) and `--slide-space-24` (96px). They exist because
`--slide-space-16` is _the slide padding_: anything that has to read as wider
than the frame — a title slide's gutter, the gap that separates two card
groups from the gap inside one — had nowhere on the scale to land, and
answering that with an allowlist category would have exempted the one place
where "wider than the padding" is a deliberate design step rather than drift.
Both continue the ratio band of the steps below them (64→80 is 1.25, 80→96 is
1.2, against 32→40→48 at 1.25 and 1.2), so they are the scale's own next
values, not new numbers.

The axis is closed at both layers. Every `margin`/`padding`/`gap`
**declaration** in the slide bundle is on the scale or on the allowlist, and so
is the layer below it: the private spacing locals (`--team-gap-x/y`,
`--lw-gap-x/y`, `--timeline-gap`, `--tsu-pad-*`, `--split-gap`) that feed those
declarations through a `var()`. The gate cannot see that layer — it reads
declarations, and these are custom-property definitions — but the allowlist
rule below counts a local that introduces a literal _as_ a literal, so it was
never outside the axis, only outside the measurement.

## Colour roles

The role list. The roles are minted in `00-tokens.css`, fed by the theme
colour contract, and the old `--color-*` alias spelling is gone from the
bundle:

| Role                               | Token                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `surface`                          | `--slide-surface` ← `--t-color-background`                                                                                                                                                                                                                                                                                                                   |
| `surface-raised`                   | `--slide-surface-raised` ← `--t-color-surface-raised` (opaque card/panel plane: table soft body, icon-card bodies) beside the translucent `--slide-surface-white(-solid)` pair                                                                                                                                                                               |
| `on-surface` / `on-surface-muted`  | `--slide-on-surface(-muted)` ← `--t-color-text(-muted)`                                                                                                                                                                                                                                                                                                      |
| `surface-inverted` / `on-inverted` | `--slide-surface-inverted` = the current `--slide-on-surface` (an element that fills itself with the text colour: primary action chip, `.text-block.is-black`); `--slide-on-inverted` = the page surface at root, rebound to the opposite pole wherever the ground flips (contrast classes, theme background variants)                                       |
| `accent` / `on-accent`             | `--slide-accent` / `--slide-on-accent` ← `--t-color-accent` / `--t-color-accent-contrast`                                                                                                                                                                                                                                                                    |
| link                               | `--slide-link` ← `--t-color-link`, defaulting to the accent; `--slide-link-on-dark` ← `--t-color-link-on-dark`, defaulting to the accent lightened toward white                                                                                                                                                                                              |
| pole / variant text                | `--slide-on-light` / `--slide-on-dark` ← the theme's two poles (`--t-text-color-dark/-light`); `--slide-on-lime` / `--slide-on-mist` / `--slide-on-bg-dark` ← the derived per-surface answer (`--t-slide-bg-<id>-text`); `--slide-on-gradient(-muted)` ← the gradient layer's pair (`--t-slide-gradient-text(-muted)`, emitted only when the gradient is on) |
| accent companions                  | `--slide-accent-on-dark` ← `--t-color-accent-on-dark` (the display accent for dark grounds: quote attribution), defaulting to the on-dark link mix; `--slide-accent-soft` / `--slide-on-accent-soft` ← `--t-color-accent-soft(-contrast)` (the tinted plane icon blocks paint), derived mist-when-bright-else-accent                                         |
| `border`                           | `--slide-border-*` (opacity-derived)                                                                                                                                                                                                                                                                                                                         |
| `emphasis` / `on-emphasis`         | `--slide-emphasis` / `--slide-on-emphasis` — the filled band a type emphasises with (table header and label-column planes, kickers), fed by the accent pair                                                                                                                                                                                                  |
| series palette                     | `--slide-chart-{0..7}` ← `--t-chart-{0..7}` (numbered accent colours; the only series palette)                                                                                                                                                                                                                                                               |
| brand slots                        | `--slide-brand-{1..3}` ← `--t-color-brand-{1..3}` (filled from the theme's `brandColors`; an explicit slot wins), falling back to the accent when the theme declares no brand palette — countdown paints these as backgrounds, so the slot must always resolve to a visible colour                                                                           |
| gradient layer                     | `--slide-gradient-bg` / `--slide-gradient-opacity` ← `--t-slide-gradient-bg` / `--t-gradient-enabled`                                                                                                                                                                                                                                                        |

The contextual rebinding mechanism in `00-patterns.css` (a surface class
rebinds the text role for everything inside it) is correct and stays, including
the contrast derivation in `theme-normalize.js` — only the spelling changed:
surface classes and background variants now rebind `--slide-on-surface`,
`--slide-on-surface-muted`, `--slide-link` and — where the ground flips its
text pole — `--slide-on-inverted` (see `00-base.css` and the generated
variant rules in `shared/theme-slide-backgrounds.js`).

## The type scale is fluid

`--slide-text-*` is not a px constant. Each step is a number of _reference
pixels_ turned into a length by `--slide-text-unit`, which is derived from the
slide's own box:

```css
--slide-canvas-unit: calc((100cqi + 2 * var(--slide-padding)) / 1600);
--slide-text-unit: calc(var(--slide-canvas-unit) * var(--slide-text-scale));
--slide-text-base: calc(20 * var(--slide-text-unit));
```

`.slide` is its own `container-type: inline-size` query container, so a step is
exactly its historical px value while the slide renders at the 1600×900
reference canvas — which every current path does — and proportional the moment
it does not. Two consequences worth knowing:

- **A query container is queried by its descendants, never by itself.** A
  `--slide-text-*` value used _on_ the `.slide` element resolves against
  whatever container sits outside the slide. Set slide typography on
  descendants.
- **`--slide-padding` is the slide root's inline inset, not just a value.** The
  unit adds it back to reach the border box, so a type that bleeds to the edge
  states `--slide-padding: 0px` rather than `padding: 0`, and an inner box that
  wants the same 64px reads the spacing scale (`--slide-space-16`) instead.

`tests/slide-typography-scale.test.js` pins the shape;
`tests/slide-type-unit-parity.test.js` renders every registered type and
measures that the unit really is one reference pixel there.

## Radius, shadow, opacity

Already on the model: `--slide-radius-*` → `--t-radius*`, `--slide-shadow-*` →
`--t-shadow-scale`, and the opacity scale is slide-internal. Slide CSS goes
through the `--slide-*` role, never `var(--t-…)` directly.

The four radius steps are `sm` 10px · `md` 18px · `lg` 24px · `full` 999px, and
the axis is **complete**: every `border-radius` in the slide bundle is either
one of those roles or an allowlisted shape. `sm` is the smallest _corner_, not
the smallest value — anything finer is the micro-chip case below, where the
radius describes the outline of the box rather than its corners.

## The theme seam

What a theme may set — the full contract, ~30–35 tokens, zero type names:

- **Colour**: the role list above, the `--t-slide-bg-*` surface variants,
  `--t-chart-{0..7}`, `--t-color-brand-{1..3}`, link colour.
- **Typography**: `--t-font-{heading,body,caption,mono}`,
  `--t-heading-{weight,transform,letter-spacing}`, and the scale multiplier
  `--t-slide-text-scale` — **implemented**: it multiplies `--slide-text-unit`,
  so it moves every `--slide-text-*` step and every role derived from one, and
  nothing else. Unset behaves as `1`. **No per-role px sizes for themes** —
  that would re-couple every theme to every role.
- **Spacing**: `--t-slide-space-scale` (same model; contract point, multiplier
  not yet implemented).
- **Radius**: `--t-radius{,-sm,-lg}`. **Shadow**: `--t-shadow-scale`.
- **Layout/branding**: `--t-logo-url`, gradient tokens, title layout.

Per-type `--t-<type>-*` tokens (icon-card-grid, per-KPI-tile, table, quote and
chapter families) are **removed, not aliased** — the KPI tiles join the
`--t-chart-*` series palette, table planes reduce to surface/emphasis roles.
This is a deliberate breaking change during beta (see `versioning.md` § _The
beta stance_): a theme that sets a removed token does not break — unknown
tokens do nothing — but the deck renders with role-derived styling instead;
the release notes name each family. Status: every per-type family is gone —
KPI-tile (`--t-kpi-tile-{1..4}-*`, `--t-kpi-delta-*`), table
(`--t-table-<variant>-*`), list (`--t-list-item-title-letter-spacing`),
icon-card-grid (`--t-icon-card-grid-*` → the accent-soft / surface-raised /
on-gradient roles) and quote/chapter (`--t-quote-*`, `--t-chapter-*` → the
dark-surface variant answer `--t-slide-bg-dark-text` + `--slide-accent-on-dark`).
`theme-normalize.js` derives only role-shaped tokens.

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

- `50%`, `0` and `inherit` on `border-radius` — a circle, a deliberately square
  edge and "take the parent's shape" are shapes, not scale steps. **Asymmetric
  corners are not on this list**: the asymmetry is the shape, but each corner
  is still a step, so a corner composite writes all four as tokens
  (`var(--slide-radius-md) var(--slide-radius-sm) …`) — the same
  every-length-a-token rule as spacing composites;
- **micro-chip rounding** — a box small enough that the smallest step
  (`--slide-radius-sm`, 10px) clamps toward a circle or a pill instead of
  rounding a corner: the 14px chart legend swatch, the inline-code chip. Below
  roughly 24px the browser scales the radius down to half the box anyway, so
  the step stops describing a corner and starts describing the outline. Marked
  in place with an `allowlist:` comment. Self-evident shapes (`50%`, `0`) are
  not marked — the comment exists where a bare length would otherwise read as
  an unconverted literal;
- **sub-step hairlines** on spacing — a 1px or 2px length below the floor of the
  spacing scale, where the smallest step (`--slide-space-1`, 4px) is a full
  low-end step away (the scale doubles from 4 to 8) rather than a near-miss.
  These are not rhythm gaps: they are the second line of a label pair that has
  to read as one block (KPI figure and label, funnel stage and description,
  quote name and role, pyramid label and text), an optical baseline nudge for a
  glyph in a disc, the inner padding of an inline-code chip, and the last two
  tiers of the team-card density ramp, which continues below the scale. Marked
  in place with an `allowlist:` comment. **3px is not on this list** — its ratio
  to the floor (1.33) is inside one step, so it snaps to `--slide-space-1` like
  any other near-miss;
- `line-height: 1` and below on **single-line display glyphs** — a numeral in
  a circle badge, a KPI figure, an arrow, the countdown digits. There the line
  box _is_ the layout: raising it to `tight` decentres the badge. The leading
  steps describe text rhythm, and these carriers have none. Marked in place
  with an `allowlist:` comment;
- **KPI display figures** — the hero number on a metric tile and the unit
  beside it (`80-kpi-metrics-slide.css`). Their `font-size` is fitted to the
  tile geometry per `data-metric-count` (a 4-tile grid needs a smaller figure
  than a single tile), and the display scale that carries them
  (`--slide-text-kpi-{sm,md,lg}`) is deliberately coarse — three steps for the
  common counts. The in-between fills (a 3- or 4-tile figure, the
  bottom-subheading variant, the units) are layout measurements against the
  tile, not text-scale steps; snapping them up to the nearest display step
  reintroduces overflow at the denser counts. Marked in place with an
  `allowlist:` comment;
- the `--tf-size-scale` **multiplier** of the text-style controls — the S/M/L
  factor itself (`97-text-styles.css`), not the base size it scales (that is the
  ladder-rung category above);
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
2. ~~the `--color-*` spelling of the text-colour alias layer~~ — **done**
   (batch 2.2b): consumers migrated to the `--slide-*` colour roles, alias
   definitions deleted from `theme.css`;
3. ~~the five `--t-*` legacy aliases (`--t-primary`, `--t-accent`,
   `--t-bg-dark`, `--t-brand-1/2`)~~ — **done** (phase 3): consumers read
   roles, `theme-normalize.js` fills `--t-color-brand-{1..3}` from
   `brandColors` instead of emitting aliases;
4. ~~direct `var(--t-radius…)` reads in slide CSS~~ — **done** (batch 2.2a):
   all reads go through `--slide-radius-*`.

## Enforcement

`tests/slide-css-tokens.test.js` — a value that exactly equals a slide token
must be written as that token, per-file and per-category burndown budgets that
only go down.
Presenter chrome inside the slide bundle is excluded by file, with the reason
in the test.

**The gate cannot see inside `calc()`**, because a length there may be a
multiplier, an offset or an `em` and the parser cannot tell which. So a
`calc(<role> ± Npx)` sits off the scale without ever costing a budget point, and
a whole tail of them survived the axis sweeps: on the font-size axis the census
counted 12, spread over 7 types. The rule that closes the hole is a reading
rule, not a parser one: **an arithmetic offset from a role token is a scale step
the scale does not have yet** — write the step, or add it. `calc()` stays
legitimate for the two things it cannot express otherwise, a scale multiplier
(`--tf-size-scale`, `--quote-scale`) and `em`-relative sizing, and both are
already allowlisted categories. A literal _inside_ such an expression is not
covered by that allowlist: the multiplier is allowed, the number it multiplies
is still a value on the axis.

The same file carries the end-state contract check: **no `var(--t-…)`
anywhere in the slide bundle outside `00-tokens.css`** (grown from the
batch-2.3a radius slice to the whole `--t-*` namespace in phase 3), plus the
seam snapshot: the set of `--t-*` tokens the two contract files
(`00-tokens.css`, `theme.css`) read is pinned in
`tests/fixtures/theme-contract.json`, so a new theme dependency is a
deliberate diff, never a side effect.
