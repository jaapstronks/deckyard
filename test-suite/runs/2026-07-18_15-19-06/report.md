# AI suite run `2026-07-18_15-19-06`

- **Date**: 2026-07-18T15:19:06.382Z
- **Model**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `2f0e86683435`
- **Cases**: 11 (asml-q4-2024, cbs-persbericht-criminaliteit, cbs-veiligheidsmonitor-2025, cloudflare-nov-2025-outage, deckyard-readme, iea-weo-2024, naacl-good-conversation, nl-kamerbrief-duurzame-digitalisering, pbl-kev-2024, philips-q4-2024, wikipedia-zero-knowledge-proof)
- **Repeats per case**: 1
- **API cost**: $26.6812

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.64 | — |
| Structure | 4.64 | — |
| Slide economy | 3.91 | — |
| Faithfulness | 4.73 | — |
| Presentability | 3.91 | — |
| Closeness to human deck | 2.80 | — |
| **Overall** | **4.37** | — |

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| asml-q4-2024 | A | 11 | 23.55 | 0 | 88% | 4/5 | 4.33 |
| cbs-persbericht-criminaliteit | B | 13 | 26.08 | 0 | 95% | 5/5 | 4.60 |
| cbs-veiligheidsmonitor-2025 | B | 33 | 32.82 | 0 | 98% | 5/5 | 4.40 |
| cloudflare-nov-2025-outage | B | 18 | 40.33 | 0 | 100% | 5/5 | 4.60 |
| deckyard-readme | B | 14 | 36.43 | 0 | 100% | 4/5 | 4.40 |
| iea-weo-2024 | A | 23 | 53.22 | 5 | 70% | 5/5 | 4.17 |
| naacl-good-conversation | A | 26 | 34.08 | 0 | 89% | 5/5 | 4.00 |
| nl-kamerbrief-duurzame-digitalisering | B | 13 | 29.23 | 0 | 100% | 5/5 | 4.00 |
| pbl-kev-2024 | A | 24 | 31.5 | 0 | 98% | 4/5 | 3.83 |
| philips-q4-2024 | A | 22 | 29.23 | 0 | 100% | 5/5 | 4.17 |
| wikipedia-zero-knowledge-proof | B | 25 | 42.28 | 0 | 100% | 4/5 | 4.20 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Closeness to human deck (2.80)

- **asml-q4-2024** (3/5): Shares chapter-divider and quote-slide instincts with the reference, but makes a much leaner editorial choice: the human deck devotes many slides to sales breakdowns by end-use/region, product highlights (NXT:2150i, NXT:870B), full financial statements and investor key messages incl. the 2030 opportunity. The generated deck is an executive summary that omits all of that detail.
- **iea-weo-2024** (3/5): Thematic sequencing overlaps (market context, oil/EVs, LNG, electricity), but editorial judgement diverges sharply: the human deck is a lean, chart-driven 12 slides with minimal text and a dedicated critical-minerals and emissions-peak slide, whereas this deck is 23 text-heavy bullet slides. It also omits the minerals-gap story the human chose to include.
- **naacl-good-conversation** (3/5): Overlaps with the human deck on core editorial choices (engagingness≠humanness as a headline, the balance thesis, matching the winner with less data, specificity examples). But it misses the human deck's distinctive framing devices — the NLG task spectrum opener and the Q1/Q2/Q3 research-question spine — and omits the memorable 'paid Turkers aren't engaging conversationalists' caveat from the slides. It also runs text-heavier than the sparse human slides, reflecting different editorial judgement.
- **pbl-kev-2024** (2/5): The human deck is a targeted policy-advisory ('Aandachtspunten voor klimaatbeleid 2030') built around per-sector restopgave and concrete beleidsopties/quick-wins, plus dense appendix tables comparing KEV 2022/2023/2024. The generated deck is a descriptive executive summary that leads with headline findings and devotes chapters to the probability methodology and European goals - content the human deck deliberately omits. The shared editorial move is sector-by-sector treatment with restemissie focus, but the fundamental purpose (advise the minister vs. summarise the report) and much of the content selection and sequencing diverge.
- **philips-q4-2024** (3/5): Shares the human deck's segment-by-segment treatment, productivity slide, outlook slide and key-takeaways/payoff close. But it diverges on editorial judgement: it omits the human deck's lead 'three-year plan tracking' table (slide 5) and the Adj. EBITA bridge (slide 13), while devoting more real estate to innovation detail and dividend mechanics than the human presenter chose. It also lacks the appendix orientation (working capital, debt maturity) the human deck favored.

### Slide economy (3.91)

- **asml-q4-2024** (5/5): KPI slides (3-5, 9) use single figures with terse labels ideal for speaking, and slide 7 guidance is five clean bullets. Detail is pushed to presenter notes, keeping on-slide text spoken-friendly.
- **cbs-persbericht-criminaliteit** (4/5): Most slides are well-portioned for speech (KPI slides 4/6, chart slides 8/12). Slide 2 and slide 11 stack an intro line plus four header+description pairs, edging toward dense; the descriptions partly duplicate the headers (e.g. 'Slachtofferschap gestegen' / '17% van 15-plussers werd slachtoffer'). Trimming those would sharpen delivery.
- **cbs-veiligheidsmonitor-2025** (4/5): KPI slides (5, 9, 17, 26) are punchy and well-suited to speech, and chart slides 6/18 are lean. Some list slides carry four items each with a sub-line (e.g. slide 14 has six grounds, slide 31 five measures) which edges toward dense, but text stays at phrase level rather than sentences.
- **cloudflare-nov-2025-outage** (4/5): Most slides use tight phrases (e.g., slide 8's 'Hard Limit: 200 / Normal use is only ~60 features'). A few list slides pack five items each (slides 3, 4, 11) which is near the upper bound for spoken delivery, but presenter notes carry the elaboration rather than the slides themselves.
- **deckyard-readme** (4/5): Label-plus-phrase format on list slides (e.g. slide 6 'stdio transport / Local clients like Claude Desktop and Cursor') is well-sized for speaking. Slide 4's table has slightly compressed rows but remains readable; nothing approaches a wall of text.
- **iea-weo-2024** (4/5): List slides consistently use short phrase-led bullets (e.g. slide 16 'EV Surge — ~20% of new car sales now, rising toward 50% by 2030'), appropriate for speaking. Slightly heavy at 5-6 items per slide (slides 8, 16, 20), and presenter notes are dense, but the on-slide text is disciplined.
- **naacl-good-conversation** (3/5): Most list slides use a header+phrase pattern that works for speaking, but slide 8 packs six items and the comparison slides (15,16) contain literal '\n' escape sequences that would render as raw text rather than line breaks — a visible economy/formatting flaw. Text density is generally on the higher side compared to the terse human deck.
- **nl-kamerbrief-duurzame-digitalisering** (3/5): Most slides use tight phrases, but slide 4 dumps raw template parameters into the body ('4','yellow','down','yes','2','black'), producing a confusing wall rather than clean text blocks. The generator should strip layout metadata and keep only label/description pairs.
- **pbl-kev-2024** (4/5): KPI and content slides are clean and presentable (e.g. slides 3, 9, 19, 20). A few list slides carry five items (slides 7, 22) which is near the upper limit for spoken delivery, but no slide is a wall of text and none is so sparse it says nothing.
- **philips-q4-2024** (4/5): KPI-metric slides (3,4,7-9,14,16,17) use concise figures suited to spoken delivery, and list slides (12,19,21) are appropriately trimmed. A few slides pack four dense metric cards with sub-labels (slide 16 net income line, slide 17), edging toward crowding, but no walls of text.
- **wikipedia-zero-knowledge-proof** (4/5): Most slides use tight header+phrase pairs suited to speaking. A few list slides carry five items each with descriptions (slides 7, 11, 19), pushing toward density, but none is a wall of text and the process slides (5, 6, 8) are well-paced.

### Presentability (3.91)

- **asml-q4-2024** (4/5): Titles carry meaning ('Record Q4 2024 Performance', 'Returning Cash to Shareholders') and slides stand alone. Minor nit: slide 9 shows three dividend figures but the '1.52 interim' vs '1.84 final' relationship needs the note to be fully clear to an audience.
- **cbs-persbericht-criminaliteit** (4/5): Titles carry meaning and slides stand alone. Main flaw: slide 9 embeds literal '\n' characters inside the bullet strings ('- Amsterdam (63)\n- Utrecht (54)...'), which would render as raw text rather than line breaks and needs cleanup before presenting.
- **cbs-veiligheidsmonitor-2025** (4/5): Most titles carry a message ('Onveiligheidsgevoelens stijgen', 'Sociale overlast neemt toe', '1 op de 5 slachtoffer'). Slides work standalone with useful presenter notes. Weak spots: slide 32 bullet 'Meer dan 70.000 boven gemiddelde' is confusingly worded, and slide 13 mixes the table value 12,5% with a '(2021: 9%)' delta where the source text uses 13%.
- **cloudflare-nov-2025-outage** (4/5): Titles are meaningful and slides stand alone (e.g., 'The Status Page Red Herring'). The main flaw is the comparison slide (9) containing literal '\n' escape sequences in the bullet content, which would render as visible text and needs light cleanup before presenting.
- **deckyard-readme** (4/5): Titles carry meaning ('27 Tools Across the Full Lifecycle', 'Deploy in One Command') and slides stand alone. Minor polish needed: slide 4's stray '3' / 'on' and slide 3's stray '3' artifacts suggest layout-config values leaking into content that an editor should remove.
- **iea-weo-2024** (3/5): Most titles carry meaning and slides stand alone, but slide 5 leaks template artifacts as visible tokens ('2','yellow','down','yes','3','black'), which would embarrass a presenter. Fix the text-blocks template so control/styling values never render on the slide.
- **naacl-good-conversation** (4/5): Titles carry meaning (e.g. 'Repetition: Three Types Identified', 'Humanness ≠ Engagingness') and slides largely stand alone. The main blemish is the unrendered '\n' in slides 15-16, which a presenter would need to fix before showing. Register suits a research talk.
- **nl-kamerbrief-duurzame-digitalisering** (3/5): Titles are meaningful and slides mostly stand alone, but slide 4's leaked template tokens ('yellow','down','yes','2 black') would embarrass a presenter and require cleanup before use. Fix the rendering and this rises to 4-5.
- **pbl-kev-2024** (4/5): Titles carry meaning and could stand alone (e.g. 'Geagendeerd beleid voegt netto weinig toe', 'Elektriciteit: sterkste daler'). Register suits the material. Slide 4's text-block structure with 'Extra reductie 3 yellow / Extra emissies 2 black' is slightly awkward to parse, but overall a human could present this after light editing.
- **philips-q4-2024** (5/5): Titles carry meaning ('Productivity Ahead of Plan', 'Respironics Recall Resolved', 'Strong Balance Sheet') rather than being generic labels, and slides stand alone with presenter notes adding context. Register suits an investor results deck and would need only light editing.
- **wikipedia-zero-knowledge-proof** (4/5): Titles are meaningful and slides stand alone. The one real defect is slide 3, where the source markup 'Prover and verifier exchange messages\n- Back-and-forth...' contains literal '\n' escape sequences that would render as visible text rather than line breaks—needs cleanup before presenting.

## Top issue per case

- **asml-q4-2024**: Add the forward-looking 2030 growth story (semiconductor market >$1T by 2030 and ASML's €44-60B revenue opportunity from Investor Day) which the reference deck treats as the headline investor message, rather than stopping at the 2025 range.
- **cbs-persbericht-criminaliteit**: Fix the comparison-slide rendering: replace literal '\n' escape sequences with real list items so bullets display correctly, and lightly de-duplicate the header/description pairs on the list slides.
- **cbs-veiligheidsmonitor-2025**: Tighten a handful of list-slide bullet labels so each reads cleanly standalone (e.g. slide 32's 'Meer dan 70.000 boven gemiddelde' should be rephrased to '70.000+ gemeenten scoren boven gemiddeld'), and align delta figures with the values shown (slide 13 OV).
- **cloudflare-nov-2025-outage**: Fix the literal '\n' escape sequences in the comparison slide (9) so bullet points render as separate lines rather than raw text.
- **deckyard-readme**: Strip layout/config artifacts (stray '3', 'on', 'horizontal' tokens on slides 3, 4, 9) from rendered slide content so nothing but presentable text reaches the audience.
- **iea-weo-2024**: Fix the text-blocks-slide template so styling/control values (e.g. 'yellow','black','down','yes' on slide 5) never render as visible slide text.
- **naacl-good-conversation**: Fix the literal '\n' escape sequences in the comparison slides (15-16) so bullets render as separate lines, and trim the densest list slides toward the terser phrasing of a spoken talk.
- **nl-kamerbrief-duurzame-digitalisering**: Fix the text-blocks-slide rendering so layout parameters (e.g. '4','yellow','down','yes','2','black' on slide 4) never leak into slide body content; emit only clean label/description text.
- **pbl-kev-2024**: The deck is a faithful descriptive summary, but the human editorial approach reframes each sector around its restopgave and concrete policy levers (quick-wins, beprijzing, normering, uitvoeringsknelpunten). Shift the sector slides from 'what the report says' toward 'what remains to be done and which policy options address it' to match the advisory judgement.
- **philips-q4-2024**: Lead with the three-year-plan progress framing (comparable sales, margin, FCF vs. targets) that anchors the human deck, and add an Adjusted EBITA bridge; also fix the slide 4 metric card that mislabels rest-of-world sales growth as order intake.
- **wikipedia-zero-knowledge-proof**: Fix the literal '\n' escape sequences rendering as visible text in the comparison slide (slide 3), and consider restoring the omitted 'Where's Waldo' example and the 'zero-knowledge types' distinctions (proof of knowledge, witness-indistinguishable) to fully match the source.

## Cost breakdown

| Category | Calls | Input | Output | Cache write | Cache read | USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| topics | 11 | 165 | 9242 | 939146 | 0 | $6.1015 |
| generation | 66 | 2135030 | 114879 | 0 | 0 | $13.5471 |
| judge | 11 | 80733 | 27167 | 951945 | 0 | $7.0325 |
| **Total** | 88 | 2215928 | 151288 | 1891091 | 0 | **$26.6812** |
