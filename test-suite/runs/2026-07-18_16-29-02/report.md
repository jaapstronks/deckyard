# AI suite run `2026-07-18_16-29-02`

- **Date**: 2026-07-18T16:29:02.233Z
- **Model**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `218d32ce56fc`
- **Cases**: 3 (asml-q4-2024, cbs-persbericht-criminaliteit, cloudflare-nov-2025-outage)
- **Repeats per case**: 1
- **API cost**: $1.9795

Compared against run `2026-07-18_16-02-14` (prompt version `b11a78726ab7`).

Prompt files changed since then:
- `server/utils/ai/generate-outline.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.67 | · 0.00 |
| Structure | 5.00 | ▲ +0.33 |
| Slide economy | 4.00 | · 0.00 |
| Faithfulness | 5.00 | ▲ +0.67 |
| Presentability | 3.67 | ▼ -1.00 |
| Closeness to human deck | 3.00 | · 0.00 |
| **Overall** | **4.47** | · 0.00 |

> **Regression warning.** These dimensions moved down:
> - Presentability (-1.00)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| asml-q4-2024 | A | 12 | 29.08 | 0 | 82% | 4/5 | 4.17 |
| cbs-persbericht-criminaliteit | B | 12 | 24.08 | 0 | 88% | 5/5 | 4.60 |
| cloudflare-nov-2025-outage | B | 17 | 46.88 | 0 | 100% | 5/5 | 4.40 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Closeness to human deck (3.00)

- **asml-q4-2024** (3/5): Shares the human deck's high-level editorial spine (FY summary, Q4, outlook, dividend, AI) and comparable concise text density, but diverges sharply on inclusion: the human deck devotes many slides to end-use/region/technology breakdowns, product shipments (NXT:2150i, NXT:870B), investor key messages and 2030 €44–60B opportunity, and full financial-statement tables — none of which the generated deck attempts (largely because it drew only on the press release, not the investor presentation).

### Presentability (3.67)

- **asml-q4-2024** (4/5): Titles are meaningful and standalone ('Record Q4 2024', 'AI as the Key Growth Driver'), and the register suits an investor summary. Minor risk: slide 8 mixes Q1 and FY figures under one 'Guidance' title, which could confuse without the presenter to disambiguate.
- **cbs-persbericht-criminaliteit** (4/5): Titles carry meaning and slides stand alone, but slide 8 contains a stray artifact ('on' above 'Meeste misdrijven') that must be cleaned before presenting. Register is appropriately factual throughout.
- **cloudflare-nov-2025-outage** (3/5): Slide 17's body is truncated mid-word ('we apologize for the p'), which would be visible and embarrassing if presented as-is. Titles otherwise carry meaning and slides mostly stand alone, but the generator must ensure closing text is complete rather than cut off.

### Slide economy (4.00)

- **asml-q4-2024** (4/5): KPI slides (3,4,5,8) use tight metric-plus-label format ideal for spoken delivery; list slides (9,10,11) keep each item to a short phrase. Slide 11 'About ASML' with five bullets is slightly padded for a summary deck, but nothing approaches a wall of text.
- **cbs-persbericht-criminaliteit** (4/5): Most slides use crisp KPI/table formats suited to speaking. Slide 10 crams four metrics plus sub-labels ('-1,4% t.o.v. 2021') which is slightly dense; otherwise text is well-paced. Consider trimming secondary annotations on the online KPI slide.
- **cloudflare-nov-2025-outage** (4/5): Most slides use tight label-plus-phrase blocks well suited to speaking. However slide 2 crams a headline, five timeline entries, and a closing line onto one 'one page' slide, and slide 13 lists six services — both edge toward density. Trimming slide 2 to 3-4 beats would improve pacing.

## Top issue per case

- **asml-q4-2024**: Surface high-value narrative items that are currently hidden in presenter notes — promote High NA EUV shipments to an on-slide point, and split slide 8 so Q1 and full-year 2025 guidance are clearly separated.
- **cbs-persbericht-criminaliteit**: Clean up rendering artifacts like the stray 'on' fragment on slide 8 and lightly declutter the online-crime KPI slide (slide 10) so secondary annotations don't crowd the headline numbers.
- **cloudflare-nov-2025-outage**: Fix truncated/cut-off text on the closing slide (slide 17 ends 'we apologize for the p') — ensure all slide body text is emitted in full rather than clipped mid-word.

## Cost breakdown

| Category | Calls | Input | Output | Cache write | Cache read | USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | 12 | 221217 | 20863 | 0 | 0 | $1.6277 |
| judge | 3 | 42803 | 5513 | 0 | 0 | $0.3518 |
| **Total** | 15 | 264020 | 26376 | 0 | 0 | **$1.9795** |
