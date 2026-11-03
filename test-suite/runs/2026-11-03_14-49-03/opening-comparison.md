# DY-801: mixed opening comparison

## Same-session measurement

The unchanged baseline (`89be3ae46`, prompt `8b6ed25f8901`) and this branch (prompt `4193425011a6`) each ran the same four probes with `--repeat 3`. Both use generation `claude-opus-5`, judge `claude-opus-4-8`, high judge effort and the existing core generation pipeline. Only the three prompt files in this PR differ. The original one-repeat measurement motivated the change; the fresh repeated baseline below is the comparison for its result.

- [Fresh baseline report](../2026-11-03_14-48-31/report.md), $4.7592.
- [Changed prompt report](report.md), $4.6777.
- Total API cost: $9.4369. Cached topic extraction in both runs; 24 newly generated decks.

The opening is slide 2, the first slide after the generated title. A mixed opening means the existing list judge marks an item collection on that slide `alike: false`; the instrument only judges collections of three or more items. Prose with no item collection is not a judged list. All 36 baseline and 35 branch eligible collections received verdicts.

| Probe | Baseline mixed opening repeats | Branch mixed opening repeats |
| --- | --- | --- |
| causal-icons-quote | none | none |
| list-homogeneity | 3 | 1 |
| process-timeline | 2 | none |
| table-chart | none | none |
| **Flagged openings / generated decks** | **2/12** | **1/12** |

| Other measurement | Baseline | Branch |
| --- | ---: | ---: |
| Total mixed lists, at any position | 3/36 | 4/35 |
| Declared source lists kept whole | 3/6 | 3/6 |
| Target-group lists, exactly three members and no strays | 3/3 | 3/3 |
| Organisation lists, exactly five members | 0/3 | 0/3 |
| Coverage rubric | 4.50 | 4.58 |
| Faithfulness rubric | 4.58 | 4.58 |
| Overall rubric | 4.33 | 4.38 |

The literal gate of fewer flagged openings with no listFidelity decrease is met in this small cohort. This is a directional observation, not evidence of statistical significance, complete resolution or a general improvement in all list quality. The total mixed-list count increased, and list-homogeneity still produces a mixed opening in one repeat.

## Manual opening check

On process-timeline the baseline repeat 2 uses a list with `Starting point`, `The change` and `Scope`. These are the exact mixed categories the change addresses. All three branch repeats instead use a plain content-slide body with two connected sentences. Each retains Zorggroep Noord, paper intake since 2011, its replacement with digital intake and coverage of all fourteen clinics. There are no bullet markers, item arrays or cards hiding the same list. The five referral steps, milestones and pilot metrics remain in their own slides.

Branch repeat 1, for example:

> Zorggroep Noord has run patient intake on paper since 2011. The programme replaces that process with a digital intake used across all fourteen clinics.

On list-homogeneity, branch repeats 2 and 3 use connected prose about turning developed knowledge into application at work. Repeat 1 still uses markdown bullets for a finding (62%), a barrier (time and money) and a market trend. The judge catches it despite its content-slide type, so the measurement is not evaded by changing the slide type. This is the one remaining flagged opening. Baseline repeat 3 mixes the programme's position, purpose and relationship to existing funds. Baseline repeat 2 uses a two-item opening list, outside this judge's three-item threshold; it is not counted as a positively judged homogeneous opening.

The short source list remains intact in every branch deck: creative-sector SMEs, self-employed makers and MBO/HBO institutions, exactly three with no stray framing item. All baseline and branch decks omit the five organisations as one complete list. This pre-existing source-list omission is unchanged, not solved by the opening rule.

The causal probe still opens with the genuine causal sequence, using process or text-blocks slides. The table/chart probe still opens with genuine headline metrics or the region table. No blanket conversion of useful lists to prose occurred.

## Remaining mixed lists

The branch's four mixed flags are the list-homogeneity opening above, one later finding/cause/trend list, and two causal-probe KPI rows mixing a current metric, benchmark and forecast. The baseline has one such KPI flag and its two mixed openings. The KPI classification was already a documented ambiguity in DY-800. This PR does not change the judge or broaden the prompt intervention to those later slides.

No confidential board paper was read or imported for this measurement. The comparison covers synthetic probes and one vendor only. Generated decks and full run records remain ignored local run data; the two reports, this comparison and the history entries are committed for review.

## Local checks

106 focused tests pass: prompt seams/cache/backgrounds, catalogue boundaries/examples, outline/refinement and AI-suite metrics/judges. Full ESLint, Prettier on changed prompt files and `git diff --check` pass. No app UI or renderer changes; no browser test. GitHub CI is the full-suite gate for the independent reviewer.
