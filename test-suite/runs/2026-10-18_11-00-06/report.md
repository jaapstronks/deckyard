# AI suite run `2026-10-18_11-00-06`

- **Date**: 2026-10-18T11:00:06.664Z
- **Generation**: `claude` / `claude-opus-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `42be958245a7`
- **Cases**: 3 (deckyard-readme, nl-kamerbrief-duurzame-digitalisering, philips-q4-2024)
- **Repeats per case**: 3
- **API cost**: $1.0296

Compared against run `2026-10-18_10-23-29` (prompt version `4102730f87a4`).

Prompt files changed since then:
- `server/utils/ai/refine-slides.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 5.00 | · 0.00 |
| Structure | 5.00 | ▲ +0.22 |
| Slide economy | 4.00 | · 0.00 |
| Faithfulness | 5.00 | ▲ +0.33 |
| Presentability | 4.11 | ▼ -0.22 |
| **Overall** | **4.62** | · +0.06 |

> **Regression warning.** These dimensions moved down:
> - Presentability (-0.22)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deckyard-readme | B | 23 | 49.22 | 2 | 100% | 5/5 | 4.60 |
| nl-kamerbrief-duurzame-digitalisering | B | 11 | 40.09 | 0 | 100% | 5/5 | 4.60 |
| philips-q4-2024 | A | 23 | 41.7 | 0 | 100% | 5/5 | 4.67 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (4.00)

- **deckyard-readme** (4/5): Most slides use crisp label+phrase pairs, but the denser lists push the limit: slide 21 crams five items plus a footer sentence, and slide 3 stacks four items with sub-descriptions plus an intro line. Trim to 3-4 items or shorter descriptors on these to keep them spoken-friendly.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Most slides use crisp label+phrase pairs well suited to speaking. Slide 2 is the exception: it carries an intro line, three labelled items with sub-text, AND a closing 'Koplopers laten het al zien' sentence — one element should move entirely to presenter notes to avoid crowding.
- **philips-q4-2024** (4/5): KPI and table slides carry the right density of numbers for spoken delivery (e.g. slide 20 outlook, slide 4 profitability). However slide 6 contains a stray orphan token 'lime' that says nothing, and a few list slides (slide 22 dividend) pack a lot of dates into one bullet that would be better split or pushed entirely to notes.

### Presentability (4.11)

- **deckyard-readme** (4/5): Titles carry meaning ('One command installs it', '27 tools across the presentation lifecycle') and slides stand alone. Minor risk: on list slides like 14 and 19 the label/description pairs may read as run-on without the layout's visual separation, so verify the typed-slide rendering distinguishes them.
- **nl-kamerbrief-duurzame-digitalisering** (5/5): Titles carry meaning and work standalone (e.g. 'Drie knelpunten voor Nederlandse koplopers', 'Twee doelen voor 2026-2028'), register is appropriately formal for a Kamerbrief, and presenter notes add context without duplicating the slides. Presentable with at most light trimming.
- **philips-q4-2024** (4/5): Titles are genuinely informative ('Net result weighed down by tax', 'Mature markets carried 2024') and slides work standalone. The stray 'lime' text on slide 6 is a visible formatting artifact that would embarrass a presenter and must be removed before showing.

### Coverage (5.00)

- **deckyard-readme** (5/5): Every essential and important topic is present: platform framing (slide 3), three audiences (4-6), install paths including agent-driven (8-10), MCP transports/tools/prompts/pipeline (12-15), customization (17-18), config/auth (19), collab (20), deployment/storage (21), and licensing (22). Nothing from the key-topics list is dropped.
- **nl-kamerbrief-duurzame-digitalisering** (5/5): All essential and supporting topics are present: twin transition (slide 2), Europees koploper and AI innovatiemotor (slide 8), NCDD and draagvlak (slide 3), monitoring/datacenters/DPP (slides 7-8), interdepartementale samenwerking (slide 9), the four moties (slide 10), and the SIIA instrument (slide 9). Nothing material from the source is omitted.
- **philips-q4-2024** (5/5): All essential topics are present and well distributed: group FY/Q4 results (slides 3-4), cash flow (slide 5), China decline (threaded throughout), segments (slides 9-10), regions (slide 11), Respironics (slides 18-19), 2025 outlook (slides 20-21), productivity (slide 17), dividend (slide 22), and innovation (slides 13-14). Even supporting items like the tax-driven net loss (slide 6) and leadership/operating model (slide 15) are captured.

## Top issue per case

- **deckyard-readme**: Tighten on-slide text on the denser list slides (notably 3 and 21): cap items at 3-4 and shorten descriptors to phrases, pushing detail into speaker notes where it already lives.
- **nl-kamerbrief-duurzame-digitalisering**: Trim slide 2 so it carries one clear idea per element — move the 'Koplopers laten het al zien' examples sentence fully into presenter notes rather than keeping both the labelled list and the trailing sentence on-slide.
- **philips-q4-2024**: Strip rendering/formatting artifacts from slide bodies — the orphan token 'lime' on slide 6 is leaked styling metadata that should never reach the slide text; add a post-generation check for stray non-content tokens.

## Variance across repeats

| Case | Mean scores per repeat | Spread |
| --- | --- | ---: |
| deckyard-readme | 4.60, 4.60, 4.60 | 0.00 |
| nl-kamerbrief-duurzame-digitalisering | 4.80, 4.40, 4.60 | 0.40 |
| philips-q4-2024 | 4.60, 4.80, 4.60 | 0.20 |

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| topics | `claude-opus-4-8` | 3 | 36051 | 2283 | 0 | 0 | $0.2373 |
| judge | `claude-opus-4-8` | 9 | 46458 | 17156 | 12543 | 105366 | $0.7923 |
| **Total** | | 12 | 82509 | 19439 | 12543 | 105366 | **$1.0296** |
