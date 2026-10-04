# AI suite run `2026-10-04_12-24-56`

- **Date**: 2026-10-04T12:24:56.133Z
- **Generation**: `claude` / `claude-opus-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `8891b874efba`
- **Cases**: 3 (deckyard-readme, nl-kamerbrief-duurzame-digitalisering, philips-q4-2024)
- **Repeats per case**: 1
- **API cost**: $6.0749

Compared against run `2026-10-04_12-13-30` (prompt version `8891b874efba`).

No prompt files changed since then — differences are run-to-run variance.

## Scores by dimension

| Dimension      |    Score | vs. previous |
| -------------- | -------: | -----------: |
| Coverage       |     5.00 |       · 0.00 |
| Structure      |     4.67 |       · 0.00 |
| Slide economy  |     3.33 |      ▲ +0.33 |
| Faithfulness   |     4.67 |       · 0.00 |
| Presentability |     4.00 |      ▲ +0.67 |
| **Overall**    | **4.33** |      ▲ +0.20 |

## Per-case results

| Case                                  | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| ------------------------------------- | --- | -----: | ----------: | ----: | -------------: | -------: | ---: |
| deckyard-readme                       | B   |     30 |       40.67 |     0 |           100% |      5/5 | 4.40 |
| nl-kamerbrief-duurzame-digitalisering | B   |     14 |       40.79 |     0 |           100% |      5/5 | 4.20 |
| philips-q4-2024                       | A   |     30 |       39.67 |     0 |            99% |      5/5 | 4.40 |

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (3.33)

- **deckyard-readme** (3/5): Several icon-card-grid slides (8, 16, 21, 23, 24) pack 4-5 label+description pairs, and slide 25's text-blocks layout crams a flag, endpoint, and three presence features. Slide 6's table is dense with 7 rows and 4 columns. These push toward read-not-present; the generator should cap cards at 3-4 and shorten descriptions to phrases.
- **nl-kamerbrief-duurzame-digitalisering** (3/5): Slides 4 and 8 are dense: slide 4 stacks knelpunt + 'AI versnelt beide' + three labelled gevolgen each with a full sentence, and slide 8 carries six label+sentence pairs. Trim each card to a bare phrase (e.g. 'Versnipperd beleid' without the trailing clause) so these don't read as text walls.
- **philips-q4-2024** (4/5): On-slide text is appropriately terse — KPI cards (slides 3, 15, 19) and list slides (21, 23) use phrases not sentences, and the heavy exposition sits in presenter notes where it belongs. Slide 26's seven-row balance-sheet table with two '—' blanks (group equity, total assets missing 2023) is slightly cluttered and leaves gaps a presenter can't explain.

### Presentability (4.00)

- **deckyard-readme** (4/5): Titles are mostly meaningful and slides stand alone, but slide 6 carries a stray 'on' artifact above 'Capability' that would embarrass on screen, and title casing is inconsistent (e.g. 'For presenters' sentence case vs 'How Deckyard Compares' title case). Normalise casing and strip the table artifact.
- **nl-kamerbrief-duurzame-digitalisering** (4/5): Titles carry meaning (e.g. 'Doel 1: de digitale sector als duurzaam Europees koploper') and slides stand alone with helpful presenter notes. Slight register awkwardness in titles like 'Koplopers vragen erom — markt en Europa staan erachter' could be tightened, but light editing suffices.
- **philips-q4-2024** (4/5): Titles carry the message (e.g. slide 5 'Income from operations up sharply; net income negative', slide 15 'Productivity ahead of plan — target raised to EUR 2.5 billion'), and slides stand alone. Minor blemish: slide 5 leaves 2023 net income as '—' though the source gives Q4 38 / FY -463, so the comparison a presenter would naturally make is incomplete.

### Structure (4.67)

- **deckyard-readme** (5/5): Clear arc: title (1), what-it-is (2-5), comparison (6), three-audiences chapter (7-10), install (11-13), MCP chapter (14-18), AI pipeline (19), customization (20-25), deploy/operate (26-29), payoff close (30). Chapter-title dividers mirror how the README decomposes, and the three-audience section reuses the README's own framing.
- **nl-kamerbrief-duurzame-digitalisering** (5/5): Clean arc: context/aanleiding (slides 2-6), program and two goals (slides 7-10), collaboration and results (slide 11), moties (slide 12), ministerial quote (slide 13), payoff (slide 14). The knelpunt->basis->doelen logic on slides 4/8/9/10 mirrors how the source itself decomposes.
- **philips-q4-2024** (4/5): Strong arc with clear chapter dividers (slides 2, 9, 14, 18, 22) moving from results to segments to legacy issues to outlook. The one weakness is slide 22 'Innovation, Balance Sheet and Shareholders' bundling three unrelated themes into a catch-all chapter; splitting innovation from capital/governance would read more cleanly.

## Top issue per case

- **deckyard-readme**: Trim on-slide density: cap icon-card grids at 3-4 cards with phrase-length descriptions (not full sentences) and clean up the table on slide 6, which has a stray 'on' fragment and too many cramped rows.
- **nl-kamerbrief-duurzame-digitalisering**: Reduce text density on the text-blocks slides (4 and 8): keep card labels but cut the explanatory sentences to short phrases so each slide reads at a glance rather than as paired label+sentence blocks.
- **philips-q4-2024**: Fill in table placeholders rather than leaving '—' where source data exists (slide 5 omits 2023 net income of 38/−463; slide 26 omits 2023 group equity and total assets), so comparison tables are complete and presentable.

## Cost breakdown

| Category   | Model             | Calls |  Input | Output | Cache write | Cache read |         USD |
| ---------- | ----------------- | ----: | -----: | -----: | ----------: | ---------: | ----------: |
| generation | `claude-opus-5`   |    36 | 738325 |  77336 |           0 |          0 |     $5.6250 |
| judge      | `claude-opus-4-8` |     3 |  57762 |   6443 |           0 |          0 |     $0.4499 |
| **Total**  |                   |    39 | 796087 |  83779 |           0 |          0 | **$6.0749** |
