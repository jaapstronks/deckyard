# AI suite run `2026-11-01_22-25-02`

- **Date**: 2026-11-01T22:25:02.449Z
- **Generation**: `claude` / `claude-opus-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `8b6ed25f8901`
- **Cases**: 4 (probe-causal-icons-quote, probe-list-homogeneity, probe-process-timeline, probe-table-chart)
- **Repeats per case**: 1
- **API cost**: $1.8515

Compared against run `2026-10-18_10-59-52` (prompt version `42be958245a7`).

Prompt files changed since then:
- `server/utils/ai/generate-outline.js`
- `server/utils/ai/prompts/base/outline.js`
- `server/utils/ai/prompts/base/refine-slides.js`
- `server/utils/ai/refine-slides.js`
- `server/utils/ai/revise-outline.js`
- `server/utils/ai/slide-catalog/global-options.js`
- `shared/slide-types/types/callout-slide/ai.js`
- `shared/slide-types/types/chart-slide/ai.js`
- `shared/slide-types/types/comparison-slide/ai.js`
- `shared/slide-types/types/content-slide/ai.js`
- `shared/slide-types/types/cycle-slide/ai.js`
- `shared/slide-types/types/gallery-slide/ai.js`
- `shared/slide-types/types/icon-card-grid-slide/ai.js`
- `shared/slide-types/types/image-set-slide/ai.js`
- `shared/slide-types/types/image-text-slide/ai.js`
- `shared/slide-types/types/kpi-metrics-slide/ai.js`
- `shared/slide-types/types/list-slide/ai.js`
- `shared/slide-types/types/logo-wall-slide/ai.js`
- `shared/slide-types/types/matrix-slide/ai.js`
- `shared/slide-types/types/process-slide/ai.js`
- `shared/slide-types/types/table-slide/ai.js`
- `shared/slide-types/types/team-cards-slide/ai.js`
- `shared/slide-types/types/text-blocks-slide/ai.js`
- `shared/slide-types/types/timeline-slide/ai.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.50 | · 0.00 |
| Structure | 4.50 | · 0.00 |
| Slide economy | 4.25 | ▲ +0.25 |
| Faithfulness | 4.75 | · 0.00 |
| Presentability | 4.50 | ▲ +0.25 |
| **Overall** | **4.50** | · +0.10 |

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| probe-causal-icons-quote | C | 5 | 41 | 0 | 100% | 5/5 | 4.60 |
| probe-list-homogeneity | C | 7 | 40.43 | 0 | 100% | 3/5 | 4.00 |
| probe-process-timeline | C | 5 | 44.8 | 0 | 100% | 5/5 | 4.80 |
| probe-table-chart | C | 5 | 26.4 | 0 | 95% | 5/5 | 4.60 |

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

## Lists of one kind

A list claims its items are alike. Judged per list, apart from the rubric.

| Case | Repeat | Lists | Mixed | Not judged |
| --- | ---: | ---: | ---: | ---: |
| probe-causal-icons-quote | 1 | 2 | 1 | 0 |
| probe-list-homogeneity | 1 | 3 | 0 | 0 |
| probe-process-timeline | 1 | 4 | 1 | 0 |
| probe-table-chart | 1 | 2 | 0 | 0 |

- **probe-causal-icons-quote** repeat 1, slide 5 ("The prize if we act"): baseline metric, context statistic, projected gain. These numbers answer different questions—today's completion rate, a market fact about deferred billing, and a forecast of extra accounts—so split the current-state baseline from the projected 'prize' it would deliver.
- **probe-process-timeline** repeat 1, slide 2 ("From paper to digital intake"): background/problem statement, solution description, deployment scope. The three items answer different questions—the prior state, what the programme does, and how widely it is used—so this is a summary dressed as a list rather than instances of one kind; split it into a narrative or label each as a distinct fact.

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (4.25)

- **probe-causal-icons-quote** (4/5): Most slides are well-paced, but slide 2 packs four labelled blocks plus sub-sentences ('A large share drop out before they ever reach the workspace') that duplicate the labels; trimming the explanatory sentences under each stage would let the chain read as spoken beats rather than text.
- **probe-list-homogeneity** (4/5): On-slide text is appropriately phrase-based (e.g. slide 3 'Drempels' / 'Gevolg' blocks, slide 5 Aanvraag/Declaratie). Slide 3 verges on busy with four stacked block pairs, but still presentable; presenter notes carry the detail rather than the slides.
- **probe-process-timeline** (4/5): Slides 3-5 are well-paced. Slide 2 is slightly padded: 'Paper since 2011 / Patient intake has run on paper for over a decade' restates the same fact twice; collapse the label-plus-sentence pairs into single phrases.
- **probe-table-chart** (5/5): KPI slide (2) and table (3) use terse figures, and the callout (5) is a single crisp takeaway. Dense prose is correctly pushed into presenter notes rather than onto the slides.

### Coverage (4.50)

- **probe-causal-icons-quote** (5/5): All six key topics appear: causal chain (slide 2), early billing (slide 2 'Billing before value'), four principles (slide 4), 34 interviews (slides 1-2), Marieke quote (slide 3), and the completion/impact figures (slide 5). Nothing essential is omitted.
- **probe-list-homogeneity** (3/5): All essentials (doel, doelgroepen, systematiek, besluit) are present, but two 'important' topics are thin: the five named uitvoeringsorganisaties (Stichting Leerroute Oost, Fonds Vakkracht, etc.) are reduced to 'vijf gesprekspartners' on slide 6, and the risk section is dissolved — the catalogus-risk with its six-month evaluation is entirely absent. Add a dedicated slide naming the candidate organisations and the three risks with mitigations.
- **probe-process-timeline** (5/5): All eight key topics appear: five-step flow (slide 3), validation-before-triage (slide 3 notes), milestones (slide 4), pilot metrics (slide 5), fourteen clinics (slide 2), SMS value (slides 3 and 5 notes), decommissioning/archive (slide 4), and manual-correction drop (slide 5). Nothing essential is omitted.
- **probe-table-chart** (5/5): All eight key topics appear: regional consumption (slide 3), renewable share (slide 4), headline figures (slide 2), storage constraint and Eemshaven (slide 5), plus grid losses, tariff, and the flattening curve. Nothing essential omitted.

### Structure (4.50)

- **probe-causal-icons-quote** (4/5): Clean arc: title -> problem chain -> customer voice -> solution principles -> business case. Placing the quote (slide 3) before the principles works, though it slightly interrupts the chain-to-principles logic that the presenter notes explicitly link; moving the quote after slide 4 would tighten the problem-then-solution flow.
- **probe-list-homogeneity** (4/5): Clean arc: title -> doel (slide 2) -> waarom nu (slide 3) -> doelgroepen (slide 4) -> systematiek (slide 5) -> budget/tijdpad (slide 6) -> besluit (slide 7). Moving 'Waarom nu' ahead of the doelgroepen is a defensible, persuasive ordering; the only weakness is that risks have no home of their own.
- **probe-process-timeline** (5/5): Clean arc: context (slide 2) -> process (slide 3) -> timeline (slide 4) -> results (slide 5). Ordering mirrors how the source decomposes, and the process precedes the metrics that justify it.
- **probe-table-chart** (5/5): Clean arc: title, headline KPIs that 'frame the whole report,' regional breakdown, renewable trend, then a single outlook callout. Ordering is deliberate and each slide references the next, avoiding a table-of-contents feel.

## Top issue per case

- **probe-causal-icons-quote**: Trim the redundant explanatory sentences beneath each labelled block on slide 2 so the causal chain reads as spoken beats rather than a text-heavy diagram.
- **probe-list-homogeneity**: Add a dedicated risks-and-mitigation slide and surface the five candidate uitvoeringsorganisaties by name — these 'important' source topics are currently compressed away, weakening coverage.
- **probe-process-timeline**: Tighten context slides like slide 2 by removing restated facts (e.g. the duplicate 'paper since 2011' line) so each bullet adds new information.
- **probe-table-chart**: Eliminate unsourced embellishments (e.g. the '14 January cold-snap' in slide 2) and verify derived figures like year-on-year renewable gains against the raw numbers before asserting them.

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| topics | `claude-opus-4-8` | 4 | 5642 | 1756 | 0 | 0 | $0.0721 |
| generation | `claude-opus-5` | 28 | 39817 | 30659 | 52050 | 364362 | $1.4731 |
| judge | `claude-opus-4-8` | 8 | 20710 | 8108 | 0 | 0 | $0.3063 |
| **Total** | | 40 | 66169 | 40523 | 52050 | 364362 | **$1.8515** |
