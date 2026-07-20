# CSS breakpoints

Deckyard has **one** breakpoint ladder. Every width-based `@media` in
`client/styles/**` must land on a rung of it. This is enforced by
`tests/css-breakpoints.test.js`, not by the language — see
[Why not a variable](#why-not-a-variable).

## The ladder

Five rungs, chosen so they absorb the historic clusters and coincide with real
device widths. `max-width` is the "at most this wide" side; the `min-width`
counterpart is one pixel up, so the two never overlap.

| Name | `max-width` | `min-width` | Intended for |
|---|---|---|---|
| `xs` | 480px | 481px | small phone, portrait |
| `sm` | 640px | 641px | phone, portrait |
| `md` | 768px | 769px | iPad portrait / topbar collapses |
| `lg` | 1024px | 1025px | iPad landscape / editor goes two-column |
| `xl` | 1280px | 1281px | roomy desktop |

### Ultra-wide

A separate, deliberate scale for progressive enhancement on very large
displays. `min-width` only — these never appear as a `max-width`.

| `min-width` | Intended for |
|---|---|
| 1400px | wide desktop |
| 1600px | very wide desktop |
| 1800px | ultra-wide |

## Rules

1. **Pick a rung, don't invent a width.** If a layout breaks at 860px, use the
   rung below (768) or above (1024) and adjust the layout — do not add 860.
2. **Bands pair a rung with the next rung's counterpart**, e.g.
   `(max-width: 1024px) and (min-width: 769px)` for "tablet landscape only".
3. **`min-width` and `max-width` for the same rung must not overlap.** Use
   `max-width: 768px` / `min-width: 769px`, never `min-width: 768px`.
4. **Non-width conditions are out of scope** and unrestricted: `hover`,
   `pointer`, `orientation`, `prefers-reduced-motion`, `prefers-color-scheme`,
   `print`, `max-height`, `min-resolution`.
5. **Widths are always `px`.** `em`/`rem` media widths are not used.

## Why not a variable

`@media (max-width: var(--bp-md))` does not work — custom properties are not
allowed in media conditions. `@custom-media` (Media Queries 5) has no browser
support, and Deckyard has no bundler or PostCSS step, so there is nowhere to
compile it.

The mechanism is therefore **a fixed ladder plus a test that fails on
deviation**. `tests/css-breakpoints.test.js` parses every `@media` under
`client/styles/**` and rejects any width condition off the ladder.

## The allowlist

The test carries an explicit allowlist of not-yet-migrated values, so it was
green from day one. Two things follow:

- **Adding to the allowlist is not allowed** in new work. It exists to let the
  migration land in reviewable pieces, not to grant exceptions.
- **The allowlist is checked for staleness.** Once a value no longer appears in
  any stylesheet, the test fails until its entry is removed. Migrations shrink
  it monotonically; when it is empty, the ladder is fully enforced.

Migration progress is tracked in `docs/plans/breakpoint-scale.md`.
