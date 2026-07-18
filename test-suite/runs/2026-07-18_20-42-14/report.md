# AI suite run `2026-07-18_20-42-14`

- **Date**: 2026-07-18T20:42:14.060Z
- **Generation**: `openai` / `gpt-5.5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `2fc50a04f013`
- **Cases**: 3 (probe-causal-icons-quote, probe-process-timeline, probe-table-chart)
- **Repeats per case**: 1
- **API cost**: $1.4679

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.33 | — |
| Structure | 4.67 | — |
| Slide economy | 3.67 | — |
| Faithfulness | 4.00 | — |
| Presentability | 3.67 | — |
| **Overall** | **4.07** | — |

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| probe-causal-icons-quote | C | 6 | 31 | 0 | 60% | 4/5 | 4.20 |
| probe-process-timeline | C | 6 | 43.33 | 0 | 50% | 5/5 | 3.60 |
| probe-table-chart | C | 6 | 36.83 | 0 | 77% | 4/5 | 4.40 |

## Specialised layout recall

Whether content whose shape calls for a laborious-to-build layout got it.

| Case | Recall | Missed | Fell back to |
| --- | ---: | --- | --- |
| probe-causal-icons-quote | 1/3 | `text-blocks-slide`, `icon-card-grid-slide` | `list-slide` |
| probe-process-timeline | 2/3 | `kpi-metrics-slide` | `list-slide` |
| probe-table-chart | 2/3 | `kpi-metrics-slide` | — |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (3.67)

- **probe-causal-icons-quote** (4/5): Slides 2 and 3 use tight labeled steps with one supporting line each, appropriate for speaking. Slide 3's descriptions like 'Move billing until after users have seen a demonstrated product result' read slightly clunky; trim to a phrase such as 'No billing until value is shown.'
- **probe-process-timeline** (3/5): Slide 3 and 4 are well-paced, but slide 5's table carries five rows including two soft narrative rows that bloat it, and slide 2 stacks five labelled bullets that verge on wordy. Trim slide 5 to the three real KPIs.
- **probe-table-chart** (4/5): Tables on slides 2-3 are appropriately terse. Slide 5's text-blocks pack five labeled blocks (Storage Bottleneck, Eemshaven Timeline, 55% Plateau, Risk Through 2028, De-risk Delivery) that overlap in meaning and could be consolidated to three. Presenter notes are long but correctly off-slide.

### Presentability (3.67)

- **probe-causal-icons-quote** (4/5): Titles carry meaning ('The Chain That Loses Customers', payoff slide 6 as a full sentence), and presenter notes add spoken context. Slide 3's title 'Redesign Principles and Priority Changes' is vaguer than needed — the 'Priority Changes' half isn't clearly reflected in content.
- **probe-process-timeline** (3/5): Titles are meaningful ('Validate First', 'Pilot Impact: Faster, Cleaner, Better Booking') and slides stand alone, but slide 5 contains a stray 'on' text artifact and a malformed header row that would need cleanup before presenting.
- **probe-table-chart** (4/5): Titles are meaningful and slides stand alone (e.g. 'Renewables Cross the Halfway Mark'). A stray 'on' artifact appears in slides 2-3 subtitles ('...before regional detail / on / Metric'), which needs cleanup, but light editing makes this presentable.

### Faithfulness (4.00)

- **probe-causal-icons-quote** (4/5): Figures are traceable — 41%, 60–75%, 1,900 all match. The '50% Of the gap is realistic upside' KPI reframes the source's 'closing even half that gap' as a standalone metric, which is a mild distortion; present it as a qualifier on the 1,900 rather than an equal-weight number.
- **probe-process-timeline** (3/5): Numbers (11.4->3.2, 31%->9%, 3.1->4.4, derived 8.2 days/22pp/+1.3) are all traceable and correct, but slide 5 invents two table rows — 'Scaling case: Pilot sites only / Strong evidence / Ready to scale' and 'Scheduling delays: Biggest improvement' — that dress up interpretation as measured data. Remove fabricated table rows.
- **probe-table-chart** (5/5): Every figure traces to source: regional YoY deltas (South +27, North -36, East +37, West -28) all compute correctly, plus 1,596 GWh, 2.9 GW, 4.1%, €0.31, 53%, and the 55% plateau through 2028. No fabrication; 'affordability pressure to monitor' is mild interpretation but defensible.

## Top issue per case

- **probe-causal-icons-quote**: Preserve the study's methodology anchor (34 interviewed customers who abandoned in week one) so the deck reads as evidence-based rather than assertion.
- **probe-process-timeline**: Stop padding data tables with interpretive rows: slide 5 should contain only the three real pilot KPIs from the source, not invented rows like 'Ready to scale' and 'Strong evidence' that present opinion as measured fact.
- **probe-table-chart**: Surface the source's 'flattening curve' point explicitly on the renewable slide (even if the source's own numbers are inconsistent, present the year-on-year deltas so the board can judge the trend) rather than smoothing it into 'broadly consistent.'

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| topics | `claude-opus-4-8` | 3 | 3434 | 1306 | 0 | 0 | $0.0498 |
| generation | `gpt-5.5` | 16 | 145023 | 17726 | 0 | 0 | $1.2569 |
| judge | `claude-opus-4-8` | 3 | 10674 | 4314 | 0 | 0 | $0.1612 |
| **Total** | | 22 | 159131 | 23346 | 0 | 0 | **$1.4679** |
