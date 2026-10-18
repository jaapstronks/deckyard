# AI suite run `2026-10-18_10-23-29`

- **Date**: 2026-10-18T10:23:29.584Z
- **Generation**: `claude` / `claude-opus-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `4102730f87a4`
- **Cases**: 3 (deckyard-readme, nl-kamerbrief-duurzame-digitalisering, philips-q4-2024)
- **Repeats per case**: 3
- **API cost**: $9.9525

Compared against run `2026-10-18_09-32-08` (prompt version `70da2d90d200`).

Prompt files changed since then:
- `server/utils/ai/prompts/base/refine-slides.js`
- `server/utils/ai/refine-slides.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 5.00 | · 0.00 |
| Structure | 4.78 | · +0.11 |
| Slide economy | 4.00 | · +0.11 |
| Faithfulness | 4.67 | ▼ -0.22 |
| Presentability | 4.33 | · +0.11 |
| **Overall** | **4.56** | · +0.03 |

> **Regression warning.** These dimensions moved down:
> - Faithfulness (-0.22)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deckyard-readme | B | 23 | 49.22 | 2 | 100% | 5/5 | 4.47 |
| nl-kamerbrief-duurzame-digitalisering | B | 11 | 40.09 | 0 | 100% | 5/5 | 4.53 |
| philips-q4-2024 | A | 23 | 41.7 | 0 | 100% | 5/5 | 4.67 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (4.00)

- **deckyard-readme** (4/5): Most list/grid slides use crisp label+phrase pairs, but a few are crowded: slide 21 packs five deployment items plus a two-line caption, and slide 5's table spans seven rows across four columns. Consider splitting deployment into two slides or trimming the comparison rows to the most differentiating ones.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Most slides are well-trimmed phrases, but slide 2 ('De twin transition — kansen die blijven liggen') packs a lead line, three sub-bulleted pairs, and a closing koplopers sentence, making it the densest on-slide text. Splitting the koplopers examples out or cutting a sub-bullet would tighten it.
- **philips-q4-2024** (4/5): KPI and table slides (3,5,9,17,20) are well-calibrated for speaking. Slide 22 crams dividend amount, cash cap, full timetable and balance sheet into one list, and slide 11's trailing 'Other segment' line feels bolted on; these could be split or trimmed.

### Presentability (4.33)

- **deckyard-readme** (4/5): Titles carry meaning ('27 tools across the presentation lifecycle', 'Forking and staying in sync') and slides stand alone. Minor issue: slide 3's list mixes a lead tagline with four themed pairs in a way that could read awkwardly standalone, and some presenter notes are far longer than needed, which a presenter will have to prune.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Titles carry meaning ('Drie knelpunten voor Nederlandse koplopers', 'Twee doelen voor 2026-2028') and slides stand alone. Minor edit needed on slide 2's density; otherwise presentable with light polishing.
- **philips-q4-2024** (4/5): Titles carry meaning (e.g. 'Net result weighed down by tax', 'Mature versus Growth geographies') and slides stand alone. However slide 6 contains a stray 'lime' token (a leaked color/style attribute) that would appear as orphaned body text and must be removed before presenting.

### Faithfulness (4.67)

- **deckyard-readme** (5/5): All figures trace to the source: '34 typed slide types', '27 tools', '7 prompts', the DEEPSEEK_API key (slide 19), 'ten more locales' (slide 4), and the install command are all accurate. No invented numbers or overstated claims detected.
- **nl-kamerbrief-duurzame-digitalisering** (5/5): All claims trace to the source: dates (17 jun 2024, 20 mrt 2025), Kamerstuk 26 643 nr. 1327, the four motie numbers, SIIA 2025, and the Competitiveness Compass reference in slide 3 notes are all accurate. No invented figures or overstated claims.
- **philips-q4-2024** (5/5): Spot-checked figures all trace to the source: slide 4 (IFO 529 vs -115, Adj EBITA 2,077/679), slide 6 (tax up EUR 1,036m, EPS 1.39 from 1.21), slide 19 (Respironics 984/133/113/538, EUR 367m cash), slide 22 (net debt 5,238, 30:70 from 33:67). No fabricated numbers found.

## Top issue per case

- **deckyard-readme**: Reduce on-slide density on the busiest slides (notably the deployment slide 21 and the comparison table on slide 5) by splitting content or dropping lower-value rows, so each slide carries a single, scannable idea.
- **nl-kamerbrief-duurzame-digitalisering**: Lighten slide 2 by moving the koplopers examples (datacenter cooling, AI for the grid, laptop reuse) into their own element or notes so the opening problem slide isn't carrying a lead line, three bullet pairs, and a trailing sentence at once.
- **philips-q4-2024**: Remove leaked styling artifacts like the stray 'lime' token on slide 6, and run a cleanup pass so no template/color attributes appear as slide body text.

## Variance across repeats

| Case | Mean scores per repeat | Spread |
| --- | --- | ---: |
| deckyard-readme | 4.60, 4.40, 4.40 | 0.20 |
| nl-kamerbrief-duurzame-digitalisering | 4.60, 4.60, 4.40 | 0.20 |
| philips-q4-2024 | 4.60, 4.80, 4.60 | 0.20 |

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `claude-opus-5` | 91 | 406564 | 229214 | 74684 | 1518604 | $8.9892 |
| judge | `claude-opus-4-8` | 9 | 46437 | 17845 | 39303 | 78606 | $0.9633 |
| **Total** | | 100 | 453001 | 247059 | 113987 | 1597210 | **$9.9525** |
