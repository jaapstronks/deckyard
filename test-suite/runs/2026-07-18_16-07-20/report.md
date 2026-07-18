# AI suite run `2026-07-18_16-07-20`

- **Date**: 2026-07-18T16:07:20.367Z
- **Model**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `150a00b0d9da`
- **Cases**: 11 (asml-q4-2024, cbs-persbericht-criminaliteit, cbs-veiligheidsmonitor-2025, cloudflare-nov-2025-outage, deckyard-readme, iea-weo-2024, naacl-good-conversation, nl-kamerbrief-duurzame-digitalisering, pbl-kev-2024, philips-q4-2024, wikipedia-zero-knowledge-proof)
- **Repeats per case**: 1
- **API cost**: $13.9026

Compared against run `2026-07-18_15-45-37` (prompt version `2f0e86683435`).

Prompt files changed since then:
- `server/utils/ai/refine-slides.js`
- `server/utils/ai/slide-catalog/examples/basic-slides.js`
- `server/utils/ai/slide-catalog/examples/card-slides.js`
- `server/utils/ai/slide-catalog/examples/data-slides.js`
- `server/utils/ai/slide-catalog/examples/diagram-slides.js`
- `server/utils/ai/slide-catalog/examples/index.js`
- `server/utils/ai/slide-catalog/examples/text-blocks-slide.js`

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.36 | ▼ -0.37 |
| Structure | 4.55 | · -0.09 |
| Slide economy | 3.82 | ▼ -0.18 |
| Faithfulness | 4.27 | ▼ -0.55 |
| Presentability | 3.91 | ▼ -0.18 |
| Closeness to human deck | 2.80 | · 0.00 |
| **Overall** | **4.18** | ▼ -0.28 |

> **Regression warning.** These dimensions moved down:
> - Coverage (-0.37)
> - Slide economy (-0.18)
> - Faithfulness (-0.55)
> - Presentability (-0.18)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| asml-q4-2024 | A | 13 | 26.92 | 0 | 93% | 4/5 | 3.83 |
| cbs-persbericht-criminaliteit | B | 11 | 24.64 | 0 | 67% | 4/5 | 3.80 |
| cbs-veiligheidsmonitor-2025 | B | 32 | 31.97 | 0 | 100% | 5/5 | 4.40 |
| cloudflare-nov-2025-outage | B | 14 | 38.71 | 0 | 100% | 5/5 | 4.60 |
| deckyard-readme | B | 15 | 33.8 | 0 | 100% | 4/5 | 4.00 |
| iea-weo-2024 | A | 25 | 43.88 | 1 | 60% | 5/5 | 4.17 |
| naacl-good-conversation | A | 19 | 37.37 | 0 | 83% | 4/5 | 3.83 |
| nl-kamerbrief-duurzame-digitalisering | B | 12 | 31 | 0 | 100% | 4/5 | 4.20 |
| pbl-kev-2024 | A | 21 | 35.05 | 1 | 100% | 4/5 | 3.67 |
| philips-q4-2024 | A | 19 | 28.16 | 0 | 100% | 4/5 | 4.33 |
| wikipedia-zero-knowledge-proof | B | 25 | 39.96 | 0 | 100% | 5/5 | 4.00 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Closeness to human deck (2.80)

- **asml-q4-2024** (3/5): The generated deck matches the human deck's sequencing (results -> outlook -> capital return) and its concise KPI framing, but diverges in editorial judgement: the human deck is data-dense (segment/end-use breakdowns slides 10-13, full financial statements 18-23, 2030 €44-60B opportunity), whereas this deck adopts a marketing register with quote and payoff slides and an About section the human deck omits.
- **iea-weo-2024** (2/5): The human deck is ~11 chart-driven slides with minimal text, narrowly focused on market balances, oil/EV switch, LNG, critical minerals, China electrification, electricity age and the emissions peak. The generated deck is 25 text/bullet slides with chapter dividers and quote slides, includes topics the human omitted (scenarios overview, affordability, access, resilience) and omits the human's critical-minerals slide. Editorial judgement on length, text density and topic selection diverges substantially.
- **naacl-good-conversation** (3/5): Shares the core editorial choices (attributes, methods, engagingness≠humanness, matching the winner with less data) but frames the deck more conventionally than the human version, which opened with an NLG task spectrum and organized around three research questions. The generated deck also omits the human deck's distinctive insights — the 'paid Turkers are poor engaging conversationalists' caveat and the future-work note on automating control settings.
- **pbl-kev-2024** (2/5): The generated deck makes quite different editorial choices from the human deck. The human deck is explicitly a policy-advice document organised as restopgave-per-sector with detailed geagendeerd-beleid annex tables and eight concrete 'aandachtspunten'. The generated deck is a general public-facing summary of KEV findings. It shares sector coverage but omits the restopgave framing, the per-sector policy levers, the beleidsinstrument tables, and the actionable recommendations that define the human deck's judgement. Sequence and intent diverge substantially.
- **philips-q4-2024** (4/5): Shares the human deck's core editorial choices: segment-by-segment slides, a productivity slide with the 163M/1.7B/2.5B/800M numbers, an AI-innovation slide, a culture slide citing 75% health-tech hires, and an outlook slide with the 1-3%/11.8-12.3% guidance. It diverges by adding a CEO quote and a dedicated dividend slide, and it drops the human deck's prominent three-year-plan progress table (slide 5) and the Adjusted EBITA bridge—analytical framings a Philips IR author favored.

### Slide economy (3.82)

- **asml-q4-2024** (3/5): KPI slides (3,4,5) and the guidance table (7) are well-calibrated for speaking. But slide 12 opens with a broken, truncated paragraph ('The 2024 Annual Reports (US GAAP an...') that would display as a fragment; replace it with bulleted phrases matching the icon cards.
- **cbs-persbericht-criminaliteit** (4/5): KPI and comparison slides (4,8,10) are appropriately terse. Slide 3 crowds four findings each with a sub-line into one list, edging toward dense, but remains presentable; no walls of text elsewhere.
- **cbs-veiligheidsmonitor-2025** (4/5): KPI slides (8, 17, 20) are tight and spoken-friendly. Some list slides carry six labelled items (slide 28 'Preventie in en rond de woning', slide 29 'Buurtpreventie en digitale bescherming'), which is at the upper edge of comfortable for a spoken slide; trimming to four would improve pace. Overall text-per-slide is appropriate.
- **cloudflare-nov-2025-outage** (4/5): Most slides use tight phrase-based blocks appropriate for speaking. However, slides 7, 8 and 10 pack many labeled mini-blocks (e.g. slide 8's four Trigger/Failure pairs), which edges toward dense; splitting or trimming labels would improve readability from the back of a room.
- **deckyard-readme** (4/5): Most slides use tight label+phrase pairs suited to speaking. Slide 2 crams six items each with a sub-line, edging toward density; trimming to four points would give it more breathing room.
- **iea-weo-2024** (4/5): Most slides use tight labelled phrases suited to speech, and KPI slides are appropriately sparse. However slide 14 contains a truncated fragment ('Grew at twice the pace of overall energy demand over the ...') and the comparison slides (18, 19, 23) push toward denser bullet stacks; trim these to keep parity with spoken delivery.
- **naacl-good-conversation** (3/5): Comparison slides (7, 8, 11, 12, 18) each pack two columns of ~4 bullets plus a bottom-line sentence, and slide 15 stacks eight labeled items across two columns — heavier than ideal for spoken delivery. The human reference achieves the same content with far sparser slides. KPI and quote slides are well-calibrated.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Most slides use concise labelled phrases suited to speech. Slide 5 ('De basis van het programma') crams two sections (three fundamenten plus two kerndoelen) onto one slide, making it denser than ideal; splitting or trimming would improve pacing.
- **pbl-kev-2024** (4/5): Most slides are well-calibrated for spoken delivery, with KPI slides and short list items. Slide 16 (landbouw/landgebruik) is overloaded with five list blocks each carrying a full explanatory sentence, edging toward density. Otherwise the text-per-slide balance is good and presenter notes carry the detail.
- **philips-q4-2024** (4/5): KPI slides (3, 4, 15, 17) are appropriately terse with big numbers and one-line qualifiers, and detail is pushed to presenter notes. List slides 5, 14, 18 are slightly denser but still presentable; only the geographic chart on slide 11 feels thin for a full slide.
- **wikipedia-zero-knowledge-proof** (4/5): Most slides use crisp label-plus-phrase pairs suited to speaking (e.g., slide 6 'Probabilistic Soundness: Guessing gives 50% per round → 1 in 2^20'). A few list slides like slide 17 carry four items plus sub-descriptions that edge toward dense, but nothing is a wall of text.

### Presentability (3.91)

- **asml-q4-2024** (4/5): Titles are meaningful and standalone ('Record Fourth Quarter', 'Strong Balance Sheet', 'Returning Cash to Shareholders'), and the quote slide (8) is well-placed. The truncated body text on slide 12 is the one defect a human would need to fix before presenting.
- **cbs-persbericht-criminaliteit** (4/5): Titles carry meaning ('Traditioneel stabiel, online in beweging') and slides work standalone; register suits a statistics briefing. Only the erroneous chart on slide 5 would need correcting before presenting.
- **cbs-veiligheidsmonitor-2025** (4/5): Titles carry meaning and slides work standalone (e.g. 'Onveiligheidsgevoelens nemen toe', 'Grote steden onder druk'). Register suits official statistics. Minor issues: the '+20% sinds 2005' annotation under '2 op 3 tevreden over het contact' (slide 25) is slightly ambiguous, and a couple of KPI change-annotations read as fragments, but a presenter could use this after light editing.
- **cloudflare-nov-2025-outage** (4/5): Titles carry meaning (e.g. 'The Fatal Limit', 'Blast Radius') and slides largely stand alone. Minor issue: slide 2's '11:20+ UTC Root Cause' label is vague where the source pins the triggering change to 11:05, so tighten that timestamp to avoid presenter confusion.
- **deckyard-readme** (3/5): Titles carry meaning and slides mostly stand alone, but slide 5's table is garbled — a stray 'on' token appears mid-header ('Google Slides + Gemini on Capability') and the column structure reads messily. Fix the table rendering and the 'Unknown' quote attribution before presenting.
- **iea-weo-2024** (4/5): Titles carry meaning and slides stand alone ('A Wave of New LNG — But Who Will Buy It?', 'Energy Access: The Great Inequity'), and presenter notes add value. The truncated KPI on slide 14 would need a fix before presenting, and a couple of subtitle-as-title constructions (slide 15) could be cleaned up.
- **naacl-good-conversation** (4/5): Titles carry the message ('Repetition — The Biggest Quality Killer', 'Humanness ≠ Engagingness') and most slides stand alone. Presenter notes add useful context. Minor issue: slide 15's split-table format ('Controls' vs 'Effect on Quality') is a bit awkward to read aloud without the notes.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Titles carry meaning (e.g. 'Knelpunten die koplopers belemmeren', 'Breed gedragen en Europees erkend') and slides stand alone. Presenter notes add useful context. Minor issue: slide 3 lists 'AI als versneller' as a benefit card alongside strategic reasons, slightly mixing categories.
- **pbl-kev-2024** (4/5): Titles are meaningful and carry the message (e.g. 'Klimaatdoel 2030 raakt uit zicht', 'ESR-doel wordt ruim gehaald', 'Tempo schiet ernstig tekort richting 2040'). Slides work standalone and the register suits the material. The chart slide (10) and KPI slides are presentable after light editing. The payoff slide is a reasonable close.
- **philips-q4-2024** (4/5): Titles carry meaning ('Profitability & Cash Flow Strengthened', 'Productivity Ahead of Plan') and slides stand alone. The payoff title on slide 19 is a full sentence rather than a headline, and slide 11's bare regional table would benefit from an actual chart, but light editing suffices.
- **wikipedia-zero-knowledge-proof** (4/5): Titles are meaningful and standalone (e.g., 'Probabilistic, Not Deterministic', 'Discrete Logarithm Proof'), register suits a technical talk, and presenter notes add useful color. Slide 11's KPI framing of 1/2^100 as a metric is slightly forced but presentable after light editing.

## Top issue per case

- **asml-q4-2024**: Fix broken/overncated body text on slide 12 (the 'The 2024 Annual Reports (US GAAP an...' fragment) and ensure list-slide bodies render as complete phrases rather than truncated paragraphs; also surface the High NA EUV shipment highlight on a slide rather than burying it in presenter notes.
- **cbs-persbericht-criminaliteit**: Correct the index figures on the long-term-trend chart (slide 5) to match the source exactly (e.g. 2017=76.7/66.1, 2021=56.6/48.3, 2023=65.7/56.7); never approximate or invent data points for charts.
- **cbs-veiligheidsmonitor-2025**: Trim the densest list slides (28, 29) to ~4 items and reorganise the body around the report's own headline tension — long-term declines in slachtofferschap versus recent rises in onveiligheidsgevoelens, sociale overlast and respectloos gedrag — rather than mechanically following the chapter order.
- **cloudflare-nov-2025-outage**: Reduce the number of labeled mini-blocks on the technical slides (7, 8, 10) so each slide reads cleanly when spoken; move the finer detail entirely into presenter notes.
- **deckyard-readme**: Fix the table slide (slide 5): remove the stray 'on' artifact and render clean Capability/Deckyard/Other-tools columns, since a broken comparison table undermines the deck's key positioning moment.
- **iea-weo-2024**: Cut length and text density toward a leaner, more chart-oriented deck (the human version used ~11 sparse, data-visual slides); consolidate the bullet-heavy comparison slides and fix the truncated metric on slide 14.
- **naacl-good-conversation**: Thin out the dense two-column comparison and text-block slides toward the sparser style of the reference, and promote the A/B interestingness test and future-work insights from presenter notes into actual slides.
- **nl-kamerbrief-duurzame-digitalisering**: Surface the supporting topics currently hidden in presenter notes (openstaande moties, the koplopers/Manifest examples) onto actual slides, and de-duplicate the kerndoelen that appear on both slide 5 and slide 7.
- **pbl-kev-2024**: The deck reads as a neutral summary of KEV findings, but the human reference shows the intended use is a policy-advice deck framed around per-sector restopgave and concrete beleidsopties. Reframe toward actionable aandachtspunten (what beleid could close the gap per sector) rather than a descriptive recap.
- **philips-q4-2024**: Add a slide addressing net income and tax—the FY net loss of EUR 698M and the ~EUR 1B tax charge from US deferred-tax-asset derecognition—so the deck reflects the source's full financial picture rather than only the operational positives.
- **wikipedia-zero-knowledge-proof**: Do not invent dates or figures not present in the source: remove the fabricated 2013/2014 blockchain dates (slide 18) and the 1986 GMW date (slide 21), using only years the source states explicitly.

## Cost breakdown

| Category | Calls | Input | Output | Cache write | Cache read | USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | 63 | 1588284 | 103834 | 0 | 0 | $10.5373 |
| judge | 11 | 531889 | 24897 | 0 | 0 | $3.2819 |
| topics | 1 | 11758 | 987 | 0 | 0 | $0.0835 |
| **Total** | 75 | 2131931 | 129718 | 0 | 0 | **$13.9026** |
