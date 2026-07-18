# AI slide-generation test suite

A repeatable harness that feeds source documents through Deckyard's AI
generation pipeline, scores the resulting decks, and reports the scores so the
in-app prompts can be tuned against evidence instead of impressions.

## Quick start

```bash
npm run ai-suite:fetch        # download case material (once)
npm run ai-suite:parse-refs   # parse human reference decks into JSON (once)
npm run test:ai-suite         # generate + evaluate + report
```

Everything needs `ANTHROPIC_API_KEY` in `.env`; the npm scripts pass
`--env-file=.env` for you.

## Options

```bash
npm run test:ai-suite -- --cases asml-q4-2024,deckyard-readme
npm run test:ai-suite -- --repeat 3          # expose run-to-run variance
npm run test:ai-suite -- --dry-run           # metrics only, no judge
npm run test:ai-suite -- --reuse-run <id>    # re-judge existing decks
npm run test:ai-suite -- --refresh           # bypass the judge/topic cache
npm run test:ai-suite -- --label "baseline"  # tag the run in history
```

| Flag | Effect |
| --- | --- |
| `--cases a,b` | Run a subset. Use this for iteration rounds; full runs are for milestones. |
| `--repeat N` | Generate each case N times. The model takes no temperature, so this is the only honest read on stability. |
| `--dry-run` | Skips the judge and topic extraction. Still generates decks, so it is not free. |
| `--reuse-run ID` | Re-evaluates decks from a previous run. Free of generation cost — use it when you change the *judge*, not the generation prompts. |
| `--refresh` | Forces judge and topic recomputation instead of reading the cache. |

## What comes out

Each run writes to `runs/<run-id>/`:

- `<case-id>/deck.json` — the generated deck, one per repeat
- `run.json` — full record: metrics, verdicts, cost, prompt version
- `report.md` — the human-readable report (committed; the rest is gitignored)

`history.json` accumulates one entry per run so progress across prompt versions
stays visible. Reports diff against the most recent previous run **that covered
the same case set**, so a 4-case iteration round is never compared against an
11-case milestone.

## How it is put together

```
lib/       config, cost accounting, caching, prompt versioning, SDK client
runner/    run.js — the CLI
eval/      metrics, topics, judge, reference comparison, reporting
scripts/   fetch-cases.js, parse-reference.js
cases/     one directory per case (only case.json is committed)
```

**Generation** calls `generateDeckV2` from `server/utils/ai/` directly. That
function is a pure `(sourceText, options)` function — no database, no auth, no
storage — so the suite exercises the exact production code path without running
a server. Deck generation deliberately does *not* go through the Anthropic SDK;
it goes through the app's own LLM layer, because testing anything else would
test something other than what ships.

**Evaluation** has three layers:

1. *Deterministic metrics* (`eval/metrics.js`) — slide count, words and bullets
   per slide, wall-of-text and empty-slide counts, structure. Free.
2. *Number fidelity* — every figure in the deck is traced back to the source.
   Cheap hallucination detection with no model call. Years and small integers
   are ignored: they are usually formatting artefacts, not copied claims.
3. *LLM judge* (`eval/judge.js`) — `claude-opus-4-8` scores five dimensions 1–5
   (coverage, structure, slide economy, faithfulness, presentability), plus
   closeness to the human deck for category A. Responses use
   `output_config.format` with a JSON schema, so verdicts are schema-valid by
   construction rather than parsed out of prose.

The judge's **rationales matter more than its scores** — they name the specific
slide that failed and what should have happened instead, which is what the
prompt-tuning loop actually consumes.

## The cases

Category A cases pair a source with a human-made deck about the same content
(ground truth). Category B cases are realistic sources with no reference.

| Case | Cat | Lang | Source | Reference |
| --- | --- | --- | --- | --- |
| `asml-q4-2024` | A | en | 4-page press release | 25-slide investor deck |
| `philips-q4-2024` | A | en | 24-page results report | 27-slide deck |
| `pbl-kev-2024` | A | nl | 183-page climate report | 20-slide PBL deck |
| `iea-weo-2024` | A | en | 10-page executive summary | 12-slide launch deck |
| `naacl-good-conversation` | A | en | 22-page paper | 25-slide author deck |
| `wikipedia-zero-knowledge-proof` | B | en | pinned wiki revision | — |
| `cloudflare-nov-2025-outage` | B | en | incident post-mortem | — |
| `cbs-persbericht-criminaliteit` | B | nl | short press release | — |
| `cbs-veiligheidsmonitor-2025` | B | nl | 127-page report | — |
| `nl-kamerbrief-duurzame-digitalisering` | B | nl | prose ministerial letter | — |
| `deckyard-readme` | B | en | this repo's README | — |

The spread is deliberate. Compression ratios run from expansion (ASML: 4 pages
into 25 slides) to roughly 9:1 (PBL: 183 pages into 20). Those are not
equal-difficulty tasks, so read per-case scores before the average. The two CBS
cases are a matched pair — the same findings at 700 words and at 127 pages — so
a deck built from the long source can be checked against the headline message
CBS itself chose for the short one.

**No case material is committed.** Licences vary (most sources are
all-rights-reserved but free to download) and some files are large. `case.json`
records the origin URL, licence and expected characteristics; the fetch script
retrieves the rest.

## Adding a case

Create `cases/<case-id>/case.json`:

```json
{
  "id": "my-case",
  "title": "Human-readable title",
  "category": "B",
  "language": "en",
  "domain": "...",
  "sources": [{ "url": "https://...", "file": "source.pdf", "type": "pdf" }],
  "licence": "...",
  "expectedCharacteristics": ["What a good deck must do"]
}
```

`type` is `pdf`, `html`, `wikitext`, `markdown` or `text`. Use `local` instead
of `url` to read from the working tree. For category A, add a `reference` array
in the same shape and run `npm run ai-suite:parse-refs`.

Then `npm run ai-suite:fetch -- --cases my-case`.

## Cost control

Runs are billed against the Anthropic API, so the suite is built to avoid
paying twice for the same answer:

- Judge verdicts and topic extractions are cached on a hash of everything that
  affects them (model, prompt, input). Re-running without changing prompts or
  sources costs nothing.
- The source document carries a prompt-cache breakpoint, so repeated judge
  calls for a case read it at roughly a tenth of the input price.
- `--dry-run` skips all judge calls.
- Run iteration rounds on a 4-case subset; save full runs for milestones.

Every run reports its own cost, and `history.json` records cost per run.

## Reproducibility

`claude-opus-4-8` accepts no `temperature`, so a run is pinned by model ID,
reasoning effort, and a **prompt version hash** — a SHA-256 over the
prompt-bearing source files listed in `lib/config.js`. Every report states that
hash, and a report that diffs against a previous run lists exactly which prompt
files changed in between. When nothing changed, the report says so, and any
score movement is variance rather than progress.
