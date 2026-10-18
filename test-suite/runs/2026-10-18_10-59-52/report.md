# AI suite run `2026-10-18_10-59-52`

- **Date**: 2026-10-18T10:59:52.500Z
- **Generation**: `claude` / `claude-opus-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `42be958245a7`
- **Cases**: 4 (probe-causal-icons-quote, probe-list-homogeneity, probe-process-timeline, probe-table-chart)
- **Repeats per case**: 1
- **API cost**: $1.5636

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.50 | — |
| Structure | 4.50 | — |
| Slide economy | 4.00 | — |
| Faithfulness | 4.75 | — |
| Presentability | 4.25 | — |
| **Overall** | **4.40** | — |

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| probe-causal-icons-quote | C | 5 | 43.2 | 0 | 67% | 5/5 | 4.40 |
| probe-list-homogeneity | C | 7 | 40.86 | 0 | 100% | 3/5 | 4.00 |
| probe-process-timeline | C | 5 | 41.8 | 0 | 100% | 5/5 | 4.80 |
| probe-table-chart | C | 5 | 26.8 | 0 | 100% | 5/5 | 4.40 |

## Specialised layout recall

Whether content whose shape calls for a laborious-to-build layout got it.

| Case | Recall | Missed | Fell back to |
| --- | ---: | --- | --- |
| probe-causal-icons-quote | 3/3 | — | — |
| probe-process-timeline | 3/3 | — | — |
| probe-table-chart | 3/3 | — | — |

## Source lists kept whole

Whether a list the source enumerates arrives with exactly its members, no remarks about the list posing as items.

| Case | Repeat | List | Items / members | Strays |
| --- | ---: | --- | ---: | --- |
| probe-list-homogeneity | 1 | Doelgroepen | 3/3 | — |
| probe-list-homogeneity | 1 | Uitvoeringsorganisaties | missing (0/5 in one list) | — |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (4.00)

- **probe-causal-icons-quote** (4/5): Slide 3 and 5 are well-paced. Slide 2 crams Trigger/Immediate effect/Downstream labels plus four sub-descriptions and a repeated '34 interviews' line; trim the redundant methodology line since it already appears on slide 1.
- **probe-list-homogeneity** (4/5): Most slides use crisp label+phrase pairs well suited to speaking. Slide 3 'Waarom nu' is overloaded with six sub-blocks plus a trailing full sentence; split the belemmeringen and gevolgen or drop the 'Technieken...' sentence to keep it presentable.
- **probe-process-timeline** (4/5): Label-plus-phrase pairs (e.g. slide 3 'Validation / Intake desk checks insurance and identity') are well-sized for speaking, with detail pushed to notes. Slide 2's subtitle plus three near-synonymous points ('Fully digital replacement', 'All fourteen clinics') is slightly padded and could be tightened to two points.
- **probe-table-chart** (4/5): On-slide text is lean and appropriate — KPI numerals on slide 2, a clean four-row table on slide 3, and a single callout sentence on slide 5. The dense explanatory prose is correctly confined to presenter notes; the chart slide (4) embedding a raw year/value table is slightly redundant but still readable.

### Presentability (4.25)

- **probe-causal-icons-quote** (4/5): Titles carry meaning ('The chain that loses customers', 'The prize for fixing it') and slides stand alone. Minor edit needed: the contradictory forward-reference in slide 5's note would confuse a presenter reading from it live.
- **probe-list-homogeneity** (4/5): Titles carry meaning ('Doel: van kennis naar toepassing', 'Gevraagd besluit: gaat de stuurgroep akkoord...') and slides work standalone with helpful presenter notes. Lightly editable, though slide 6 collapsing the uitvoerderkeuze into the timeline leaves that decision under-explained for a standalone reader.
- **probe-process-timeline** (5/5): Titles carry meaning and slides stand alone (e.g. 'The five-step referral flow', 'Pilot results'); the 'from X' baselines on slide 5 make metrics self-explanatory without narration. Register suits an internal briefing.
- **probe-table-chart** (4/5): Titles carry meaning (e.g. 'Consumption by supply region') and slides stand alone with helpful subtitles like 'Direction of travel is split.' Slide 4's chart is rendered as a text table with bare axis labels ('Year', 'Share of supply (%)'), which would need actual chart rendering before presenting.

### Coverage (4.50)

- **probe-causal-icons-quote** (5/5): All seven key topics appear: the causal chain (slide 2), billing-before-value (slide 2 trigger), four principles (slide 3), Marieke's quote (slide 4), the 41% vs 60-75% gap and +1,900 projection (slide 5), and methodology (34 interviews, noted on slides 1-3). Nothing essential omitted.
- **probe-list-homogeneity** (3/5): All four essentials are present (doel slide 2, aanleiding slide 3, doelgroepen slide 4, systematiek slide 5, besluit slide 7), but two important topics are entirely missing: the 'Uitvoeringsorganisaties' section (five named candidates and the deliberate choice of gesprekken over openbare aanbesteding) is reduced to a single timeline bullet, and 'Risico's en beheersmaatregelen' (half the budget reserved for zelfstandigen/onderwijs, 10-minute application, 6-month catalogue review) is absent. Add a slide for each.
- **probe-process-timeline** (5/5): All nine key topics are present: the five-step flow (slide 3), validation-ordering lesson (slide 3 notes), timeline (slide 4), pilot metrics (slide 5), paper replacement (slide 2), SMS as top improvement (slides 3 & 5), manual corrections, satisfaction, and paper/archive wind-down (slide 4). Nothing material is omitted.
- **probe-table-chart** (5/5): All eight key topics are present: headline figures (slide 2), regional consumption (slide 3), renewable growth and the flattening claim (slide 4), and the storage/Eemshaven constraint (slide 5). Even the supporting tariff (0.31 €/kWh) and record-low grid losses are included on slide 2.

## Top issue per case

- **probe-causal-icons-quote**: Fix stale cross-slide transition notes: slide 5's presenter note promises principles 'that follow' although they were already covered on slide 3 — ensure transition language matches the final slide order.
- **probe-list-homogeneity**: Add dedicated slides for the two omitted important topics: the candidate uitvoeringsorganisaties with the rationale for gesprekken over aanbesteding, and the risico's with their beheersmaatregelen (budget reservation, 10-minuten aanvraag, catalogus-evaluatie).
- **probe-process-timeline**: The deck is strong; the main refinement is trimming slide 2's redundant third bullet ('All fourteen clinics' vs 'Fully digital replacement') so each context point earns its place.
- **probe-table-chart**: When the source's own arithmetic is inconsistent (the renewable gains are 6,7,8,7,7, not 7,7,8,7,7), have the generator recompute from the underlying data points and flag the discrepancy rather than repeating the source's error verbatim.

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| topics | `claude-opus-4-8` | 4 | 5642 | 1889 | 0 | 0 | $0.0754 |
| generation | `claude-opus-5` | 27 | 39691 | 29553 | 24892 | 348532 | $1.2671 |
| judge | `claude-opus-4-8` | 4 | 15784 | 5689 | 0 | 0 | $0.2211 |
| **Total** | | 35 | 61117 | 37131 | 24892 | 348532 | **$1.5636** |
