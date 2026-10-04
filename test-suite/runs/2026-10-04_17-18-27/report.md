# AI suite run `2026-10-04_17-18-27`

- **Date**: 2026-10-04T17:18:27.819Z
- **Generation**: `claude` / `claude-opus-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `f9cea87eeb6e`
- **Cases**: 1 (philips-q4-2024)
- **Repeats per case**: 1
- **API cost**: $2.0391

Compared against run `2026-10-04_17-03-37` (prompt version `bae9fb0221f4`).

Prompt files changed since then:
- `server/utils/ai/prompts/base/outline.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 5.00 | · 0.00 |
| Structure | 5.00 | · 0.00 |
| Slide economy | 4.00 | · 0.00 |
| Faithfulness | 4.00 | ▼ -1.00 |
| Presentability | 4.00 | · 0.00 |
| **Overall** | **4.40** | ▼ -0.20 |

> **Regression warning.** These dimensions moved down:
> - Faithfulness (-1.00)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| philips-q4-2024 | A | 23 | 52 | 3 | 100% | 5/5 | 4.40 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (4.00)

- **philips-q4-2024** (4/5): KPI slides are clean and spoken-presentation-friendly. Slide 4's table carries six dense rows with footnoted comparisons, and slide 16 packs six partnership/trial items; these verge on reference-sheet density. Presenter notes correctly hold the narrative off the slide face.

### Faithfulness (4.00)

- **philips-q4-2024** (4/5): Figures are overwhelmingly accurate and traceable (e.g. EUR 941m deferred-tax derecognition on slide 4, EUR 984m/133m/113m/538m Respironics breakdown on slide 19). One misattribution: slide 10 states 'IP Royalties Adjusted EBITA EUR 328 million, up EUR 55 million' — the EUR 55m improvement is the whole Other segment; IP Royalties alone rose EUR 19m (309->328).

### Presentability (4.00)

- **philips-q4-2024** (4/5): Titles carry meaning and slides work standalone (e.g. 'Q4 2024 and the below-the-line picture' frames the tax distortion well). A stray template token 'lime' appears as body text on slide 13, which a presenter would need to delete; otherwise register and standalone clarity are good.

## Top issue per case

- **philips-q4-2024**: Remove leftover template artifacts (the orphan 'lime' token on slide 13) and tighten attribution — fix slide 10 so the EUR 55m Adjusted EBITA gain is credited to the Other segment, not IP Royalties alone (which rose EUR 19m).

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `claude-opus-5` | 9 | 221697 | 27489 | 0 | 0 | $1.7957 |
| judge | `claude-opus-4-8` | 1 | 32937 | 3148 | 0 | 0 | $0.2434 |
| **Total** | | 10 | 254634 | 30637 | 0 | 0 | **$2.0391** |
