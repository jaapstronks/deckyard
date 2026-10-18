# AI suite run `2026-10-18_08-40-29`

- **Date**: 2026-10-18T08:40:29.916Z
- **Generation**: `claude` / `claude-opus-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `9f8ff2bea426`
- **Cases**: 3 (deckyard-readme, nl-kamerbrief-duurzame-digitalisering, philips-q4-2024)
- **Repeats per case**: 3
- **API cost**: $17.3695

Compared against run `2026-10-04_17-14-30` (prompt version `f9cea87eeb6e`).

Prompt files changed since then:
- `server/utils/ai/generate-outline.js`
- `server/utils/ai/prompts/base/outline.js`
- `server/utils/ai/prompts/base/refine-slides.js`
- `server/utils/ai/refine-slides.js`
- `server/utils/ai/revise-outline.js`
- `server/utils/ai/slide-catalog/basic-content-slides.js`
- `server/utils/ai/slide-catalog/builders.js`
- `server/utils/ai/slide-catalog/card-slides.js`
- `server/utils/ai/slide-catalog/content-slides.js`
- `server/utils/ai/slide-catalog/diagram-slides.js`
- `server/utils/ai/slide-catalog/examples/basic-slides.js`
- `server/utils/ai/slide-catalog/examples/card-slides.js`
- `server/utils/ai/slide-catalog/examples/data-slides.js`
- `server/utils/ai/slide-catalog/examples/diagram-slides.js`
- `server/utils/ai/slide-catalog/examples/index.js`
- `server/utils/ai/slide-catalog/examples/text-blocks-slide.js`
- `server/utils/ai/slide-catalog/interactive-slides.js`
- `server/utils/ai/slide-catalog/media-slides.js`
- `server/utils/ai/slide-catalog/people-slides.js`
- `server/utils/ai/slide-catalog/structural-slides.js`
- `server/utils/ai/slide-catalog/visual-content-slides.js`
- `shared/slide-types/types/callout-slide/ai.js`
- `shared/slide-types/types/chapter-title-slide/ai.js`
- `shared/slide-types/types/chart-slide/ai.js`
- `shared/slide-types/types/comparison-slide/ai.js`
- `shared/slide-types/types/content-slide/ai.js`
- `shared/slide-types/types/countdown-slide/ai.js`
- `shared/slide-types/types/cycle-slide/ai.js`
- `shared/slide-types/types/embed-slide/ai.js`
- `shared/slide-types/types/end-slide/ai.js`
- `shared/slide-types/types/feedback-slide/ai.js`
- `shared/slide-types/types/funnel-slide/ai.js`
- `shared/slide-types/types/gallery-slide/ai.js`
- `shared/slide-types/types/icon-card-grid-slide/ai.js`
- `shared/slide-types/types/image-set-slide/ai.js`
- `shared/slide-types/types/image-slide/ai.js`
- `shared/slide-types/types/image-text-slide/ai.js`
- `shared/slide-types/types/kpi-metrics-slide/ai.js`
- `shared/slide-types/types/likert-slide/ai.js`
- `shared/slide-types/types/likert-slider-slide/ai.js`
- `shared/slide-types/types/list-slide/ai.js`
- `shared/slide-types/types/logo-wall-slide/ai.js`
- `shared/slide-types/types/matrix-slide/ai.js`
- `shared/slide-types/types/payoff-slide/ai.js`
- `shared/slide-types/types/poll-slide/ai.js`
- `shared/slide-types/types/process-slide/ai.js`
- `shared/slide-types/types/pyramid-slide/ai.js`
- `shared/slide-types/types/quote-slide/ai.js`
- `shared/slide-types/types/table-slide/ai.js`
- `shared/slide-types/types/team-cards-slide/ai.js`
- `shared/slide-types/types/text-blocks-slide/ai.js`
- `shared/slide-types/types/timeline-slide/ai.js`
- `shared/slide-types/types/title-slide/ai.js`
- `shared/slide-types/types/video-slide/ai.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 5.00 | · 0.00 |
| Structure | 4.67 | · 0.00 |
| Slide economy | 3.00 | ▼ -1.00 |
| Faithfulness | 4.89 | ▲ +1.22 |
| Presentability | 3.78 | ▼ -0.22 |
| **Overall** | **4.27** | · 0.00 |

> **Regression warning.** These dimensions moved down:
> - Slide economy (-1.00)
> - Presentability (-0.22)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deckyard-readme | B | 23 | 64.35 | 8 | 100% | 5/5 | 4.27 |
| nl-kamerbrief-duurzame-digitalisering | B | 11 | 54 | 2 | 100% | 5/5 | 4.20 |
| philips-q4-2024 | A | 23 | 69.22 | 10 | 100% | 5/5 | 4.33 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (3.00)

- **deckyard-readme** (3/5): Several slides are text-dense for spoken delivery: slide 5 lists eight capabilities twice (alternatives vs Deckyard) plus a caption, and slides 20-21 each pack five labelled items with an additional trailing paragraph. These read as reference tables rather than talking points; reserve the detail for the already-thorough presenter notes and leave 3-4 phrases on the slide.
- **nl-kamerbrief-duurzame-digitalisering** (3/5): Slide 2 crams a lead sentence, three sub-items with explanations, and a separate 'Inzet' paragraph; slide 7's two-column belemmeringen/basisactiviteiten each with descriptions is a wall of text for spoken delivery. Trim descriptions to phrases and let presenter notes carry the detail.
- **philips-q4-2024** (3/5): KPI slides 8, 9 and 10 each append a redundant 'key figures' prose line that restates every tile verbatim (e.g. slide 8: 'Four metrics: full-year sales of EUR 8,790 million... Q4 margin 12.1%...'), cluttering slides that were already complete. Strip these duplicate captions so the tiles stand alone.

### Presentability (3.78)

- **deckyard-readme** (4/5): Titles carry meaning ('Storage: PostgreSQL 14+', 'Customization that survives upgrades') and most slides stand alone with strong presenter notes. The main drag is the code/flag strings embedded as bullet text (e.g. slide 13's `args`/`cwd` lines, slide 11's raw setup flag), which would need light formatting cleanup before presenting.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Titles are meaningful and slides stand alone (e.g. slide 10 'Vier openstaande moties belegd in het programma'). However slide 7 has a stray 'mist' token (an icon name) leaking into the slide body — remove such artifacts before presenting.
- **philips-q4-2024** (4/5): Titles carry genuine messages ('Net income held back by a one-off tax charge', 'Mature geographies grew, China weighed on growth') and slides work standalone with strong presenter notes. Lightly held back only by the duplicated summary captions noted above, which an editor would delete before presenting.

### Structure (4.67)

- **deckyard-readme** (4/5): Clear arc with chapter dividers (slides 4, 7, 12) and a payoff close (slide 23). One oddity: the source's three-audience framing (presenters/developers/agents) is partly collapsed — the 'presenters' audience is folded into slide 2's lifecycle while slide 5 fuses 'For developers' with the competitive comparison, which slightly muddies the 'Why Deckyard — three audiences' promise set up on slide 4.
- **nl-kamerbrief-duurzame-digitalisering** (5/5): Clear arc from problem (slide 2) to concrete examples (slide 3), support (slide 4), history (slide 5), a chapter divider (slide 6), the programme's knelpunten->basisactiviteiten->doelen logic (slides 7-8), execution (slide 9), accountability on moties (slide 10), and a closing quote (slide 11). Ordering mirrors how the source decomposes.
- **philips-q4-2024** (5/5): Clear arc: group overview -> Q4 -> net income explainer -> CEO framing -> segment chapter -> execution chapter -> outlook/capital chapter -> payoff. Chapter-title slides (7, 12, 18) group material the way the source decomposes it, and the geography table sensibly bridges segment detail.

## Top issue per case

- **deckyard-readme**: Trim the densest slides (5, 20, 21) to a handful of spoken phrases and push the enumerated detail into the presenter notes, which already carry it well.
- **nl-kamerbrief-duurzame-digitalisering**: Reduce on-slide text on dense slides (2 and 7) to short phrases and push explanatory sentences into presenter notes, and strip stray icon-name artifacts like 'mist' on slide 7.
- **philips-q4-2024**: Remove the redundant 'key figures' prose lines on KPI slides (8, 9, 10) that restate the metric tiles verbatim; let the tiles and their sub-captions carry the numbers once.

## Variance across repeats

| Case | Mean scores per repeat | Spread |
| --- | --- | ---: |
| deckyard-readme | 4.20, 4.20, 4.40 | 0.20 |
| nl-kamerbrief-duurzame-digitalisering | 4.20, 4.00, 4.40 | 0.40 |
| philips-q4-2024 | 4.40, 4.20, 4.40 | 0.20 |

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `claude-opus-5` | 91 | 2037807 | 248270 | 0 | 0 | $16.3958 |
| judge | `claude-opus-4-8` | 9 | 52625 | 17027 | 39303 | 78606 | $0.9737 |
| **Total** | | 100 | 2090432 | 265297 | 39303 | 78606 | **$17.3695** |
