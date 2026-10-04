# AI suite run `2026-10-04_12-13-40`

- **Date**: 2026-10-04T12:13:40.107Z
- **Generation**: `claude` / `claude-opus-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `ae5c7c4bae88`
- **Cases**: 3 (deckyard-readme, nl-kamerbrief-duurzame-digitalisering, philips-q4-2024)
- **Repeats per case**: 1
- **API cost**: $3.7544

Compared against run `2026-10-04_12-04-02` (prompt version `ae5c7c4bae88`).

No prompt files changed since then — differences are run-to-run variance.

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.67 | ▼ -0.33 |
| Structure | 5.00 | · 0.00 |
| Slide economy | 3.67 | · 0.00 |
| Faithfulness | 4.00 | ▲ +0.33 |
| Presentability | 4.33 | ▲ +0.66 |
| **Overall** | **4.33** | · +0.13 |

> **Regression warning.** These dimensions moved down:
> - Coverage (-0.33)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deckyard-readme | B | 24 | 43.63 | 1 | 100% | 5/5 | 4.40 |
| nl-kamerbrief-duurzame-digitalisering | B | 13 | 34.69 | 0 | 100% | 4/5 | 4.00 |
| philips-q4-2024 | A | 24 | 46.71 | 5 | 98% | 5/5 | 4.60 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (3.67)

- **deckyard-readme** (4/5): Most slides use crisp label+phrase pairs well suited to speaking, and heavy detail is pushed to presenter notes. Slide 3 (icon-card-grid) carries four cards plus a subtitle and borders on dense, and slide 8's two-column install lists run long; trimming the sub-bullets to keywords would help.
- **nl-kamerbrief-duurzame-digitalisering** (3/5): Slide 3 crams seven labelled blocks (three oorzaken plus three gemiste kansen, each with a sub-sentence) into one slide, and slide 11 lists six items — both read as walls for a single spoken slide. Split slide 3 into oorzaken vs. gemiste kansen, or move detail to notes.
- **philips-q4-2024** (4/5): Most slides use crisp label-value pairs with detail pushed to presenter notes. A few are dense: slide 17 crams six partnerships each with sub-descriptions, and slide 22 lists six outlook items. Trimming slide 17 to the strongest partnerships would improve spoken delivery.

### Faithfulness (4.00)

- **deckyard-readme** (4/5): Numbers are accurate (34 types, 27 tools, 7 prompts, PostgreSQL 14+, the four AI providers). The comparison on slide 6 collapses both competitor columns into 'Others' and marks Embed SDK as 'No' when the source had Google Slides as 'Limited' — a small loss of nuance rather than a fabrication; keep the two competitor columns distinct.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Dates and attributions are accurate (Actieplan juni 2024, Kamerbrief 20 maart 2025, State of the Digital Decade 2025). Slide 7's 'Meetbare prestaties — Sturen op energie- en milieuprestaties van de sector' is an extrapolation not stated in the letter; tie it explicitly to the motions or soften it. No invented figures.
- **philips-q4-2024** (4/5): Figures are overwhelmingly accurate (e.g. slide 8's EUR 963m tax, EUR 941m deferred-tax derecognition, EUR 1.39 adjusted EPS all check out). However slide 4 claims order intake is 'Back to growth after four quarters of decline,' which is wrong: Q2 2024 order intake was +9% (source statistics table), so the four-consecutive-decline framing is an overstatement that should be corrected.

### Presentability (4.33)

- **deckyard-readme** (4/5): Titles are meaningful and slides stand alone (e.g. slide 10 'MCP and AI Agents — The part no competitor has'). The table on slide 6 contains a stray 'on' fragment (leaked from the subtitle 'Versus … on'), which should be cleaned up before presenting.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Titles carry meaning ('Doel 1: de digitale sector wordt duurzaam Europees koploper') and slides stand alone; register suits a government policy briefing. Light trimming of slides 3 and 11 is the only real edit needed before presenting.
- **philips-q4-2024** (5/5): Titles carry meaning and work standalone ('Margin Expansion Through the Year', 'Resilient margins despite China headwind'), register suits an investor audience, and slides are usable after light editing. Presenter notes add genuine context (e.g. royalty phasing linked to weak Q1 2025 guidance).

## Top issue per case

- **deckyard-readme**: Fix the comparison slide (6): remove the stray 'on' artifact and keep the two competitor columns ('Gamma/Tome/Beautiful.ai' vs 'Google Slides + Gemini') distinct instead of merging them into 'Others', so the Limited/No distinctions from the source table survive.
- **nl-kamerbrief-duurzame-digitalisering**: Reduce text density on the busiest slides (notably slide 3's seven blocks and slide 11's six items) by splitting or pushing detail into presenter notes, and add explicit mention of the openstaande moties in the execution section.
- **philips-q4-2024**: Correct the slide 4 (and presenter note) claim that order intake returned to growth 'after four quarters of decline' — the source shows Q2 2024 order intake was +9%, so verify sequential claims against the quarterly statistics table before asserting streaks.

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `claude-opus-5` | 19 | 393351 | 54289 | 0 | 0 | $3.3240 |
| judge | `claude-opus-4-8` | 3 | 54633 | 6290 | 0 | 0 | $0.4304 |
| **Total** | | 22 | 447984 | 60579 | 0 | 0 | **$3.7544** |
