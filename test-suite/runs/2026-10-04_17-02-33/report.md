# AI suite run `2026-10-04_17-02-33`

- **Date**: 2026-10-04T17:02:33.099Z
- **Generation**: `claude` / `claude-sonnet-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `bae9fb0221f4`
- **Cases**: 3 (deckyard-readme, nl-kamerbrief-duurzame-digitalisering, philips-q4-2024)
- **Repeats per case**: 1
- **API cost**: $2.6189

Compared against run `2026-10-04_16-48-11` (prompt version `0f28db77e20b`).

Prompt files changed since then:
- `server/utils/ai/generate-outline.js`
- `server/utils/ai/prompts/base/outline.js`
- `server/utils/ai/revise-outline.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.67 | ▼ -0.33 |
| Structure | 4.67 | ▲ +0.67 |
| Slide economy | 4.00 | ▲ +0.33 |
| Faithfulness | 5.00 | ▲ +1.33 |
| Presentability | 4.00 | · 0.00 |
| **Overall** | **4.47** | ▲ +0.40 |

> **Regression warning.** These dimensions moved down:
> - Coverage (-0.33)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deckyard-readme | B | 23 | 46.43 | 1 | 100% | 4/5 | 4.40 |
| nl-kamerbrief-duurzame-digitalisering | B | 12 | 43.92 | 0 | 100% | 5/5 | 4.60 |
| philips-q4-2024 | A | 24 | 37.58 | 0 | 98% | 5/5 | 4.40 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (4.00)

- **deckyard-readme** (4/5): Most slides use crisp label+phrase pairs well suited to speaking. But slide 22 (text-blocks) crams four change/effect pairs into a wall, and slide 9's five-column table is dense; the comparison would read better collapsed to Deckyard vs. 'competitors' rather than one column per rival.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Most slides use phrases, but slides 3 and 7 carry both a subtitle AND a descriptive sentence per bullet (e.g. slide 7's six items each with an explanatory clause), nudging toward wall-of-text; trim to the label plus a keyword so the speaker fills in the rest.
- **philips-q4-2024** (4/5): Most KPI and list slides are well-calibrated for spoken delivery. Slide 23 'Financial Statements Detail' crams four unrelated metrics (gross margin, net income, total assets, cash) and risks feeling like a data dump; consider splitting or trimming to the two most relevant figures.

### Presentability (4.00)

- **deckyard-readme** (4/5): Titles carry meaning ('Storage: Postgres-Only Since v1.x', 'Built for AI Agents') and slides stand alone. Slide 23's title is a full run-on sentence that would work better as a short payoff line, and the stray icon tokens ('mist' on slide 22, 'comfortable' on slide 19) are artifacts a presenter would need to clean up.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Titles carry meaning and slides stand alone (e.g. 'Twee hoofddoelen van het programma', 'Vier moties verwerkt'). Minor polish needed: slide 10 crams the SIIA note under the moties list where it belongs thematically with slide 4's praktijkvoorbeelden, slightly muddling that slide's focus.
- **philips-q4-2024** (4/5): Titles carry meaning (e.g. 'Growth achieved despite a double-digit sales decline in China') and slides stand alone. The payoff slide 24 uses a full-sentence title which is a reasonable closer, though the deck could tighten register on slide 10's note hedging ('solid but not purely organic').

### Coverage (4.67)

- **deckyard-readme** (4/5): All essential topics present: slides 6-8 cover presenter/developer/agent benefits, slide 9 the comparison, slides 11-13 install, slide 17 the AI pipeline, slide 22 PostgreSQL. However, the CC0 1.0 public-domain dedication of the deck-format spec is dropped — slide 23 mentions only MIT, missing the dual-licensing distinction the source closes on.
- **nl-kamerbrief-duurzame-digitalisering** (5/5): All essential and supporting topics appear: twin transition (slide 3), Europees koploper and AI innovatiemotor (slide 8), NCDD/publiek-private samenwerking (slides 4,9), monitoring (slide 7), datacenters (slide 8), DPP (slide 8), four moties (slide 10), SIIA (slide 10), and interdepartementale penvoering (slide 9). Nothing material from the source is omitted.
- **philips-q4-2024** (5/5): All twelve key topics are present, from the headline FY sales of EUR 18.0bn and 90bps margin expansion (slides 3-4) to supporting items like balance sheet strength (slide 23) and leadership renewal (slide 15). The '+4% excluding China' framing (slide 8) correctly surfaces the source's key narrative device.

## Top issue per case

- **deckyard-readme**: Collapse multi-column comparison and dense text-block slides (9, 22) into tighter Deckyard-vs-field framings, and add the CC0 format-spec point to the closing license message.
- **nl-kamerbrief-duurzame-digitalisering**: Reduce per-bullet prose on list slides (notably slides 3 and 7): keep the short label and one keyword, moving the explanatory sentence into presenter notes so slides read as spoken cues rather than paragraphs.
- **philips-q4-2024**: Thin out the dense 'Financial Statements Detail' slide (23) into either a cleaner balance-sheet-strength message or two focused slides, and relocate the dividend slides out of the 2025 Outlook chapter into a dedicated capital-allocation grouping.

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `claude-sonnet-5` | 30 | 639220 | 94052 | 0 | 0 | $2.2190 |
| judge | `claude-opus-4-8` | 3 | 53539 | 5288 | 0 | 0 | $0.3999 |
| **Total** | | 33 | 692759 | 99340 | 0 | 0 | **$2.6189** |
