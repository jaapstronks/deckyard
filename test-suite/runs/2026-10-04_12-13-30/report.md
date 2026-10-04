# AI suite run `2026-10-04_12-13-30`

- **Date**: 2026-10-04T12:13:30.462Z
- **Generation**: `claude` / `claude-sonnet-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `8891b874efba`
- **Cases**: 3 (deckyard-readme, nl-kamerbrief-duurzame-digitalisering, philips-q4-2024)
- **Repeats per case**: 1
- **API cost**: $2.8721

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 5.00 | — |
| Structure | 4.67 | — |
| Slide economy | 3.00 | — |
| Faithfulness | 4.67 | — |
| Presentability | 3.33 | — |
| **Overall** | **4.13** | — |

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deckyard-readme | B | 29 | 40.1 | 0 | 89% | 5/5 | 4.20 |
| nl-kamerbrief-duurzame-digitalisering | B | 16 | 32.44 | 0 | 100% | 5/5 | 4.00 |
| philips-q4-2024 | A | 37 | 32.86 | 0 | 100% | 5/5 | 4.20 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (3.00)

- **deckyard-readme** (3/5): Several slides push toward wall-of-text: slide 19's storage cards carry full two-sentence explanations, and slide 28 crams four governance sub-points. Tighten card bodies to phrases (e.g. slide 19 'Refuses to start without a migrated DB' rather than the full sentence) so the spoken delivery carries the detail.
- **nl-kamerbrief-duurzame-digitalisering** (2/5): Multiple slides contain sentences truncated mid-thought with trailing ellipses: slide 3 'om het...', slide 5 'wil Nederland...' and 'een geslaagde...', slide 13 '...'. These read as broken copy rather than deliberate bullets. The generator should have produced complete, concise phrases that fit the slide rather than cutting full sentences.
- **philips-q4-2024** (4/5): KPI slides (3-5, 20, 22-23) are appropriately spare with figure+label pairs. A few list slides are denser (slide 36 packs four distinct items spanning leverage, cash and two geographies), and slide 11's table is efficient. Generally well-judged for spoken delivery.

### Presentability (3.33)

- **deckyard-readme** (3/5): Two visible defects need fixing: slide 10 contains a stray 'on' artifact dangling in the table header area, and slide 18's subtitle is truncated mid-sentence ('can self-install non-interactively via...'). Clean up these fragments so slides read as finished; otherwise titles are meaningful and standalone.
- **nl-kamerbrief-duurzame-digitalisering** (3/5): Titles carry meaning (e.g. 'Doel 1: Europees koploper in duurzame digitalisering') and presenter notes are helpful, but the truncated sentences on slides 3, 5 and 13 undermine standalone readability and would confuse an audience; these need completion before presenting, more than 'light' editing.
- **philips-q4-2024** (4/5): Titles are meaningful and slides work standalone, but two slides end mid-sentence: slide 7's quote is cut off with 'relating to the R...' and slide 37's payoff title reads 'deliver pr'. These truncations would need fixing before presenting.

### Structure (4.67)

- **deckyard-readme** (5/5): Clean arc: title/overview (1-5), audience breakdown 'Why Deckyard' (6-10), MCP deep-dive (11-16), Getting Started & Operations (17-22), Customization & Governance (23-28), and a payoff close (29). Chapter-title slides correctly group material the way the README decomposes it.
- **nl-kamerbrief-duurzame-digitalisering** (5/5): Strong arc: urgentie (slides 2-5) -> actieprogramma with problem-then-pillars-then-two-goals (slides 6-11) -> samenwerking/uitvoering/close (slides 12-16). The timeline on slide 7 sensibly situates the programme as a follow-up, and goals are cleanly separated into Doel 1 and Doel 2.
- **philips-q4-2024** (4/5): Strong arc: highlights -> group/segment -> innovation -> leadership/productivity -> outlook -> Respironics -> capital allocation/financials -> payoff. Minor quibble: the Respironics settlement chapter (slides 27-29) lands after the 2025 outlook even though the outlook (slide 23, 25) already references the settlement, so detail arrives later than first needed.

## Top issue per case

- **deckyard-readme**: Fix rendering/truncation artifacts (the stray 'on' on slide 10 and the cut-off 'via...' sentence on slide 18) and trim multi-sentence card bodies on slides 19 and 28 to presenter-friendly phrases.
- **nl-kamerbrief-duurzame-digitalisering**: Eliminate mid-sentence truncation: several slides (3, 5, 13) end bullet text with '...' where a full sentence was cut off—generate complete, self-contained phrases sized to the slide instead.
- **philips-q4-2024**: Fix truncated on-slide text (the quote on slide 7 and the payoff title on slide 37 both cut off mid-word) and avoid placing invented specific figures like the '-10%' China estimate on slide 9 when the source only states 'double-digit decline'.

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `claude-sonnet-5` | 32 | 641671 | 99915 | 0 | 0 | $2.2825 |
| judge | `claude-opus-4-8` | 3 | 56803 | 4710 | 0 | 0 | $0.4018 |
| topics | `claude-opus-4-8` | 2 | 29350 | 1641 | 0 | 0 | $0.1878 |
| **Total** | | 37 | 727824 | 106266 | 0 | 0 | **$2.8721** |
