# AI suite run `2026-07-18_16-02-14`

- **Date**: 2026-07-18T16:02:14.743Z
- **Model**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `b11a78726ab7`
- **Cases**: 3 (asml-q4-2024, cbs-persbericht-criminaliteit, cloudflare-nov-2025-outage)
- **Repeats per case**: 1
- **API cost**: $2.3572

Compared against run `2026-07-18_15-51-29` (prompt version `2f0e86683435`).

That run covered 4 cases; its scores are narrowed to this run's 3 for a like-for-like comparison.

Prompt files changed since then:
- `server/utils/ai/slide-catalog/examples/basic-slides.js`
- `server/utils/ai/slide-catalog/examples/card-slides.js`
- `server/utils/ai/slide-catalog/examples/data-slides.js`
- `server/utils/ai/slide-catalog/examples/diagram-slides.js`
- `server/utils/ai/slide-catalog/examples/index.js`
- `server/utils/ai/slide-catalog/examples/text-blocks-slide.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.67 | · 0.00 |
| Structure | 4.67 | · 0.00 |
| Slide economy | 4.00 | · 0.00 |
| Faithfulness | 4.33 | ▲ +0.33 |
| Presentability | 4.67 | ▲ +0.34 |
| Closeness to human deck | 3.00 | · 0.00 |
| **Overall** | **4.47** | · +0.14 |

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| asml-q4-2024 | A | 12 | 28.83 | 0 | 100% | 4/5 | 3.83 |
| cbs-persbericht-criminaliteit | B | 13 | 25.62 | 0 | 95% | 5/5 | 4.60 |
| cloudflare-nov-2025-outage | B | 15 | 38.27 | 0 | 100% | 5/5 | 4.80 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Closeness to human deck (3.00)

- **asml-q4-2024** (3/5): Both decks open with the record-year headline and cover outlook, AI, and dividends, and both sequence Q4->FY->outlook similarly. But the human deck is data-statement heavy (detailed system-sales breakdowns by end-use/region/technology, full financial statements, 2030 €44-60B opportunity) and deliberately omits a company-profile slide, whereas the generated deck is a lighter highlights deck that adds an 'About ASML' slide and skips the granular breakdowns — a meaningfully different editorial judgement.

### Slide economy (4.00)

- **asml-q4-2024** (4/5): KPI slides (2, 4, 5) are appropriately sparse and spoken-presentation friendly. However slide 8 carries a stray 'on' fragment and slide 9 has awkward embedded labels ('Driver', 'Consequence') that read as formatting artifacts rather than clean phrases; these need tightening.
- **cbs-persbericht-criminaliteit** (4/5): Most slides are well-sized, but slide 3 crams four label-plus-subtitle pairs plus an intro line, drifting toward a wall; converting the sub-explanations to punchier fragments would help spoken delivery.
- **cloudflare-nov-2025-outage** (4/5): Most slides use tight phrases, but the text-blocks slides (5, 6) pack four header/subheader pairs each and the timeline slides (2, 12) carry many entries plus a footer line, edging toward dense for spoken delivery. Trimming subheaders like 'Bot Management model fed by a file refreshed every few minutes, pushed network-wide' to a phrase would help.

### Faithfulness (4.33)

- **asml-q4-2024** (4/5): Numbers are accurate and traceable: €28.3B, €7.6B, 51.3%, EPS €19.25, Q4 €9.3B/51.7%/€2.7B, bookings €7.1B (€3.0B EUV), 380 new/38 used units, €6.5B IBM, dividend €6.40 (+4.9%). The '+2.5% vs 2023' on slide 2 checks out. Minor unsupported flourish in slide 6 notes ('Fouquet took over as CEO') is not in the source, but nothing on-slide is fabricated.
- **cbs-persbericht-criminaliteit** (4/5): Figures are almost all accurate, but slide 8 rounds 'niet stedelijk' 12,8 to 13 and 'weinig stedelijk' 13,6 to 14 while the presenter note claims '29% versus 13%'—the source pairs 29% with 12,8%. Keep decimals or label as rounded to avoid an overstated contrast.
- **cloudflare-nov-2025-outage** (5/5): Figures trace to the source: 200-feature limit vs ~60 usage (slide 6), duplicate r0 rows (slide 5), ~6 hours recovery (11:20-17:06), and the Result::unwrap() panic in notes. The Matthew Prince quote combines two real phrases ('We know we let you down today' and 'An outage like today is unacceptable'); attribution to the CEO is reasonable given the signed apology.

## Top issue per case

- **asml-q4-2024**: Remove table/text-block layout artifacts (stray 'on', and inline 'Driver'/'Consequence' labels on slides 8-9) and consider adding the source's forward-looking 2030 revenue opportunity and a light financial-statement/segment view to better match how this earnings material is normally presented.
- **cbs-persbericht-criminaliteit**: Preserve source precision in charts: on slide 8 keep the decimal urbanisation figures (12,8% / 13,6%) so the presenter-note contrast ('29% versus 13%') matches the underlying data exactly.
- **cloudflare-nov-2025-outage**: Reduce text density on the text-blocks and timeline slides — convert full-sentence subheaders into short phrases so each slide reads as spoken talking points rather than a paragraph grid.

## Cost breakdown

| Category | Calls | Input | Output | Cache write | Cache read | USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | 15 | 281216 | 18776 | 0 | 0 | $1.8755 |
| judge | 3 | 42316 | 5841 | 0 | 0 | $0.3576 |
| topics | 2 | 17457 | 1475 | 0 | 0 | $0.1242 |
| **Total** | 20 | 340989 | 26092 | 0 | 0 | **$2.3572** |
