# AI suite run `2026-11-03_14-49-03`

- **Date**: 2026-11-03T14:49:03.809Z
- **Generation**: `claude` / `claude-opus-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `4193425011a6`
- **Cases**: 4 (probe-causal-icons-quote, probe-list-homogeneity, probe-process-timeline, probe-table-chart)
- **Repeats per case**: 3
- **API cost**: $4.6777

Compared against run `2026-11-03_14-48-31` (prompt version `8b6ed25f8901`).

Prompt files changed since then:
- `server/utils/ai/prompts/base/outline.js`
- `server/utils/ai/prompts/base/refine-slides.js`
- `shared/slide-types/types/list-slide/ai.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.58 | · +0.08 |
| Structure | 4.25 | · 0.00 |
| Slide economy | 4.17 | ▲ +0.17 |
| Faithfulness | 4.58 | · 0.00 |
| Presentability | 4.33 | · 0.00 |
| **Overall** | **4.38** | · +0.05 |

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| probe-causal-icons-quote | C | 5 | 38.4 | 0 | 100% | 5/5 | 4.47 |
| probe-list-homogeneity | C | 7 | 40.43 | 0 | 100% | 4/5 | 4.07 |
| probe-process-timeline | C | 5 | 40.8 | 0 | 100% | 5/5 | 4.60 |
| probe-table-chart | C | 5 | 26 | 0 | 100% | 5/5 | 4.40 |

## Specialised layout recall

Whether content whose shape calls for a laborious-to-build layout got it.

| Case | Recall | Missed | Fell back to |
| --- | ---: | --- | --- |
| probe-causal-icons-quote | 2/3 | `text-blocks-slide` | — |
| probe-process-timeline | 3/3 | — | — |
| probe-table-chart | 3/3 | — | — |

## Source lists kept whole

Whether a list the source enumerates arrives with exactly its members, no remarks about the list posing as items.

| Case | Repeat | List | Items / members | Strays |
| --- | ---: | --- | ---: | --- |
| probe-list-homogeneity | 1 | Doelgroepen | 3/3 | — |
| probe-list-homogeneity | 1 | Uitvoeringsorganisaties | missing (0/5 in one list) | — |
| probe-list-homogeneity | 2 | Doelgroepen | 3/3 | — |
| probe-list-homogeneity | 2 | Uitvoeringsorganisaties | missing (0/5 in one list) | — |
| probe-list-homogeneity | 3 | Doelgroepen | 3/3 | — |
| probe-list-homogeneity | 3 | Uitvoeringsorganisaties | missing (0/5 in one list) | — |

## Lists of one kind

A list claims its items are alike. Judged per list, apart from the rubric.

| Case | Repeat | Lists | Mixed | Not judged |
| --- | ---: | ---: | ---: | ---: |
| probe-causal-icons-quote | 1 | 3 | 1 | 0 |
| probe-causal-icons-quote | 2 | 2 | 1 | 0 |
| probe-causal-icons-quote | 3 | 2 | 0 | 0 |
| probe-list-homogeneity | 1 | 6 | 1 | 0 |
| probe-list-homogeneity | 2 | 4 | 1 | 0 |
| probe-list-homogeneity | 3 | 3 | 0 | 0 |
| probe-process-timeline | 1 | 3 | 0 | 0 |
| probe-process-timeline | 2 | 3 | 0 | 0 |
| probe-process-timeline | 3 | 3 | 0 | 0 |
| probe-table-chart | 1 | 2 | 0 | 0 |
| probe-table-chart | 2 | 2 | 0 | 0 |
| probe-table-chart | 3 | 2 | 0 | 0 |

- **probe-causal-icons-quote** repeat 1, slide 5 ("Impact if we act"): current metric, benchmark comparison, projected gain. Split these into our current status, the external benchmark, and the forecasted upside rather than presenting a status, a comparison, and an ambition as one metric set.
- **probe-causal-icons-quote** repeat 2, slide 5 ("What acting is worth"): current status metric, competitor benchmark, projected outcome. These answer different questions—today's completion rate, a comparable-products benchmark, and a conditional projection—so split them into current state versus the opportunity rather than presenting them as one set of metrics.
- **probe-list-homogeneity** repeat 1, slide 2 ("Van kennis naar toepassing"): finding/statistic, barrier, market trend. These answer different questions—a non-application statistic, a cost barrier, and an industry trend—so it should have listed one kind, e.g. the barriers the program addresses.
- **probe-list-homogeneity** repeat 2, slide 3 ("Waarom nu"): evaluation finding/signal, explanation of a cause, field trend. The 'Reden:' entry explains why the first signal occurs rather than being an independent signal, so it answers a different question; fold it into the finding it explains and keep only parallel signals as items.

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (4.17)

- **probe-causal-icons-quote** (5/5): Text is well-calibrated for speaking: slide 2 uses short label+phrase pairs ('Billing first / The signup form asks for payment before any value is shown') and slide 5 reduces metrics to numbers. No walls of text; the heavy exposition sits correctly in presenter notes.
- **probe-list-homogeneity** (4/5): Most slides are spoken-presentation friendly. Slide 2 is slightly overloaded, carrying an intro line, three bullets and a closing 'complementair' sentence; trimming the complementair line to a phrase would help. Slide 5's paired risk/maatregel labels read well.
- **probe-process-timeline** (4/5): Slides 3-5 use crisp label/phrase pairs well suited to speaking. Slide 2 still carries two full sentences ('has run patient intake on paper since 2011...') that could be reduced to a phrase like 'Paper since 2011 → digital across 14 clinics'.
- **probe-table-chart** (4/5): On-slide text is well-judged — the KPI and table slides use figures not prose, and slide 4 adds a single interpretive line ('Annual gains have stayed in a narrow 6–8 point band'). The slide 5 callout is one long compound sentence that could be trimmed to a headline phrase.

### Structure (4.25)

- **probe-causal-icons-quote** (4/5): Clean arc: problem (slide 2) -> customer voice (slide 3) -> solution (slide 4) -> impact (slide 5). The quote on slide 3 interrupts the logical flow from causal chain to its redesign answer; placing it after the principles or at the close might land harder, but the ordering is defensible.
- **probe-list-homogeneity** (4/5): Clean arc: problem (slide 2) -> doelgroepen -> systematiek -> risks -> budget/timeline -> besluit. Folding uitvoeringsorganisatie-keuze into the timeline slide 6 is efficient but buries an important decision point; a separate slide would reflect how the source decomposes it.
- **probe-process-timeline** (5/5): Clear arc from status quo (slide 2) to process (3) to timeline (4) to results (5), ending with a justification for rollout. Ordering mirrors how the source decomposes the material.
- **probe-table-chart** (4/5): Strong arc: KPI overview (slide 2) frames the 1,596 GWh, then region split, then renewables, then the outlook callout as closer. Minor weakness: slide 5 is a bare callout with no title, so the deck ends without an explicit 'Outlook' heading to anchor it.

### Presentability (4.33)

- **probe-causal-icons-quote** (5/5): Titles carry meaning ('The chain that loses customers', 'Impact if we act'), slides stand alone, and the register fits an internal product-research readout. Presentable with essentially no editing beyond the minor note fix.
- **probe-list-homogeneity** (4/5): Titles carry meaning ('Van kennis naar toepassing', 'Systematiek: één regeling, drie stappen') and slides work standalone. Slide 7's question-title is an effective close. Register fits a stuurgroep notitie.
- **probe-process-timeline** (4/5): Slides stand alone and notes are useful, but titles like 'Programme milestones' and 'Pilot results' are generic labels rather than carrying the finding; 'Confirmation in 3.2 days, corrections down two-thirds' would let the headline read off the slide.
- **probe-table-chart** (4/5): Titles carry meaning ('Consumption by supply region', 'Renewable share of supply') and slides stand alone. The slide-4 'chart-slide' actually renders as a data table, and slide 5 lacks a title — both need light editing before presenting.

## Top issue per case

- **probe-causal-icons-quote**: Keep presenter notes strictly traceable to the source — remove the invented claim that interviewees 'described the sixteen-field setup form', since the source only lists it as a design principle.
- **probe-list-homogeneity**: Give the five uitvoeringsorganisaties their own slide (names + rationale for gesprekken instead of aanbesteding, keuze in jan 2027) rather than compressing this 'important' topic into a single timeline bullet reading 'vijf kandidaten'.
- **probe-process-timeline**: Convert generic section-label titles (e.g. 'Pilot results', 'Programme milestones') into assertion titles that state the takeaway, and trim the full sentences on slide 2 to presentation phrases.
- **probe-table-chart**: Give the closing outlook slide (slide 5) a proper title and, where a slide type is 'chart-slide' (slide 4), render the series as an actual chart rather than a raw data table.

## Variance across repeats

| Case | Mean scores per repeat | Spread |
| --- | --- | ---: |
| probe-causal-icons-quote | 4.60, 4.60, 4.20 | 0.40 |
| probe-list-homogeneity | 4.20, 4.00, 4.00 | 0.20 |
| probe-process-timeline | 4.60, 4.80, 4.40 | 0.40 |
| probe-table-chart | 4.40, 4.40, 4.40 | 0.00 |

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `claude-opus-5` | 83 | 121487 | 86679 | 78503 | 1151380 | $3.8407 |
| judge | `claude-opus-4-8` | 24 | 32654 | 24562 | 7777 | 22157 | $0.8370 |
| **Total** | | 107 | 154141 | 111241 | 86280 | 1173537 | **$4.6777** |
