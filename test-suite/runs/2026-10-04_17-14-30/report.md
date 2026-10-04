# AI suite run `2026-10-04_17-14-30`

- **Date**: 2026-10-04T17:14:30.255Z
- **Generation**: `claude` / `claude-sonnet-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `f9cea87eeb6e`
- **Cases**: 3 (deckyard-readme, nl-kamerbrief-duurzame-digitalisering, philips-q4-2024)
- **Repeats per case**: 1
- **API cost**: $2.7168

Compared against run `2026-10-04_17-02-33` (prompt version `bae9fb0221f4`).

Prompt files changed since then:
- `server/utils/ai/prompts/base/outline.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 5.00 | ▲ +0.33 |
| Structure | 4.67 | · 0.00 |
| Slide economy | 4.00 | · 0.00 |
| Faithfulness | 3.67 | ▼ -1.33 |
| Presentability | 4.00 | · 0.00 |
| **Overall** | **4.27** | ▼ -0.20 |

> **Regression warning.** These dimensions moved down:
> - Faithfulness (-1.33)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deckyard-readme | B | 23 | 44.83 | 0 | 89% | 5/5 | 4.40 |
| nl-kamerbrief-duurzame-digitalisering | B | 11 | 34.82 | 0 | 100% | 5/5 | 4.00 |
| philips-q4-2024 | A | 23 | 41.17 | 1 | 100% | 5/5 | 4.40 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Faithfulness (3.67)

- **deckyard-readme** (4/5): Figures are accurate (34 slide types, 27 tools, 7 prompts, PostgreSQL 14+, ports 4177/80/443). The stray 'mist' fragment at the bottom of slide 21 is an untraceable artifact that should be removed, but no numbers or claims are fabricated.
- **nl-kamerbrief-duurzame-digitalisering** (2/5): Slide 5 misattributes 'Kamerstuk 26643-1327' to the 17 June 2024 Actieplan, but the source assigns 1327 (footnote 6) to the 20 March 2025 Kamerbrief, while the Actieplan has a different reference (footnote 7). This wrong attribution of a specific number caps faithfulness; otherwise content is traceable.
- **philips-q4-2024** (5/5): Spot-checks across financials are accurate: slide 9 segment margins (D&T 11.6%, CC 9.6%, PH 16.7%), slide 15 productivity split (47/56/59M = 163M), slide 20 EUR 786M cash cap, and slide 22 net debt EUR 5,238M down from EUR 5,820M all match the source. No fabricated figures found.

### Slide economy (4.00)

- **deckyard-readme** (4/5): On-slide text is generally well-sized for speaking (e.g. slide 11's KPI framing of 27/7). Slide 17 and 21 ('text-blocks') pack four labelled blocks each and edge toward dense; tightening to phrase-level labels would help.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Most slides use crisp label-plus-phrase pairs well suited to speech (e.g. slide 9's motie rows, slide 7's three actielijnen). Slide 7's intro sentence and slide 3 run slightly long, and the fuller content lives appropriately in presenter notes rather than on-slide.
- **philips-q4-2024** (4/5): KPI slides (3,4,15,17) use tight metric-plus-caption format well-suited to spoken delivery, and detail is correctly pushed to presenter notes. A few slides carry a redundant trailing sentence (e.g., slide 3 'Net cash flow... EUR 1,569 million' duplicating the notes), but no walls of text.

### Presentability (4.00)

- **deckyard-readme** (4/5): Titles carry meaning ('Deckyard vs the Market', 'One-Command Install') and slides stand alone. The orphan 'mist' token on slide 21 looks like an error that must be deleted before presenting, and slide 23's title is a full sentence better split into a short payoff plus the URL.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Titles carry meaning (e.g. slide 10 'Breed gedragen en internationaal erkend') and slides stand alone with useful presenter notes. Register suits a Kamerbrief briefing; only the citation error on slide 5 would need correcting before presenting.
- **philips-q4-2024** (4/5): Titles carry meaning (e.g., 'Growth outside China offset ongoing China weakness' on slide 8), slides work standalone, and register suits an investor audience. Minor blemish: slide 22 following the closing CEO quote disrupts flow, and slide 10's note referencing net income pressures 'discussed elsewhere' assumes a slide that comes later.

## Top issue per case

- **deckyard-readme**: Remove stray rendering artifacts like the orphan 'mist' token on slide 21 and ensure every bottom-line/footer string is intentional content traceable to the source.
- **nl-kamerbrief-duurzame-digitalisering**: Fix the citation handling on the timeline: Kamerstuk 26643-1327 belongs to the 20 March 2025 Kamerbrief, not the 17 June 2024 Actieplan—verify each number against its footnote before attributing it.
- **philips-q4-2024**: Relocate the net income and balance-sheet slide (22) to sit with the Q4/FY financial highlights early in the deck, rather than after the closing quote — the EUR 698M net loss is a headline-level fact that should not be buried near the end.

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `claude-sonnet-5` | 34 | 740845 | 85008 | 0 | 0 | $2.3318 |
| judge | `claude-opus-4-8` | 3 | 52799 | 4840 | 0 | 0 | $0.3850 |
| **Total** | | 37 | 793644 | 89848 | 0 | 0 | **$2.7168** |
