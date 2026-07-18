# Prompt changes

One entry per iteration round: what changed, where, and which measured
shortcoming it addresses. Every entry names the run that motivated it and the
run that measured the result, so a score movement can always be traced back to
a specific edit.

Prompt locations are listed in `PLAN.md`. Score history is in `history.json`.

---

## Round 1 — escaped newlines in the slide-type catalog examples

**Motivated by** run `2026-07-18_15-45-37` (baseline, overall 4.46).
**Prompt version** `2f0e86683435` → see the round-1 run for the new hash.

**Shortcoming.** The judge flagged literal `\n` escape sequences rendering as
visible text in five of eleven cases (`cbs-persbericht-criminaliteit`,
`cloudflare-nov-2025-outage`, `naacl-good-conversation`,
`wikipedia-zero-knowledge-proof`, and in the comparison slides of others). A
presenter would have to clean every one of those slides by hand. It cost marks
on both presentability and slide economy.

**Root cause.** The catalog examples were written in JavaScript source as
`'- First point\\n- Second point'`. In JS that is a literal backslash followed
by `n`, not a newline — so the example strings contained no real newlines at
all. `buildSlideTypeDescription` serializes those examples with
`JSON.stringify`, which escapes the backslash again, so the model saw
`"leftBody": "- First point\\n- Second point"` in its prompt and correctly
copied a literal backslash-n into its output. The model was imitating the
example exactly; the example was wrong.

**Change.** Replaced `\\n` with `\n` in the example values across
`slide-catalog/examples/basic-slides.js`, `diagram-slides.js` and
`card-slides.js` (57 occurrences). Affects the most-used markdown fields:
`content-slide` body, `comparison-slide` left/right body, SWOT and matrix
block bodies, and the card slide bodies.

**Deliberately not changed.** The two `\\n` occurrences in
`visual-content-slides.js` are prose *descriptions* documenting the TSV escape
format ("newlines between rows"), not JSON examples. Chart `data` fields came
out of the baseline with correct real newlines, so that documentation works as
intended and was left alone.

**Expected effect.** Presentability and slide economy up; no effect expected on
coverage or faithfulness. Watch those two for regression.

---
