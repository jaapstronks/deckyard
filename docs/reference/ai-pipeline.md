# The AI generation pipeline

## Purpose & scope

Deckyard turns raw input — pasted text, a Notion page, a brief — into a deck by
running a **two-phase pipeline**: phase 1 plans an _outline_ without knowing that
slide types exist, phase 2 _refines_ each outline slide into a concrete slide
type with structured content, and a validation layer repairs what the model got
wrong before anything is persisted. The same machinery, with different prompts,
powers append, section refine, single-slide conversion, deck iteration, deck
compression, presentation analysis and version comparison.

This document covers that pipeline: the transport layer to the LLM vendors, the
prompt seam, the slide-type catalogue the model is shown, the validate-and-fix
stage, the routes, and where the output lands. The _review UI_ over generated
decks is [`ai-slide-review.md`](ai-slide-review.md); the standalone copy-paste
prompt artifact is [`ai-wizard-prompts.md`](ai-wizard-prompts.md) (not wired into
the app). Adding a slide type — including the `ai.js` that feeds the catalogue —
is [`../developer/slide-types.md`](../developer/slide-types.md).

## Module map

Transport (`server/utils/llm/`, 13 modules):

- `server/utils/llm/index.js` — `requestChatCompletionContent({vendor, apiKey,
model, temperature, responseFormat, maxTokens, messages})`, the single call
  every AI feature goes through.
- `server/utils/llm/config.js` — `detectDefaultVendor()`, `getLlmConfig({vendor,
role})`, `getLlmStatus()`. Resolves vendor + model + key, including the
  sandbox's Mistral-only stance and the `role: 'plan'` stronger-model rule.
- `server/utils/llm/env.js` — `requireEnv` / `optionalEnv`.
- `server/utils/llm/error.js` — `LlmError`, the normalised vendor failure.
- `server/utils/llm/provider-base.js` — shared request/response plumbing.
- `server/utils/llm/providers/openai.js`, `claude.js`, `mistral.js`,
  `deepseek.js`, `openai-compat.js` — one adapter per vendor.
- `server/utils/llm/usage.js` — a token-usage observer; providers publish
  per-call token counts, subscribers (the AI test suite's cost reporting) listen.
  No subscribers means no cost.
- `server/utils/llm/vision.js` — image-input calls.
- `server/utils/llm/alt-text.js` — `generateImageAltTexts()`, used by the image
  library (see [`media-library.md`](media-library.md)).

Pipeline (`server/utils/ai/`, 42 modules). The top level:

- `server/utils/ai/index.js` — the barrel.
- `server/utils/ai/generate-deck-v2.js` — the orchestrator: `generateDeckV2`,
  `groupSlidesForPhase2`, `refineSlideGroup`, `assembleDeck`, plus session
  id/logger helpers.
- `server/utils/ai/generate-outline.js` (366 lines) — **phase 1**:
  `generateOutline`, `separateSlidesForProcessing`, `calculateTargetSlides`.
- `server/utils/ai/revise-outline.js` (215 lines) — **phase 1b**: a second pass
  over the outline before any slide is built (an outline is cheap to re-plan).
- `server/utils/ai/refine-slides.js` (522 lines) — **phase 2**:
  `refineAllSlideGroups`, type selection and content formatting per group.
- `server/utils/ai/refine-section.js` (110 lines) — revise a contiguous range of
  slides from user feedback (the review grid's "Adjust section").
- `server/utils/ai/iterate-deck.js` (382 lines) — natural-language deck edits
  ("make this punchier", "split slide 3").
- `server/utils/ai/compress-deck.js` (266 lines) — `analyzeForCompression`,
  `applyCompression`: find mergeable/low-value slides.
- `server/utils/ai/analyze-presentation.js` (329 lines) — improvement
  suggestions delivered through the comments system, optionally with a proposed
  slide.
- `server/utils/ai/compare-versions.js` (311 lines) — human-readable diff
  summaries between two deck versions.
- `server/utils/ai/validate-slides.js` + `server/utils/ai/validate-slides/`
  (8 modules) — the repair stage: `checks.js`, `constants.js` (item counts, max
  lengths), `fields.js` (valid/unknown field keys), `fix.js` (404 lines, the
  non-throwing repair pipeline), `fixers.js` (per-type repairs),
  `strict.js` (throwing validation for raw output), `truncate.js`, `logging.js`.
- `server/utils/ai/validate-slide-structure.js` (275 lines) — structural check of
  one slide's content against its type.
- `server/utils/ai/slide-type-catalog.js` — a 21-line compatibility re-export of
  `slide-catalog/`.
- `server/utils/ai/slide-catalog/` (9 modules) — what the model is allowed to
  author: `definitions.js` (the catalogue + editorial "when to pick this"),
  `type-ai.js` (**generated** — `node scripts/generate-slide-ai-aggregator.js`,
  sourced from each `shared/slide-types/types/<name>/ai.js`), `examples.js`
  (worked field shapes), `global-options.js` (fields on every type),
  `builders.js` (catalogue → prompt text), `agent-catalog.js` (the
  agent/MCP-facing contract), `custom-loader.js` and `custom-catalog-loader.js`
  (a fork's own types, and overrides of core copy), `index.js`.
- `server/utils/ai/prompts/` — the prompt seam: `index.js` resolves
  base-then-overlay, `base/` holds the OSS-default copy per stage
  (`outline.js`, `revise-outline.js`, `refine-slides.js`, `refine-section.js`,
  `iterate-deck.js`), `custom-loader.js` lets a fork override the copy without
  patching the mechanism.
- `server/utils/ai/schemas/` — `index.js`, `refined-slide.js`: the JSON shapes
  the model is asked to return.
- `server/utils/ai/logging.js` (226 lines) — full LLM conversation logs for
  debugging/finetuning, written under `server/logs/ai/`; off in production.
- `server/utils/ai/validation-logging.js` (335 lines) — small, production-safe
  validation-event logs (unknown fields, schema issues) plus the admin readers.

Legacy single-prompt path (`server/utils/openai/`, 8 modules):
`server/utils/ai.js` is a 9-line re-export of `openai/deck.js` (`wizard`),
`openai/append.js`, `openai/translate.js` and `openai/convert-slide.js`;
`openai/json.js`, `lang.js`, `prompt.js` and `slide-types-prompt.js` support
them. This is the **v1** generation route — one prompt, no outline phase — still
live behind `POST /api/ai/wizard`.

Routes (`server/routes/api/ai/`, 9 modules + a 38-line dispatcher):

- `server/routes/api/ai.js` — a declarative exact-path table; every route is a
  fixed method + pathname.
- `server/routes/api/ai/shared.js` (141 lines) — the `AiContext` typedef and the
  shared helpers: `loadSlideTypeContext` (org disabled + custom types),
  `loadAiThemeContext` (backgrounds, brand colours, presets),
  `reattachAiMeta`, `createPresentationWithI18n`.
- `wizard.js` (50) — `POST /api/ai/wizard`, the v1 one-shot path.
- `wizard-v2-stream.js` (257) — `POST /api/ai/wizard-v2/stream`, the two-phase
  path. The one wizard-v2 route: the non-streaming `wizard-v2` and
  `wizard-v2/outline` siblings were retired in B97.
- `append-slides.js` (90), `refine-section.js` (75), `convert-slide.js` (34),
  `compress-deck.js` (47), `iterate.js` (62) — the per-feature routes.
- `vendors.js` (11) — `GET /api/ai/vendors`, the configured-vendor list.

Outside `/api/ai/*`: `server/routes/api/presentations/analyze.js` (AI analysis
into comments), `server/routes/api/presentations/versions.js` (AI version
compare), `server/routes/api/convert.js` (deck conversion), and
`server/routes/api/admin-ai-logs.js` (102 lines, the admin validation-log
reader).

## Data model

The pipeline is **stateless with respect to Postgres**: outlines, prompts and
intermediate slides are never persisted. What lands in the database is the
finished deck, written through the normal presentation store — so AI output is
indistinguishable from hand-authored content once saved, except for the
`_aiReasoning`, `_aiAlternatives` and `_aiWarnings` fields `assembleDeck()`
attaches per slide (the review UI reads them).

The one AI-specific schema change is `server/db/migrations/017_ai_suggestions.js`,
which extends `presentation_comments` with `comment_type` (`human` vs
`ai-suggestion`), `suggestion_category` and `proposed_slide` (jsonb) — the
analysis feature delivers its output as comments, and an actionable suggestion
carries the slide JSON it proposes.

Everything else is files on disk: conversation logs under `server/logs/ai/`
(development only) and validation-event logs alongside them.

## Flows

- **Two-phase generation** (`POST /api/ai/wizard-v2/stream`) — the live path.
  The handler validates params, loads the org's slide-type context (disabled +
  custom types) and theme context, then: **phase 1** `generateOutline` produces
  a title, chapters and rough slides with no slide-type vocabulary; **phase 1b**
  `reviseOutline` re-plans it; `separateSlidesForProcessing` +
  `groupSlidesForPhase2` split the outline into groups; **phase 2**
  `refineAllSlideGroups` runs one LLM call per group, each shown the catalogue,
  the examples and the theme context, returning a type plus structured content
  per slide; `validateAndFixRefinedSlides` repairs the result;
  `assembleDeck` prepends a title slide and emits a `deckyard.deck` document;
  `createPresentationWithI18n` persists it. Progress is streamed as SSE status
  events, then the finished presentation.
- **One-shot generation** (`POST /api/ai/wizard`) — the v1 path, still used by
  the "new presentation" modal: a single prompt via
  `generateDeckJsonFromRawContent`, no outline phase, no group refinement. The
  user-chosen theme always wins over whatever the model returned.
- **Validate and fix** — the stage that makes the output usable. `fix.js`
  truncates over-long text to word boundaries, drops unknown fields, applies
  per-type repairs and smart defaults from `fixers.js`, and enforces the item
  counts in `constants.js` — non-throwing, because a repairable slide is better
  than a failed generation. `strict.js` is the throwing counterpart used on raw
  output. Every repair is recorded as a validation event.
- **Append / refine / iterate / compress** — the editing verbs. Append generates
  slides for an existing deck; section refine revises a contiguous range with a
  couple of neighbouring slides as context; iterate applies a natural-language
  command to a deck or a slide; compress proposes merges and removals, applied
  in a second step.
- **Analyze / compare** — analysis writes suggestions into the comments table
  (`comment_type = 'ai-suggestion'`); version compare renders a readable diff of
  two snapshots.
- **Vendor resolution** — every call ends at `getLlmConfig()`. Explicit vendor
  wins; otherwise `LLM_VENDOR`; otherwise the first configured key in order
  (OpenAI, Claude, Mistral, DeepSeek, OpenAI-compatible). Outline/plan calls pass
  `role: 'plan'`, which for Claude selects a stronger model than the fill
  default. An unconfigured instance gets a `400` with the list of keys to set.

## Config & flags

| Name                                                                   | Where                            | Purpose / default                                                                                                                                              |
| ---------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_VENDOR`                                                           | `utils/llm/config.js`            | Explicit default vendor. Must be a known vendor (`shared/llm-vendors.js`).                                                                                     |
| `OPENAI_API` + `OPENAI_MODEL`                                          | idem                             | Model default `gpt-5.2`.                                                                                                                                       |
| `CLAUDE_API` + `CLAUDE_MODEL` / `CLAUDE_MODEL_PLAN`                    | idem                             | Fill default `claude-sonnet-5`; plan default `claude-opus-4-8`. A pinned `CLAUDE_MODEL` applies everywhere unless `CLAUDE_MODEL_PLAN` overrides the plan step. |
| `MISTRAL_API` + `MISTRAL_MODEL`                                        | idem                             | Default `mistral-large-latest` (`mistral-small-latest` in sandbox).                                                                                            |
| `DEEPSEEK_API` + `DEEPSEEK_MODEL`                                      | idem                             | Default `deepseek-chat`.                                                                                                                                       |
| `OPENAI_COMPAT_ENDPOINT` + `OPENAI_COMPAT_MODEL` + `OPENAI_COMPAT_API` | idem                             | Any OpenAI-compatible endpoint; the key is optional (local servers).                                                                                           |
| `AI_VALIDATION_LOGGING`                                                | `utils/ai/validation-logging.js` | On unless set to `false`.                                                                                                                                      |
| `NODE_ENV`                                                             | `utils/ai/logging.js`            | Full conversation logging is disabled in production.                                                                                                           |

Feature flags (`server/config/flags-snapshot.js`): `enableAi` — off with
`AI_ENABLED=false`, **demo mode** or **sandbox mode** — when false makes the
router skip `handleAi` and `handleConvert` entirely, so `/api/ai/*` 404s rather
than erroring per call. `aiAltText` additionally requires OpenAI as the resolved default
vendor.

**Sandbox stance** (`utils/llm/config.js`): the sandbox allows Mistral and
nothing else — an explicit request for another vendor is a `400`, not a silent
downgrade. In practice sandbox mode also forces `enableAi` off, so this is a
belt-and-braces rule at the config layer rather than the live path.

Fork seams: `utils/ai/prompts/custom-loader.js` overrides prompt _copy_;
`slide-catalog/custom-loader.js` adds a fork's own slide types to the catalogue;
`slide-catalog/custom-catalog-loader.js` overrides the AI copy of a _core_ type.
The mechanism (builders, schemas, transport) is not overridable — that is the
point of the seam.

## Authz & tenancy

- Every `/api/ai/*` route sits behind the session login gate in
  `server/routes/api/index.js`, and behind the `enableAi` flag check.
- **Deck-scoped verbs** (append, refine-section, iterate, compress, convert,
  analyze, version-compare) resolve the deck through the presentation authz
  middleware first, so AI cannot reach a deck the caller could not open. The
  generation verbs create a _new_ deck in the caller's scope.
- **Org context flows into the prompt**: `loadSlideTypeContext(authedUser)` reads
  the caller's organization's disabled and custom slide types, so a model never
  offers a type that organization turned off. Theme context comes from the deck's
  resolved theme.
- Persistence goes through the ordinary scoped presentation store; the pipeline
  itself holds no organization id. General rules:
  [`tenant-isolation.md`](tenant-isolation.md).
- **Admin only**: `/api/admin/ai-logs*` (validation logs, downloads, cleanup).
- **No per-user or per-org spend limit exists.** Any authenticated member can
  spend the instance's API budget; the only cost control is turning AI off. This
  is why sandbox mode disables AI outright.

## Implementation status

Shipped and live: the two-phase stream path, the v1 one-shot wizard, append,
section refine, convert, iterate, compress, analyze, version compare, the
validate-and-fix stage, the catalogue with its fork seams, and the admin
validation-log reader.

Honest gaps:

- **Two generation paths coexist.** `POST /api/ai/wizard` (v1, `utils/openai/`,
  single prompt) and the v2 pipeline (`utils/ai/`) are both live, with different
  prompts, different validation depth and different output quality. The
  "new presentation" modal still calls v1 while the stream path calls v2. One
  canonical path is the target; two is the current state.
- **`slide-type-catalog.js` and `utils/ai.js` are compatibility shims.** Both
  exist only to re-export; new code imports `slide-catalog/` and the specific
  `openai/*` module directly.
- **Token usage is observable but not recorded.** `usage.js` publishes per-call
  counts, and with no subscriber in the server they are discarded — there is no
  spend log, no per-org accounting and no budget enforcement.
- **`type-ai.js` is generated, not authored.** It must be regenerated with
  `node scripts/generate-slide-ai-aggregator.js` after a slide type's `ai.js`
  changes; nothing in the test suite fails loudly if it drifts.
- **Conversation logs are development-only.** Debugging a bad generation on a
  production instance means reading validation events, not the prompt that
  produced it.
