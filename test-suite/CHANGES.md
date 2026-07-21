# Prompt changes

One entry per iteration round: what changed, where, and which measured
shortcoming it addresses. Every entry names the run that motivated it and the
run that measured the result, so a score movement can always be traced back to
a specific edit.

The prompt-bearing files are listed in `lib/config.js` (`PROMPT_SOURCE_FILES`).
Score history is in `history.json`.

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

**Measurement note.** Round 1's first run could not measure this cleanly. Two
harness faults were found while reading it: the prompt-version hash did not
cover `slide-catalog/examples/`, so the report claimed no prompt file had
changed; and `readSourceText` was feeding raw HTML rather than extracted text
for three cases. Both are fixed, and the baseline was re-established on
corrected inputs before round 2.

---

## Round 2 — the anti-repetition signal never reached the model

**Motivated by** the baseline deck corpus: `list-slide` accounted for 83 of 222
slides (37%), with 40 validation warnings for "same slide type as previous
slide". `content-slide` was chosen 3 times in the whole corpus. The judge
described several decks as reading text-heavier and less varied than the human
reference.

**Shortcoming.** Long runs of identical list-slides. It reads as a wall of
bullets and costs marks on presentability and slide economy, and it is a large
part of why the generated decks feel unlike the human ones.

**Root cause — a real bug, not prompt wording.** `buildAdjacentContext` reads
`group.resolvedTypes` to tell the model what the previous slides used. But
groups are refined in parallel batches of six, and `batch.map()` builds every
group's context *before* any of them resolve; `resolvedTypes` is only assigned
in the `.then()` after a group returns. For any deck with no more groups than
the batch size — which is most decks — no group ever saw a previous group's
types, and the "ADJACENT CONTEXT (avoid repetition)" block was empty every
time. The mechanism existed but was dead in practice.

**Change.**
1. `refine-slides.js` — when `resolvedTypes` is not yet available, fall back to
   the previous group's *hints*, which are known upfront. This keeps the signal
   alive without serializing the batch (hints predict type choice closely
   enough to steer off a third list-slide in a row).
2. Phase 2 system prompt — added an explicit variety rule naming the
   alternatives to reach for (numbers → kpi-metrics, dated steps → timeline,
   two alternatives → comparison, prose → content-slide), and relabelled the
   adjacent-context block so its purpose is stated rather than parenthetical.

**Guard against overcorrection.** The new rule explicitly subordinates itself
to the existing "prefer the plainest type that genuinely fits" rule: variety is
a tie-breaker between equally good fits, not licence to force content into a
shape it does not have. The risk being managed is a swing into gratuitous
diagram slides, which would show up as a drop in faithfulness or
presentability.

### Result: REVERTED

Measured on the full 11-case corpus (run `2026-07-18_16-07-20`, prompt version
`14d0e0d9c11e`) against the 11-case baseline.

The change did exactly what it was designed to do, and made the decks worse.

| Monotony (the target) | Baseline | Round 2 |
| --- | ---: | ---: |
| Consecutive same-type repeats | 55 | 20 |
| Longest run of one type | 4 | 3 |
| list-slide share | 37% | 26% |

| Judged quality | Baseline | Round 2 | Δ |
| --- | ---: | ---: | ---: |
| Coverage | 4.73 | 4.36 | −0.37 |
| Structure | 4.64 | 4.55 | −0.09 |
| Slide economy | 4.00 | 3.82 | −0.18 |
| Faithfulness | 4.82 | 4.27 | **−0.55** |
| Presentability | 4.09 | 3.91 | −0.18 |
| **Overall** | **4.46** | **4.18** | **−0.28** |

The monotony metric improved by 64% while every quality dimension fell. Pushed
to vary the layout, the model moved content into shapes it did not have —
losing material (coverage) and distorting it (faithfulness). The subordination
clause was not a strong enough guard.

This is the clearest result in the whole exercise, and it is a warning about
the method rather than about slide types: **the proxy metric and the goal came
apart**. Had the suite scored only structural variety, this change would have
looked like a 64% win.

**Action.** Reverted `refine-slides.js` in full, returning the prompts to
version `b11a78726ab7` — the state measured at overall 4.46 (11 cases) / 4.47
(3 cases). No re-measurement was needed because the revert restores an
already-measured configuration.

**What to keep from it.** The adjacency bug is real and still present: for any
deck with no more groups than the batch size, `buildAdjacentContext` produces
nothing. Both halves of round 2 were reverted together because there was no
budget left to A/B them, so it is not known whether the bug fix alone (without
the prompt rule) would help or hurt. That is the single most worthwhile next
experiment — see the recommendations in the PR.

---

## Round 3 — too much of the deck was section dividers

**Motivated by** the baseline and R1 deck corpora: `chapter-title-slide` was
48 of 222 slides (22%) at baseline and 9 of 40 (23%) on the R1 subset. A
divider carries no content of its own, so roughly a fifth of every deck was
signposting rather than substance.

**Root cause.** The phase 1 structure guidelines said "After each chapter,
include 2-4 content slides maximum". Read as an instruction that is a *ceiling
on content per chapter*, so it actively forces a new chapter every second to
fourth slide — the more faithfully the model follows it, the more dividers it
produces.

**Change.** `generate-outline.js` structure guideline 3 now gives each chapter
3-5 content slides, explains *why* (a divider carries no content of its own),
and anchors the count to deck length: at most 2 chapters under 10 content
slides, more than 4 only for a long deck.

**Result: KEPT.** Run `2026-07-18_16-29-02` (3 cases) against R1.

| | R1 | Round 3 |
| --- | ---: | ---: |
| Divider share (the target) | 23% | **15%** |
| Structure | 4.67 | **5.00** |
| Faithfulness | 4.33 | 5.00 |
| Coverage | 4.67 | 4.67 |
| Slide economy | 4.00 | 4.00 |
| Presentability | 4.67 | 3.67 |
| **Overall** | **4.47** | **4.47** |

The target metric moved and structure went to a clean 5.00 without the
coverage or faithfulness cost that sank round 2 — fewer dividers removes
content-free slides rather than reshaping content.

Presentability fell 1.00, which on three cases is one case dropping three
points. The rationale names the cause: slide 17 of the Cloudflare deck ended
"we apologize for the p" — a mid-word truncation, unrelated to chapter
structure. Kept on that basis, with the truncation treated as its own defect
below.

The faithfulness rise (+0.67) is mostly the ASML arithmetic slip from the R1
run not recurring, i.e. variance rather than an effect of this change. Overall
being flat at 4.47 across both is the honest headline.

---

## Follow-on fix — mid-word truncation

Surfaced by round 3's presentability rationale rather than planned.

`truncate()` in `validate-slides.js` hard-sliced at the character limit, so an
over-long field ended mid-word on the slide. It now cuts back to the last word
boundary (falling back to the hard cut when there is no break point in the last
40%, so a single very long token is still bounded) and strips trailing
punctuation before the ellipsis.

This is a deterministic string function with an obvious correctness criterion,
so it ships with unit tests rather than an end-to-end measurement run —
**its effect on the rubric scores is unmeasured**, unlike rounds 1–3.

---

## OpenAI track

The suite was pointed at the OpenAI generation path (`--vendor openai`,
`gpt-5.5`) with the judge still on `claude-opus-4-8`, so scores stay on one
scale. Reports refuse to diff across vendors: a deck from a different generator
is a different experiment.

### Finding: the OpenAI path was broken outright

The very first outline call returned `400 unsupported_value` — Deckyard sends
`temperature` on every OpenAI request, and `gpt-5.5` accepts only the default.
Not a degraded result: generation failed completely, so **no current-generation
OpenAI model could be used at all**. The Claude provider already guards this
(Opus 4.7+ removed sampling parameters for the same reason); the OpenAI side had
no equivalent.

Fixed in `provider-base.js`: temperature is omitted for `gpt-5.5+`, `gpt-6+` and
o-series models, and still sent to `gpt-5.2` and earlier so existing
deployments do not silently change sampling behaviour. Unit-tested and verified
against the live API.

This is arguably the most valuable single finding of the exercise, and it came
from exercising a code path rather than from any rubric score.

### Vendor comparison (3 cases, same judge, prompt version `218d32ce56fc`)

| Dimension | Claude Opus 4.8 | OpenAI gpt-5.5 |
| --- | ---: | ---: |
| Coverage | 4.67 | 4.67 |
| Structure | 4.67 | 4.67 |
| Slide economy | 4.00 | 3.67 |
| Faithfulness | 5.00 | 4.67 |
| Presentability | 3.67 | 4.00 |
| Closeness to human deck | 3.00 | **4.00** |
| **Overall** | **4.47** | **4.34** |

Cost was near-identical (~$2.35 per round either way), so there is no cost
argument between them. Opus edges the overall score, but gpt-5.5 is a full
point better on closeness to human editorial judgement — the dimension Claude
was consistently weakest on.

### Round 4 — "no fact twice" (REVERTED)

**Motivated by** the OpenAI judge rationales: figures restated on later slides
("three of them just restate IBM sales figures already on slide 3"), duplicated
chart axis labels, and one deck reusing the same six-block layout on nearly
every body slide.

**Change.** Added a NO FACT TWICE pass to the phase 1 prompt: re-read the
outline, find any figure/name/claim on more than one slide, keep it where it
carries most weight and cut it elsewhere.

**Result: reverted.** Coverage −0.67, structure −0.34, faithfulness −0.34,
closeness-to-human −1.00, overall 4.34 → 4.07.

The mechanism was visible in all three coverage rationales: the decks now
*omit* facts — ASML's effective tax rate, quantitative detail on victim types,
the Cloudflare "worst outage since 2019" severity framing. An instruction to
cut repeated facts made the model cut facts. Reverted to `218d32ce56fc`.

### The pattern across all four rounds

| Round | Kind of change | Outcome |
| --- | --- | --- |
| 1 — escaped newlines | Concrete defect fix | Kept; defect 5 → 0 |
| 2 — slide-type variety | General stylistic nudge | **Reverted** (faithfulness −0.55) |
| 3 — chapter dividers | Concrete, counted defect | Kept; 23% → 15% |
| 4 — no fact twice | General stylistic nudge | **Reverted** (coverage −0.67) |
| OpenAI temperature | Concrete defect fix | Kept; path went broken → working |

Both changes that fixed a **specific, countable defect** held up. Both
**general instructions about how to write better slides** made the decks worse,
each time by pushing the model into an over-correction the guard clause did not
prevent. On this evidence the generation prompts are already near a local
optimum for broad stylistic advice, and the remaining wins are in specific
defects and in the pipeline code — not in telling the model to try harder.

---

## Round 5 — the adjacency bug, retested on its own

The top open question from PR #82. Round 2 bundled this bug fix with a prompt
variety rule, regressed, and both halves were reverted together — so it was
unknown whether the fix alone helps. The staged harness makes the experiment
clean and cheap.

**Method.** Outlines generated once and frozen (`outline-2026-07-18_17-52-24`,
3 cases, 3–5 sections each — the fix only acts *between* groups, so a
single-section run would eliminate the effect being measured). Both arms then
refined the identical frozen outlines, varying only phase 2:

- **Arm A** — current code, bug present.
- **Arm B** — hints fallback in `buildAdjacentContext`. The prompt template is
  byte-identical, including the original `ADJACENT CONTEXT (avoid repetition):`
  label. No variety rule. Only the *data* filling the block changes.

**Aggregate result — a wash:**

| | Arm A (bug) | Arm B (fix) |
| --- | ---: | ---: |
| Consecutive same-type repeats | 15 | **12** |
| Longest run of one type | 4 | **3** |
| list-slide count | 8 | **6** |
| Wall-of-text slides | 5 | **4** |
| Slide economy | 3.33 | 3.67 |
| Faithfulness | 5.00 | 4.67 |
| Presentability | 4.00 | 3.67 |
| Coverage / structure | 4.67 | 4.67 |

**Per case, which is what actually settles it:**

| Case | Repeats | Economy | Faithfulness | Presentability |
| --- | --- | --- | --- | --- |
| asml-q4-2024 | 4 → **2** | 3 → **4** | 5 → 5 | 4 → 4 |
| cloudflare-nov-2025-outage | 6 → **5** | 3 → 3 | 5 → 5 | 4 → 4 |
| cbs-persbericht-criminaliteit | 5 → 5 | 4 → 4 | 5 → **4** | 4 → **3** |

Every point of the aggregate regression comes from the CBS case — **the one
case where the mechanism never fired** (repeats unchanged at 5). Its
faithfulness rationale states every number is traceable and correct, docking it
only for "minor unsupported interpretive framing" on two slides. That is a
marginal judge call on an unchanged mechanism, not an effect of this change.

Where the fix did fire, it helped: ASML lost half its consecutive repeats and
gained a point of slide economy at no cost elsewhere.

**Kept.** It is a correctness fix first — the code intends to pass adjacency
context and silently passes nothing for most decks. The mechanism improves
where it fires, and unlike round 2 there is no evidence of harm.

**Honest limits.** n=3, one repeat per arm. This does not establish a quality
*gain*; it establishes that the fix is not harmful and that round 2's damage
came from the prompt rule, not from this. Separating the two was the whole
point of the retest.

**Method note.** The aggregate said "wash, with a faithfulness regression"; the
per-case table said "works where it fires, unrelated noise elsewhere". At n=3 a
single case moving one point shifts a dimension by 0.33, so **aggregate means
over three cases are not a safe basis for a keep/revert decision** — the earlier
rounds should be read with that in mind too.

---

## Noise floor: what a score difference has to beat

Three **identical** staged-refine runs — same frozen outlines, same prompts, no
code change between them. Every difference below is pure run-to-run noise.

| Dimension | Run 1 | Run 2 | Run 3 | Noise spread |
| --- | ---: | ---: | ---: | ---: |
| Slide economy | 3.67 | 3.67 | 3.33 | 0.33 |
| Faithfulness | 5.00 | 4.00 | 4.67 | **1.00** |
| Presentability | 4.00 | 4.00 | 3.67 | 0.33 |
| Structure | 4.33 | 4.00 | 4.33 | 0.33 |
| Coverage | 5.00 | 4.67 | 4.67 | 0.33 |
| **Consecutive same-type repeats** | **12** | **12** | **12** | **0** |

Two things follow, and they are the most useful results in this document.

**1. A 3-case dimension mean is a weak instrument.** Faithfulness alone swings
a full point with nothing changed. Anything at or below ±0.33 on three cases is
indistinguishable from noise, and for faithfulness the bar is a full point.

Re-reading the earlier rounds against that bar:

| Round | Reported delta | Verdict now |
| --- | --- | --- |
| 1 — escaped newlines | +0.33 presentability | Inside noise. The *defect count* 5 → 0 was the real evidence, not the score. |
| 2 — variety rule | −0.55 faithfulness | Measured on **11** cases, not 3. Stands, though the 11-case noise floor is still unmeasured. |
| 3 — chapter dividers | +0.67 faithfulness, −1.00 presentability | The faithfulness gain is inside the 1.00 faithfulness noise band — it was correctly attributed to variance at the time. The presentability drop was traced to a specific truncation defect, which is why it survived scrutiny. |
| 4 — no fact twice | −0.67 coverage | Twice the coverage noise band, and corroborated by three rationales naming omitted facts. Revert stands. |
| 5 — adjacency | −0.33 faithfulness | Comfortably inside noise, as the per-case reading already concluded. |

**2. The deterministic metrics are perfectly stable.** Consecutive same-type
repeats came out 12, 12, 12. Structural counts do not drift at all while judge
scores swing by a point.

This retroactively justifies a pattern that had only been an observation:
**changes fixing a countable defect held up; changes judged by score movement
alone did not.** The countable metrics were simply a far better instrument.
Prefer them, and treat the judge's *rationales* — which name specific slides —
as evidence, while treating its aggregate numbers at n=3 as a weak prior.

Cost: $5.09 for three replicates.

---

## Corpus-wide outline diagnostic (11 cases)

Phase 1 only, judged on the plan rather than the prose. `$5.74` for the corpus.

| Dimension | Mean | Per-case scores |
| --- | ---: | --- |
| Ordering | 4.00 | `44444444444` |
| Sectioning | 3.91 | `44443444444` |
| Selection | 3.64 | `23443444444` |
| **Slide allocation** | **2.82** | `24323333323` |

**Slide allocation is the systematic weakness of the whole pipeline** — never
above 3 on any case, well clear of the noise floor, and measured on 11 cases
rather than 3. It asks whether each planned slide earns its place and whether a
section's size matches how much it has to say.

The planned slide counts point at a likely cause. `calculateTargetSlides`
computes `words ÷ 75`, clamped to `[5, 25]`, and the outcome misses in both
directions:

- **Dense short sources undershoot the target.** ASML (1,904 words) targets 25
  and plans 15 — the model sensibly refuses to spin a 4-page press release into
  25 slides.
- **Long sources overshoot the cap.** PBL plans 36, CBS Veiligheidsmonitor 32,
  Wikipedia 31, IEA 30 — all against a hard cap of 25.

So the target is being overridden in both directions, which makes it dead
weight at best. A word count is a poor proxy for how many slides material
deserves; information density is what matters.

**Ordering scoring a flat 4.00 on all eleven cases** is worth treating with
suspicion — a dimension that never varies is more likely to be one the judge
cannot discriminate on than one the pipeline has solved.

Next experiment: slide allocation, iterated at the outline stage only
(~$0.20/case, no phase 2 spend).
