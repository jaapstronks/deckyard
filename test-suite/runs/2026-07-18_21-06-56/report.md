# AI suite run `2026-07-18_21-06-56`

- **Date**: 2026-07-18T21:06:56.034Z
- **Generation**: `openai` / `gpt-5.5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `e9256c5e0e40`
- **Cases**: 3 (probe-causal-icons-quote, probe-process-timeline, probe-table-chart)
- **Repeats per case**: 1
- **API cost**: $1.3512

Compared against run `2026-07-18_20-42-14` (prompt version `2fc50a04f013`).

Prompt files changed since then:
- `server/utils/ai/slide-catalog/card-slides.js`
- `server/utils/ai/slide-catalog/diagram-slides.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.67 | ▲ +0.34 |
| Structure | 4.33 | ▼ -0.34 |
| Slide economy | 3.33 | ▼ -0.34 |
| Faithfulness | 4.00 | · 0.00 |
| Presentability | 4.00 | ▲ +0.33 |
| **Overall** | **4.07** | · 0.00 |

> **Regression warning.** These dimensions moved down:
> - Structure (-0.34)
> - Slide economy (-0.34)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| probe-causal-icons-quote | C | 7 | 36.71 | 1 | 80% | 5/5 | 4.00 |
| probe-process-timeline | C | 7 | 45.86 | 1 | 67% | 5/5 | 3.80 |
| probe-table-chart | C | 7 | 34.14 | 0 | 81% | 4/5 | 4.40 |

## Specialised layout recall

Whether content whose shape calls for a laborious-to-build layout got it.

| Case | Recall | Missed | Fell back to |
| --- | ---: | --- | --- |
| probe-causal-icons-quote | 3/3 | — | — |
| probe-process-timeline | 3/3 | — | — |
| probe-table-chart | 2/3 | `kpi-metrics-slide` | — |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (3.33)

- **probe-causal-icons-quote** (3/5): Slide 2 crams eight labelled blocks (Trigger, Trust Gap, Immediate Effect, Billing Drop-Off, Downstream Effect, No Workspace, No Data Import, Empty Reactivation) into one slide, becoming a wall of micro-headings. Split the causal chain across a cleaner visual or fewer nodes; other slides are well-sized.
- **probe-process-timeline** (3/5): Slide 3, 4 and 7 are well-paced, but slide 2 packs five sub-headed blocks and slide 5's table has five rows where the source gives three metrics — the two extra rows ('Operational gain', 'Patient-facing change') pad a data table with qualitative restatement. Trim slide 5 to the three real metrics.
- **probe-table-chart** (4/5): Tables and text blocks are appropriately terse for spoken delivery, with detail pushed to presenter notes. However each table slide carries a stray 'on' artifact line (slides 2, 3, 4) that must be removed; otherwise text density is well judged.

### Faithfulness (4.00)

- **probe-causal-icons-quote** (3/5): Slide 6 invents a KPI '1st — Dataset imported as secondary metric' that has no basis in the source. Slide 5's five-step journey ('Start with Data Import', 'Auto-save progress') is also extrapolated beyond the stated four principles. Remove the fabricated metric and flag inferred steps as recommendations.
- **probe-process-timeline** (4/5): All figures (11.4→3.2 days, 31%→9%, 3.1→4.4) are correct and traceable. Minor liberty: slide 5's 'Frequent callbacks / Fewer callbacks' row is inferred from the telephone-tag comment rather than stated as a measured baseline, which risks reading as data; label such qualitative items clearly as commentary, not baseline/pilot columns.
- **probe-table-chart** (5/5): Every figure traces to the source and the derived YoY deltas are correct (East +37, South +27, North -36, West -28; e.g. 522-495=27). The €0.31/kWh, 1,596 GWh, 2.9 GW on 14 January, and 4.1% losses all match with no fabrication.

### Presentability (4.00)

- **probe-causal-icons-quote** (4/5): Titles carry meaning ('Onboarding Failure Is a Chain Reaction', 'The Upside Is Measurable') and notes guide delivery well. Slide 1's bare 'Onboarding Failure' is flat and slide 2 would need trimming, but with light editing this is presentable.
- **probe-process-timeline** (4/5): Titles carry meaning (e.g. slide 3 'Five-Step Digital Referral Flow', slide 7 payoff line) and slides mostly stand alone. Register suits an internal briefing; only slide 5's stray 'on' fragment above the header and the redundant slide 6 need light editing.
- **probe-table-chart** (4/5): Titles carry meaning ('Storage Is the Next Bottleneck', 'Regional Consumption Divergence') and slides work standalone. Beyond removing the 'on' artifacts, slide 5 shows raw year/value pairs plus loose axis labels that need to render as an actual chart before presenting.

## Top issue per case

- **probe-causal-icons-quote**: Remove invented data like slide 6's '1st Dataset imported' KPI and keep every number and metric strictly traceable to the source; mark any operational extrapolations (slide 5 journey) as inferred recommendations rather than findings.
- **probe-process-timeline**: Remove the redundancy: slide 6 repeats slide 3's five-step flow and validation lesson — consolidate the sequence-discipline point into the process slide and use the freed slide for new material, and trim slide 5's table to the three actual metrics.
- **probe-table-chart**: Strip the stray 'on' table artifacts and ensure chart-slide data renders as a visual, then explicitly surface the 'flattening curve' point with the year-on-year percentage-point gains the source highlights.

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `gpt-5.5` | 12 | 122165 | 18651 | 0 | 5888 | $1.1733 |
| judge | `claude-opus-4-8` | 3 | 11427 | 4830 | 0 | 0 | $0.1779 |
| **Total** | | 15 | 133592 | 23481 | 0 | 5888 | **$1.3512** |
