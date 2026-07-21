# AI suite run `2026-07-18_15-51-29`

- **Date**: 2026-07-18T15:51:29.563Z
- **Model**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `2f0e86683435`
- **Cases**: 4 (asml-q4-2024, cbs-persbericht-criminaliteit, cloudflare-nov-2025-outage, wikipedia-zero-knowledge-proof)
- **Repeats per case**: 1
- **API cost**: $8.2259

Compared against run `2026-07-18_15-45-37` (prompt version `2f0e86683435`).

That run covered 11 cases; its scores are narrowed to this run's 4 for a like-for-like comparison.

No prompt files changed since then — differences are run-to-run variance.

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.75 | · 0.00 |
| Structure | 4.50 | ▼ -0.50 |
| Slide economy | 4.00 | ▼ -0.25 |
| Faithfulness | 4.00 | ▼ -1.00 |
| Presentability | 4.25 | ▲ +0.25 |
| Closeness to human deck | 3.00 | · 0.00 |
| **Overall** | **4.30** | ▼ -0.30 |

> **Regression warning.** These dimensions moved down:
> - Structure (-0.50)
> - Slide economy (-0.25)
> - Faithfulness (-1.00)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| asml-q4-2024 | A | 14 | 25 | 0 | 80% | 4/5 | 3.50 |
| cbs-persbericht-criminaliteit | B | 13 | 24.62 | 0 | 95% | 5/5 | 4.60 |
| cloudflare-nov-2025-outage | B | 16 | 40.44 | 0 | 100% | 5/5 | 4.80 |
| wikipedia-zero-knowledge-proof | B | 25 | 46.28 | 2 | 100% | 5/5 | 4.20 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Closeness to human deck (3.00)

- **asml-q4-2024** (3/5): Shares the human deck's editorial spine (Q4/FY summary, dividend, outlook, AI theme) but diverges by omitting the extensive financial statements, end-use/technology/region breakdowns, and investor key messages that dominate the human deck; conversely the human deck has no standalone company-profile or pull-quote slide. Similar narrative instinct, different depth of financial detail.

### Slide economy (4.00)

- **asml-q4-2024** (4/5): KPI slides (3-6, 12) are appropriately terse for spoken delivery, and the quote slide (10) is well judged. Slide 9's four stacked text blocks and slide 13's five-item list are slightly denser than needed but still presentable.
- **cbs-persbericht-criminaliteit** (4/5): KPI and chapter slides are appropriately lean. Slide 3's list is somewhat verbose with paired heading+explanation lines, and slide 5's four-phase timeline plus footnote is dense for spoken delivery; trimming to phrases would improve pacing.
- **cloudflare-nov-2025-outage** (4/5): Most slides use tight phrases well suited to spoken delivery (e.g. slide 5 'Spike, Recover, Fail'). Slide 2 pairs each heading with a full sentence which is slightly heavy, and slide 10's comparison bullets border on dense, but nothing approaches a wall of text. Generally well-calibrated.
- **wikipedia-zero-knowledge-proof** (4/5): Most list slides use short labelled phrases suited to speaking (e.g. slide 5 'The Odds / Without the word, she guesses correctly only 50%'). A few slides carry five items plus a subtitle (slides 17, 21), edging toward dense, and the kpi slide 10 formatting ('1/2 ^100') is awkward, but nothing constitutes a wall of text.

### Faithfulness (4.00)

- **asml-q4-2024** (2/5): Slide 3 states net income '-2.6% vs 2023', but €7,572M vs €7,839M is actually a -3.4% decline — a miscalculated derived figure. Other numbers (28.3B, +2.5%, 5.7B cash increase, dividend figures) trace correctly, but this wrong percentage caps the dimension.
- **cbs-persbericht-criminaliteit** (5/5): Figures trace accurately: 20%/3 miljoen and 11/7/7% (slide 4), -3/+2/+9% police deltas (slide 6), 29% vs 13% urbanity (slide 8), Amsterdam 63 / Staphorst 6 (slide 9), 17% online and 7,9% aankoopfraude (slide 11). The 17% uses the source's rounded text figure (chart shows 16,8) and stedelijkheid values rounded (13,6->14) are labelled and defensible; no fabrications found.
- **cloudflare-nov-2025-outage** (5/5): Figures are traceable and accurate: 200 feature limit and ~60 in use (slide 12), 11:05/11:28/14:30/17:06 timeline (slide 14), 'worst outage since 2019' (slide 16). The Prince quote on slide 7 combines two genuine source phrases ('An outage like today is unacceptable' and 'We know we let you down today') though it presents them as one continuous quote; both are verbatim from the source so this is minor.
- **wikipedia-zero-knowledge-proof** (4/5): Figures are well-grounded: 96% under-constrained bugs (slide 22), 0.5 cheating odds per round, 2^-n soundness, Cloudflare 2021, GMR quote (slide 15) all match the source. Minor risks: slide 24 dates 'All of NP has ZK proofs' to 1986 (the source cites the GMW journal paper without a clean year), and slide 18 labels two distinct entries both '2016', which could mislead. No outright fabrications.

## Top issue per case

- **asml-q4-2024**: Verify all derived percentages against the source figures — the net income change on slide 3 is stated as -2.6% but should be -3.4% (€7,572M vs €7,839M).
- **cbs-persbericht-criminaliteit**: Fix rendering artifacts like the stray 'on' fragment on slide 9 and tighten dense list/timeline slides (3 and 5) into short phrases rather than heading+sentence pairs.
- **cloudflare-nov-2025-outage**: Tighten slide 2's paired sentences into phrases and verify the slide 7 quote is not presented as a single continuous utterance when it is stitched from two separate source sentences.
- **wikipedia-zero-knowledge-proof**: Reposition the History slide (24) so origins appear before or within the theory section rather than after modern systems, and give the red-card/Where's-Waldo examples brief slide presence rather than burying them in notes.

## Cost breakdown

| Category | Calls | Input | Output | Cache write | Cache read | USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | 20 | 878566 | 34167 | 0 | 0 | $5.2470 |
| judge | 4 | 557564 | 7644 | 0 | 0 | $2.9789 |
| **Total** | 24 | 1436130 | 41811 | 0 | 0 | **$8.2259** |
