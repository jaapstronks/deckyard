# AI suite run `2026-10-04_12-04-02`

- **Date**: 2026-10-04T12:04:02.175Z
- **Generation**: `claude` / `claude-sonnet-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `ae5c7c4bae88`
- **Cases**: 3 (deckyard-readme, nl-kamerbrief-duurzame-digitalisering, philips-q4-2024)
- **Repeats per case**: 1
- **API cost**: $2.4019

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 5.00 | — |
| Structure | 5.00 | — |
| Slide economy | 3.67 | — |
| Faithfulness | 3.67 | — |
| Presentability | 3.67 | — |
| **Overall** | **4.20** | — |

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deckyard-readme | B | 30 | 42.1 | 1 | 89% | 5/5 | 4.40 |
| nl-kamerbrief-duurzame-digitalisering | B | 14 | 32.21 | 0 | 100% | 5/5 | 4.00 |
| philips-q4-2024 | A | 25 | 36.72 | 0 | 98% | 5/5 | 4.20 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (3.67)

- **deckyard-readme** (4/5): Most list slides use tidy label-plus-phrase pairs suitable for speaking. Slide 15 ('27 Tools') crams 8 tool entries, pushing toward a wall; splitting it or showing a representative subset would present better.
- **nl-kamerbrief-duurzame-digitalisering** (3/5): Slide 9's two bullets are cut off mid-sentence ('verduurzaming...' and 'circulaire...'), which reads as unfinished text rather than spoken-friendly phrasing. Slide 12 crams six items including filler ('Internationale positie: Bevestigt de koploperspositie'); it should consolidate to 3-4 distinct points.
- **philips-q4-2024** (4/5): KPI slides (e.g. slides 3,7,15) and label-plus-phrase list slides (slide 4,13) are appropriately terse for spoken delivery. Slide 22 crams six guidance items which is slightly dense, and including '6% 2023 comparable sales growth' as a headline KPI on slide 8 is an odd backward-looking filler metric; otherwise economy is strong.

### Faithfulness (3.67)

- **deckyard-readme** (4/5): Figures (34 slide types, 27 tools, 7 prompts) and the comparison table are accurate to the source, and DeepSeek on slide 4 is traceable to the config block. Deduct for the stray 'on' fragment in slide 9's table body, a rendering artifact that reads as a spurious value.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Content is traceable to the source with no fabricated figures. Minor padding appears on slide 12 ('Bevestigt de koploperspositie van Nederland') and slide 13's claim the SIIA was 'Ontwikkeld door de NCDD' is a reasonable inference from footnote 10 but slightly firmer than the source states.
- **philips-q4-2024** (3/5): Nearly all figures are traceable and accurate, but slide 18 states Mature geographies are 'Now 74% of group sales FY2024' when 13,159/18,021 = 73%, a derived figure that is both not in the source and miscalculated. The generator should avoid introducing computed percentages unless verified; remove or correct this.

### Presentability (3.67)

- **deckyard-readme** (4/5): Titles carry meaning (e.g. 'How Deckyard Compares', 'One-Command Quick Start') and slides stand alone with useful presenter notes. The malformed 'Deckyard vs. Gamma/Tome vs. Google Slides / on' header on slide 9 needs a quick fix before presenting.
- **nl-kamerbrief-duurzame-digitalisering** (3/5): Titles are meaningful and slides largely stand alone, but slide 9's truncated bullets would require rewriting before presenting, and slide 14's title is an over-long full sentence rather than a punchy payoff. Light-to-moderate editing needed.
- **philips-q4-2024** (4/5): Titles carry meaning ('Productivity Program Ahead of Plan', 'Respironics Recall Resolution') and slides work standalone. Presenter notes add useful context (e.g. slide 17 explaining the net-income decline is a tax story). Minor polish needed on slide 8's filler KPI and slide 18's figure before presenting.

## Top issue per case

- **deckyard-readme**: Fix the table-slide rendering (slide 9 has a stray 'on' fragment) and cap dense list slides like slide 15 to ~5-6 items so each slide reads cleanly when spoken.
- **nl-kamerbrief-duurzame-digitalisering**: Ensure bullet text is never truncated with ellipses (slide 9) — generate complete, concise phrases that fit the slide instead of cutting sentences mid-word.
- **philips-q4-2024**: Verify every derived/computed figure against the source before including it; slide 18's '74% of group sales' is actually 73% and not stated in the source. Prefer quoting source numbers over introducing calculated ratios.

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| topics | `claude-opus-4-8` | 3 | 36051 | 2407 | 0 | 0 | $0.2404 |
| generation | `claude-sonnet-5` | 24 | 504758 | 75760 | 0 | 0 | $1.7671 |
| judge | `claude-opus-4-8` | 3 | 53100 | 5156 | 0 | 0 | $0.3944 |
| **Total** | | 30 | 593909 | 83323 | 0 | 0 | **$2.4019** |
