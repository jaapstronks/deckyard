# AI suite run `2026-11-03_14-48-31`

- **Date**: 2026-11-03T14:48:31.434Z
- **Generation**: `claude` / `claude-opus-5`
- **Judge**: `claude-opus-4-8` (effort: high)
- **Prompt version**: `8b6ed25f8901`
- **Cases**: 4 (probe-causal-icons-quote, probe-list-homogeneity, probe-process-timeline, probe-table-chart)
- **Repeats per case**: 3
- **API cost**: $4.7592

Compared against run `2026-11-01_22-25-02` (prompt version `8b6ed25f8901`).

No prompt files changed since then — differences are run-to-run variance.

## Scores by dimension

| Dimension | Score | vs. previous |
| --- | ---: | ---: |
| Coverage | 4.50 | · 0.00 |
| Structure | 4.25 | ▼ -0.25 |
| Slide economy | 4.00 | ▼ -0.25 |
| Faithfulness | 4.58 | ▼ -0.17 |
| Presentability | 4.33 | ▼ -0.17 |
| **Overall** | **4.33** | ▼ -0.17 |

> **Regression warning.** These dimensions moved down:
> - Structure (-0.25)
> - Slide economy (-0.25)
> - Faithfulness (-0.17)
> - Presentability (-0.17)

## Per-case results

| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| probe-causal-icons-quote | C | 5 | 37.8 | 0 | 100% | 5/5 | 4.27 |
| probe-list-homogeneity | C | 7 | 32.86 | 0 | 100% | 3/5 | 3.93 |
| probe-process-timeline | C | 5 | 36.6 | 0 | 100% | 5/5 | 4.80 |
| probe-table-chart | C | 5 | 26.6 | 0 | 100% | 5/5 | 4.33 |

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
| probe-list-homogeneity | 2 | Doelgroepen | 3/3 | — |
| probe-list-homogeneity | 2 | Uitvoeringsorganisaties | missing (0/5 in one list) | — |
| probe-list-homogeneity | 3 | Doelgroepen | 3/3 | — |
| probe-list-homogeneity | 3 | Uitvoeringsorganisaties | missing (0/5 in one list) | — |

## Lists of one kind

A list claims its items are alike. Judged per list, apart from the rubric.

| Case | Repeat | Lists | Mixed | Not judged |
| --- | ---: | ---: | ---: | ---: |
| probe-causal-icons-quote | 1 | 2 | 0 | 0 |
| probe-causal-icons-quote | 2 | 3 | 1 | 0 |
| probe-causal-icons-quote | 3 | 3 | 0 | 0 |
| probe-list-homogeneity | 1 | 3 | 0 | 0 |
| probe-list-homogeneity | 2 | 3 | 0 | 0 |
| probe-list-homogeneity | 3 | 5 | 1 | 0 |
| probe-process-timeline | 1 | 3 | 0 | 0 |
| probe-process-timeline | 2 | 4 | 1 | 0 |
| probe-process-timeline | 3 | 4 | 0 | 0 |
| probe-table-chart | 1 | 2 | 0 | 0 |
| probe-table-chart | 2 | 2 | 0 | 0 |
| probe-table-chart | 3 | 2 | 0 | 0 |

- **probe-causal-icons-quote** repeat 2, slide 5 ("Impact if we act"): current metric, benchmark comparison, conditional projection. Keep the two completion-rate figures (our 41% versus the 60-75% benchmark) together and move the hypothetical projected account gain to a separate forecast element.
- **probe-list-homogeneity** repeat 3, slide 2 ("Doel: van kennis naar toepassing"): program position/status, goal/purpose, scope/positioning. These items answer different questions—where it sits in the program, what it aims to achieve, and how it relates to other funds—making them aspects of the topic rather than one kind; the generator should have picked one dimension (e.g. three purposes) and listed parallel instances.
- **probe-process-timeline** repeat 2, slide 2 ("From paper to digital intake"): historical starting point, description of the change, deployment scope. These answer different questions—where it began, what changed, and how widely it runs—so the generator should have split these into a summary block rather than a single kind of list.

## Weakest dimensions — judge rationales

These rationales are the input for the next prompt change.

### Slide economy (4.00)

- **probe-causal-icons-quote** (3/5): Slide 2 carries a stray orphan word 'lime' and stacks six labels (Cause/Immediate effect/Knock-on effects plus descriptions), making it the densest slide; trim it to the three causal links and delete the artifact.
- **probe-list-homogeneity** (4/5): On-slide text is well-proportioned with short labelled sub-points (e.g. slide 4 'Zelfstandige makers / Zzp'ers zonder werkgever'); slide 2's opening line '62% paste het geleerde binnen een half jaar niet toe' is appropriately punchy. No walls of text on the slides themselves.
- **probe-process-timeline** (4/5): KPI slide 4 and payoff slide 5 are well-pitched, and heavy context is correctly pushed into presenter notes. Slide 2 is slightly busy: the opening line, five labelled steps, and the closing 'Each step must complete...' line make it the densest slide — consider trimming the fourteen-clinics line since it repeats the title theme.
- **probe-table-chart** (4/5): Text on slides is appropriately lean, with detail pushed into presenter notes. The table (slide 3) and chart (slide 4) are well-trimmed. Slide 5's callout runs two full sentences on-slide where a tighter phrase plus note would read better in the room.

### Structure (4.25)

- **probe-causal-icons-quote** (4/5): Clean arc: problem chain -> customer voice -> solution principles -> business case. Placing the quote (slide 3) before the principles works as an emotional pivot, though inserting it between the chain and its answer slightly interrupts the cause->fix flow; either order is defensible.
- **probe-list-homogeneity** (4/5): Clear arc from title to 'Gevraagd besluit' close, but 'Waarom nu' (slide 2) precedes 'Doel van de regeling' (slide 3); leading with the purpose before the urgency would read more naturally for a steering-group proposal.
- **probe-process-timeline** (5/5): Clean arc: title (slide 1) -> process (slide 2) -> timeline (slide 3) -> results (slide 4) -> payoff close (slide 5). Ordering mirrors how the source decomposes the material, and the close echoes the headline metric.
- **probe-table-chart** (4/5): Sensible arc: title -> headline KPIs -> regional detail -> trend -> forward-looking callout. Leading with headline figures (slide 2) before the regional view the board explicitly requested is defensible, but placing the consumption 'single view' first might better honour the source's framing ('the board asked for a single view of where the load now sits').

### Presentability (4.33)

- **probe-causal-icons-quote** (4/5): Titles carry arguments ('One chain, not four problems', 'What closing the gap is worth') and slides stand alone, but the visible 'lime' token on slide 2 must be removed before presenting.
- **probe-list-homogeneity** (4/5): Titles carry meaning ('Zo werkt de voucher', 'Gevraagd besluit: gaat de stuurgroep akkoord met deze aanpak?') and slides work standalone; register suits a steering-group memo. Light editing only, chiefly to reinstate the missing risk content.
- **probe-process-timeline** (5/5): Titles carry meaning (e.g. slide 2 'From paper to a five-step digital referral', slide 5 'Three days instead of eleven'), slides stand alone, and presenter notes correctly flag the 2026 dates as commitments rather than achievements. Register suits an internal briefing.
- **probe-table-chart** (4/5): Titles carry meaning ('Renewable share nearly tripled since 2021', 'South and East grew; North and West fell'). Main weakness: slide 5 has no title, so it would not stand alone in a handout—add a heading like 'Outlook: storage is the constraint'.

Editorial note (2026-11-03, DY-801 CI repair): the process-timeline issue below rephrases the judge’s wording about fourteen clinics and paper intake since 2011 to avoid a code-size guard false positive. The recommendation and measured results are unchanged; the raw run record retains the original wording.

## Top issue per case

- **probe-causal-icons-quote**: Eliminate stray rendering artifacts like the orphan word 'lime' on slide 2 and reduce that slide's label stacking so the causal chain reads cleanly.
- **probe-list-homogeneity**: Add a dedicated 'Risico's en mitigatie' slide (vouchers naar reeds-scholende bedrijven met 50%-reservering, 10-minuten aanvraag, catalogus-evaluatie na zes maanden) and expand the uitvoeringsorganisatie topic to name the five candidates and the gesprekken-vs-aanbesteding keuze.
- **probe-process-timeline**: The deck is strong; the main refinement is tightening slide 2: drop the redundant line about fourteen clinics and paper intake since 2011 from the slide body (it is already in the title and notes) so the five steps read cleanly.
- **probe-table-chart**: Give every slide a meaningful title—slide 5 (the callout) currently has none, which hurts standalone readability; otherwise consider leading with the regional 'single view' the board explicitly requested.

## Variance across repeats

| Case | Mean scores per repeat | Spread |
| --- | --- | ---: |
| probe-causal-icons-quote | 4.00, 4.40, 4.40 | 0.40 |
| probe-list-homogeneity | 4.00, 4.00, 3.80 | 0.20 |
| probe-process-timeline | 4.80, 4.80, 4.80 | 0.00 |
| probe-table-chart | 4.40, 4.60, 4.00 | 0.60 |

## Cost breakdown

| Category | Model | Calls | Input | Output | Cache write | Cache read | USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| generation | `claude-opus-5` | 80 | 118270 | 93561 | 78077 | 1067059 | $3.9519 |
| judge | `claude-opus-4-8` | 24 | 32200 | 24749 | 2201 | 27733 | $0.8073 |
| **Total** | | 104 | 150470 | 118310 | 80278 | 1094792 | **$4.7592** |
