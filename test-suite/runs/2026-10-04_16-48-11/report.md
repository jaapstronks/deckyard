# AI suite run `2026-10-04_16-48-11`

- **Date**: 2026-10-04T16:48:11.605Z
- **Generation**: `claude` / `claude-sonnet-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `0f28db77e20b`
- **Cases**: 3 (deckyard-readme, nl-kamerbrief-duurzame-digitalisering, philips-q4-2024)
- **Repeats per case**: 1
- **API cost**: $2.9856

Compared against run `2026-10-04_12-24-56` (prompt version `8891b874efba`).

Prompt files changed since then:
- `server/utils/ai/generate-outline.js`
- `server/utils/ai/prompts/base/outline.js`
- `server/utils/ai/prompts/base/refine-slides.js`
- `server/utils/ai/refine-slides.js`
- `server/utils/ai/revise-outline.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 5.00 | · 0.00 |
| Structure | 4.00 | ▼ -0.67 |
| Slide economy | 3.67 | ▲ +0.34 |
| Faithfulness | 3.67 | ▼ -1.00 |
| Presentability | 4.00 | · 0.00 |
| **Overall** | **4.07** | ▼ -0.26 |

> **Regression warning.** These dimensions moved down:
> - Structure (-0.67)
> - Faithfulness (-1.00)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deckyard-readme | B | 24 | 45.04 | 0 | 100% | 5/5 | 3.80 |
| nl-kamerbrief-duurzame-digitalisering | B | 11 | 37.82 | 0 | 100% | 5/5 | 4.20 |
| philips-q4-2024 | A | 25 | 42 | 1 | 100% | 5/5 | 4.20 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (3.67)

- **deckyard-readme** (3/5): Several slides are overloaded for spoken delivery: slide 13 crams seven tool names into one card, slide 21 lists five deployment variants, and slide 22's two-column comparison is dense. These should be trimmed to headline phrases, letting the (already detailed) speaker notes carry specifics.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Most slides are well-paced, but slides 8 and 9 pack full sentences into each bullet (e.g. slide 8 'Ondernemers koelen datacenters efficiënter, innovators benutten AI voor het stroomnet, stichtingen hergebruiken laptops'), reading more like prose than talking points. Trim to phrases and push detail into presenter notes.
- **philips-q4-2024** (4/5): KPI slides (3,4,8,10,23) are clean and well-suited to spoken delivery. Slide 14 is denser with five rows mixing segment and geography, and some subtitle lines (e.g. slide 16's back-end-loaded caption) run long, but nothing approaches a wall of text.

### Faithfulness (3.67)

- **deckyard-readme** (3/5): Slide 9 overstates the comparison: the source marks competitors' custom themes and Google's Embed SDK as 'Limited', but the deck renders every competitor cell as flat 'No', hardening a nuanced claim. Fix by preserving 'Limited' where the source uses it. Elsewhere the deck is honest (slide 14 correctly flags it shows only 5 of 7 prompts).
- **nl-kamerbrief-duurzame-digitalisering** (3/5): Slide 4 misattributes 'Kamerstuk 26 643, nr. 1327' to the 17 juni 2024 Actieplan, but in the source (footnote 6) that number belongs to the 20 maart 2025 Kamerbrief; the Actieplan is cited under footnote 7. Otherwise claims are traceable (four Kathmann/Teunissen moties, best-practice via State of the Digital Decade 2025). Fix the citation mapping.
- **philips-q4-2024** (5/5): All figures trace to the source and are accurate: e.g. slide 5's net loss explanation ties to the 'EUR 581 million' tax increase, slide 8's 'EUR 367 million Respironics insurance proceeds', slide 23's EUR 163M savings breakdown (47/56/59). No fabricated numbers or overstated claims detected.

### Structure (4.00)

- **deckyard-readme** (4/5): Clear arc with chapter dividers (slides 2, 5, 10, 16) and a payoff close, mirroring the source's own sections. Minor awkwardness: slide 4 'AI on Your Terms, Try It Now' bolts the sandbox/try-it CTA onto the AI-control message, two ideas that would read better separated or placed at the end.
- **nl-kamerbrief-duurzame-digitalisering** (5/5): Clean arc: urgency (slides 2-3), origin timeline (slide 4), knelpunten-to-doelen body (slides 5-7), draagvlak and uitvoering (slides 8-9), ministerial quote and payoff (slides 10-11). The knelpunten->basisaanpak->twee doelen sequence mirrors the source's logic well.
- **philips-q4-2024** (3/5): The opening-body-close arc is sound, but segment detail is duplicated: slide 11 already presents all three segments (FY, Q4, margin), then slides 13 and 14 re-present the same segments with only marginally more detail. Consolidating these into one or two slides would remove the repetitive, table-of-contents feel.

## Top issue per case

- **deckyard-readme**: Preserve the source's exact qualifiers in the comparison table—render 'Limited' cells as 'Limited' rather than collapsing them to 'No'—and thin the densest slides (13, 21, 22) to headline phrases, pushing detail into the speaker notes.
- **nl-kamerbrief-duurzame-digitalisering**: Correct the citation on slide 4: Kamerstuk 26 643, nr. 1327 refers to the 20 March 2025 Kamerbrief, not the 17 June 2024 Actieplan — verify all reference numbers against their footnotes before placing them on timeline items.
- **philips-q4-2024**: Eliminate the segment-performance redundancy: slides 11, 13, and 14 cover the same three segments repeatedly—consolidate into a single comprehensive segment slide plus one geography slide so each data point appears once.

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| topics | `claude-opus-4-8` | 2 | 10375 | 1516 | 0 | 0 | $0.0898 |
| generation | `claude-sonnet-5` | 33 | 720913 | 102610 | 0 | 0 | $2.4679 |
| judge | `claude-opus-4-8` | 3 | 53872 | 6340 | 0 | 0 | $0.4279 |
| **Total** | | 38 | 785160 | 110466 | 0 | 0 | **$2.9856** |
