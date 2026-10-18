# AI suite run `2026-10-18_09-28-07`

- **Date**: 2026-10-18T09:28:07.249Z
- **Generation**: `claude` / `claude-opus-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `70da2d90d200`
- **Cases**: 1 (philips-q4-2024)
- **Repeats per case**: 1
- **API cost**: $1.9334
- **Mode**: dry run (metrics only, no judge)

Compared against run `2026-10-04_17-18-27` (prompt version `f9cea87eeb6e`).

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

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| philips-q4-2024 | A | 23 | 40.78 | 1 | 100% | — | — |

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `claude-opus-5` | 10 | 248760 | 27583 | 0 | 0 | $1.9334 |
| **Total** | | 10 | 248760 | 27583 | 0 | 0 | **$1.9334** |
