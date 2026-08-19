# Contrast

How Deckyard measures colour contrast, which threshold applies where, and why
there are two readings instead of one.

## Where the code lives

Two modules, split along the line between measuring and judging:

| Module                  | Answers                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `shared/color-utils.js` | _How much contrast is there?_ — hex parsing, WCAG relative luminance, the contrast ratio, and the readable-text pole picker. |
| `shared/contrast.js`    | _Is that enough?_ — the threshold tables, the APCA implementation, and `assessContrast()`.                                   |

The split exists because thresholds are a policy decision and a ratio is not.
Before it, the ratio formula was written twice and the thresholds were
unexplained literals in two different files.

### One ratio implementation

`contrastRatioFromLuminance(l1, l2)` is the only place in the repo that spells
`(lighter + 0.05) / (darker + 0.05)`. Two entry points sit on top of it:

- `getContrastRatio(hex1, hex2)` — for callers holding colours. Order-independent.
- `contrastRatioFromLuminance(l1, l2)` — for callers that already have
  luminances. The background-image sampler walks a thousand pixels and never
  sees a hex string, which is exactly why it used to keep a private copy.

Three consumers use it: the text-pole derivation (`pickTextColorForBg`), the
background-image detection (`client/lib/slide-authoring/bg-contrast.js`), and
the theme editor's contrast readout.

## Thresholds

Both tables are keyed by the same two size buckets, so the numbers sit next to
each other instead of being restated per call site.

```js
WCAG_THRESHOLDS = {
  large: { aa: 3, aaa: 4.5 },
  body: { aa: 4.5, aaa: 7 },
};
APCA_THRESHOLDS = { large: 60, body: 75 };
```

`large` is WCAG's "large scale text": ≥18pt, or ≥14pt bold. Slide titles, table
headers and button labels are all comfortably in that bucket. Slide body copy is
judged at `body` even though it renders big on a projector, because a deck can
be exported to PDF and read at document size.

## Two readings, one verdict

`assessContrast(textHex, bgHex, { size })` returns both.

**WCAG 2.2 is the verdict.** It is what EN 301 549 and the European
Accessibility Act reference, so it is the only claim a user can stand behind
when someone asks whether their deck is accessible. `level` is `'fail'`,
`'aa'` or `'aaa'`, judged against the size bucket.

**APCA (Lc) is a perceptual second opinion.** It models text size and weight
properly and is markedly better at light-on-dark — the case WCAG 2 is known to
misjudge, and the case the `midnight` theme is built on. It is candidate work
for WCAG 3, not a standard, so it informs but never decides. `apcaLc` and
`apcaPasses` carry it; `disagree` is true when the two methods reach opposite
conclusions, which is usually light text on a dark ground that looks thinner
than its ratio suggests.

### Argument order matters

`getContrastRatio(a, b)` is order-independent. `getApcaLc(text, bg)` and
`assessContrast(text, bg)` are **not** — APCA is polarity-aware, and dark-on-light
is a different problem from light-on-dark. A positive Lc means dark text on a
lighter ground; negative means the reverse. Thresholds compare against the
absolute value.

The APCA constants in `shared/contrast.js` are vendored from APCA-W3 0.1.9 (the
"0.98G-4g" set) rather than taken as a dependency: it is a closed formula, and a
package for forty lines would be the larger liability. They are load-bearing —
a typo in one produces plausible numbers rather than an error, which is why
`tests/contrast.test.js` pins the two published anchor values (black on white =
Lc 106, white on black = Lc −107.9).

## Choosing a text colour

`pickTextColorForBg(bgHex, { light, dark })` runs both poles through
`getContrastRatio` and returns the winner. It does **not** split on a luminance
midpoint: a midpoint picks the pole that looks logical rather than the pole that
reads, and both sides of it can land under AA without anything flagging it.

Because contrast is not symmetric around L=0.5, the crossover sits near L≈0.21
for the default poles, so mid-light backgrounds get dark text.

## What the user sees

The theme editor reports contrast next to the pickers that produce it —
per-variant rows in the backgrounds section, and a readout block under the main
colours grid for the pairs those four pickers imply.

It **reports and never blocks.** A self-hoster may have a brand reason to ship a
low-contrast variant, and the settings panel is not the place to overrule that.
The ratio is always shown, passing or not, so contrast is a visible property you
can dial toward rather than an alarm that only appears once you have already
crossed the line.

Two details worth keeping:

- Only one text pole actually renders on the main background. The other is still
  measured, but marked unused and muted, so its inevitable failure reads as
  context rather than an alarm. A badge that cries wolf stops being read.
- Only the failing verdict is tinted. `--app-success` is a bright
  `142 70% 45%`, which lands around 2.2:1 on the light surface — shipping that
  inside a contrast checker would be its own bug report. Passing verdicts render
  as plain text; the word "AA" carries the meaning either way.
