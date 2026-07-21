# AI suite run `2026-07-18_17-04-12`

- **Date**: 2026-07-18T17:04:12.384Z
- **Generation**: `openai` / `gpt-5.5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `12facb0ab6cf`
- **Cases**: 3 (asml-q4-2024, cbs-persbericht-criminaliteit, cloudflare-nov-2025-outage)
- **Repeats per case**: 1
- **API cost**: $2.2192

Compared against run `2026-07-18_16-57-07` (prompt version `218d32ce56fc`).

Prompt files changed since then:
- `server/utils/ai/generate-outline.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.00 | ▼ -0.67 |
| Structure | 4.33 | ▼ -0.34 |
| Slide economy | 3.67 | · 0.00 |
| Faithfulness | 4.33 | ▼ -0.34 |
| Presentability | 4.00 | · 0.00 |
| Closeness to human deck | 3.00 | ▼ -1.00 |
| **Overall** | **4.07** | ▼ -0.27 |

> **Regression warning.** These dimensions moved down:
> - Coverage (-0.67)
> - Structure (-0.34)
> - Faithfulness (-0.34)
> - Closeness to human deck (-1.00)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| asml-q4-2024 | A | 13 | 35 | 0 | 100% | 4/5 | 4.00 |
| cbs-persbericht-criminaliteit | B | 11 | 33.09 | 0 | 93% | 4/5 | 4.20 |
| cloudflare-nov-2025-outage | B | 21 | 51.95 | 4 | 100% | 4/5 | 3.80 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Closeness to human deck (3.00)

- **asml-q4-2024** (3/5): Shares editorial judgement on the core financial story, outlook and dividend, but diverges significantly: the human deck opens with investor key messages including the €44–60B 2030 opportunity, devotes many slides to end-use/region/technology breakdowns and full financial statements (slides 10-13, 18-23), which the generated deck omits entirely. Conversely the generated deck invents a company-profile and risk-factors treatment the human deck largely leaves as a dense legal appendix (slide 24).

### Slide economy (3.67)

- **asml-q4-2024** (4/5): On-slide text is appropriately terse—tables on slides 3, 4, 6, 9 give metric/value pairs suited to speaking. The icon-grid slides (11, 12) distill dense material well. Minor deduction for the stray 'on' token appearing above table headers, which reads as an artifact rather than deliberate text.
- **cbs-persbericht-criminaliteit** (4/5): Most slides are spoken-presentation-friendly, but slide 3 packs five labelled blocks plus an intro and slide 10 splits into two dense columns ('Mechanisme en omvang' / 'Prioriteit voor preventie') with six sub-points, edging toward wordiness. Tightening these to phrases would help.
- **cloudflare-nov-2025-outage** (3/5): Many text-blocks slides (3, 5, 8, 9, 10, 15) pack 6-7 label+description pairs each, e.g. slide 5 crams seven ambiguity sources plus a diagnostic-effect block. These read as dense grids rather than spoken-presentation prompts; consolidating to 3-4 points per slide would suit delivery far better.

### Coverage (4.00)

- **asml-q4-2024** (4/5): All essential topics are present: FY 2024 results (slide 3), Q4 record (slide 4), 2025 outlook (slide 6), AI driver (slide 7), High NA EUV (slide 5), dividend/buyback (slide 9). It misses the effective tax rate (~17%) that appears in the source's outlook context and the reference (slide 16), and does not surface the systems-sold detail with the same weight, but for a press-release deck coverage is comprehensive.
- **cbs-persbericht-criminaliteit** (4/5): All four essential topics are present (stability slide 4, online growth slide 9, police registrations slides 3-5, urban concentration slides 7-8), and aankoopfraude/long-term trend appear. However, slide 5 covers 'soorten slachtofferschap' only qualitatively and drops the source's concrete figures (vermogensdelicten 11%, vernieling 7%, geweld 7%), which should have been stated.
- **cloudflare-nov-2025-outage** (4/5): Nearly all essential topics are present: root cause (slide 9), oversized feature file (slide 8), memory/panic (slide 10), DDoS misdiagnosis (slide 5), request path (slide 7), impacted services (slide 4), timeline (slide 13). However the source's framing that this was 'Cloudflare's worst outage since 2019' is entirely absent, and the concrete recovery marker (core traffic normal by 14:30, all normal 17:06) is only partially conveyed.

## Top issue per case

- **asml-q4-2024**: Incorporate the source's forward-looking strategic content—especially the 2030 revenue opportunity (~€44–60B) and AI-driven industry-to-$1T-by-2030 thesis—as investor 'key messages,' since these headline framing points are what the human deck leads with and the current deck reduces to a single quote.
- **cbs-persbericht-criminaliteit**: Restore the concrete percentages the source leads with (vermogensdelicten 11%, vernieling and geweld each 7% on slide 5; the exact +9%/-3%/+2% registration shifts) instead of purely qualitative labels, so quantitative slides carry the source's actual numbers.
- **cloudflare-nov-2025-outage**: Thin out the text-blocks slides (3, 5, 8, 9, 10, 15) to 3-4 spoken points each, and add the source's headline context that this was Cloudflare's worst outage since 2019 to anchor severity.

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `gpt-5.5` | 12 | 143312 | 37005 | 0 | 0 | $1.8267 |
| judge | `claude-opus-4-8` | 3 | 45231 | 6652 | 0 | 0 | $0.3925 |
| **Total** | | 15 | 188543 | 43657 | 0 | 0 | **$2.2192** |
