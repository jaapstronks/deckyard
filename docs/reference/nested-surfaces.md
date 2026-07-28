# Nested surfaces: text that does not sit on the slide

How an element that paints its own background gets a text colour that reads
against *that* background instead of against the slide's.

This is a reference page: it describes what is, not what will change. The
slide-level half of the story — how the slide itself picks a text colour, and
what a theme must declare for it — is in
[`slide-background-contrast.md`](slide-background-contrast.md) and
[`contrast.md`](contrast.md).

## The distinction

A slide answers one question about colour: *what reads on my background?* The
answer lands in `--color-text` / `--color-text-muted`, and every component
downstream reads those tokens. A background image or a background variant may
redirect them, and the whole slide follows.

An element that paints its own background silently invalidates that answer for
its own subtree. Its text is no longer on the slide; it is on the element. The
slide's answer is now about a surface that is not there any more.

That is one defect, and it showed up three times:

| Where | The surface | The text | Result |
| --- | --- | --- | --- |
| Funnel stage bars | the theme's lime, unchanged | `--color-text`, flipped to white by the `calm` variant | white on a light bar |
| Poll results panel | `#ebebeb` | inherited `#fafafa` | ~1.1:1 |
| List bullet markers | the slide background | the brand accent, which follows nothing | dots nearly invisible on a dark variant |

`pickTextColorForBg()` (`shared/color-utils.js`) does exactly the right work,
but it is only called where a *theme token* supplies the background. A colour
that lives in slide CSS — a hardcoded `#ebebeb`, a `--slide-bg-lime`, a
`color-mix()` — is invisible to it. The contrast rule was formulated; it just
stopped at the slide background.

## The contract

**A block that paints its own background says which surface it is.** One class,
and the text tokens are redirected for its whole subtree — the same mechanism
`.slide.slide-bg-<id>` uses one level up.

```html
<div class="poll-results on-surface-light">
```

Five surfaces, defined once in
`client/styles/slides/01-layout-and-title/00-base.css`:

| Class | Text colour | Use for |
| --- | --- | --- |
| `on-surface-light` | `--t-text-color-dark` | any near-white plate: cards, panels, form states |
| `on-surface-dark` | `--t-text-color-light` | the theme's deep surface |
| `on-surface-accent` | `--t-color-accent-contrast` | a filled brand-accent block |
| `on-surface-lime` | `--t-slide-bg-lime-text` | an element painting the theme's lime |
| `on-surface-mist` | `--t-slide-bg-mist-text` | an element painting the theme's mist |

`light` and `dark` are the theme's two poles — the same pair background-image
auto-contrast picks between. The other three read a **derived** token: for
`accent`, `lime` and `mist`, `shared/theme-normalize.js` runs the background
through `pickTextColorForBg()` and stores the winner. Nothing is assumed: the
`midnight` theme ships lime as `#18181b`, so a hardcoded dark pole would be
wrong for a shipped theme, and `tests/nested-surface-contrast.test.js` uses that
theme as the case that would catch it.

A theme-declared background variant already gets `--t-slide-bg-<id>-text` from
its own `textColor` (see
[`theme-slide-backgrounds.md`](theme-slide-backgrounds.md)); the derivation
covers the two built-in surfaces that predate that mechanism.

### When the surface swaps in CSS

Sometimes the surface is not fixed. A funnel bar paints lime normally and the
accent on a lime slide, because otherwise it would disappear into the
background. A class in the markup cannot express that, so the rule that swaps
the background overrides the text on the same selector:

```css
.slide-funnel.slide-bg-lime .stage-bar {
  background: var(--color-accent, #375c5d);
  --surface-text: var(--t-color-accent-contrast, var(--t-text-color-light, #ffffff));
}
```

The redirect itself still lives in `00-base.css`; only the pole moves. This is
the rule to reach for whenever `background` and the text belong together in one
selector.

It replaced a per-element list — `.stage-label`, then `.stage-value`, named one
by one — which is why `.stage-text` kept the slide's colour on a surface it was
not on. Redirect the token, not the elements: anything added to the bar later is
right by default.

## Markers are not text

A bullet dot has no text colour to follow, and the accent it carries does not
follow a background variant either. So it gets its own token:

```css
.slide { --slide-marker-color: var(--color-accent); }
```

On a slide that has flipped its text colour — a background image, or a variant
that declared one — the accent is no longer guaranteed against that ground, so
the dot is mixed mostly toward the colour that *is* guaranteed there:

```css
--slide-marker-color: color-mix(in srgb, var(--color-accent) 35%, var(--slide-bg-text));
```

A brand tint without betting on it. The threshold a graphic has to clear is the
3:1 of WCAG 1.4.11, not the 4.5:1 of body text, and 65% of a colour that already
clears 4.5:1 clears 3:1 with room to spare.

A **numbered** marker is deliberately not included. It is a filled disc with a
number on it, so it is text-on-a-surface, and that number already reads via
`--t-color-accent-contrast`. Moving the disc would break exactly the pair that
makes it legible.

## What is checked

`tests/nested-surface-contrast.test.js` holds three kinds of assertion:

1. **The numbers.** Every shipped theme's lime and mist surfaces are measured
   against their derived text colour at WCAG AA for body text.
2. **The wiring.** Each surface class is defined exactly once, and each is
   inside the shared redirect block — a pole class outside it would set
   `--surface-text` with nothing reading it, which is a silent no-op.
3. **The sweep, kept as a gate.** Every CSS rule that paints one of the theme's
   surface tokens must be paired with a surface declaration: an `on-surface-*`
   class in the markup, or a `--surface-text` / `--color-text` override in the
   rule itself. A new panel that forgets fails the build rather than shipping at
   1.1:1.

The gate has one allowed exception, `.slide-poll .poll-bar-track` — a bare
progress rail with no text on it, so it has no text colour to get wrong. A slide
ROOT painting a surface token is skipped too: that is the slide's own
background, which the slide-level logic already answers for.

## Known limits

- **Contrast is checked per token pair, not per rendered pixel.** A surface
  built with `color-mix()` against an unknown slide background (the
  `--interaction-surface` family is `white 92%` mixed with `--color-background`)
  cannot be resolved without a layout engine. Those are classed `light` because
  they are light *by construction* — 92% white over anything is light — rather
  than because a number was computed.
- **Gradient variants cannot be measured.** A theme variant whose `value` is a
  gradient has no single background colour, so its `textColor` is taken on the
  theme author's word.
- **The accent pair is judged at the `large` bucket.**
  `--t-color-accent-contrast` is worn by big glyphs — a letter in a 44px poll
  disc, a step number, an icon — not by paragraph text. The tightest shipped
  pair today is `playful` at 4.40:1: over `large` AA, just under `body` AA. That
  is a property of the shipped palette, not of this mechanism.
