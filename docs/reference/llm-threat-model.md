# LLM threat model

What a text written by someone other than the acting user can make a language
model do inside Deckyard, and what bounds it. This is the prompt-injection
counterpart of [`security-posture.md`](security-posture.md): that page covers
what untrusted _content_ can do when it is rendered, fetched or uploaded; this
one covers what it can do when a model reads it and Deckyard acts on the
answer. Verified against HEAD on 2026-11-04. It describes what is enforced
today and names the gaps as numbered findings; the planning items that close
them are referenced in parentheses.

## Principle

**Text is data, never instruction.** What a model reads out of a deck, an
upload, a comment or an external page may not decide what the model is allowed
to do. **Authority is the starter's.** An AI action has exactly the rights of
whoever started it and never more. **Model output is untrusted input from the
least trusted party in the prompt.** If a collaborator's slide was in the
prompt, the answer is treated as if that collaborator typed it.

The question for every path is therefore the same: who started it, whose text
went in, where does the answer land, and does that landing place have reach the
text's author did not already have.

## Four parties

- **Starter**: the user, API key or job that triggers the call and whose rights
  the result is written with.
- **Author**: whoever wrote the text in the prompt. Often the starter (a wizard
  brief). Often not: a collaborator's slide, a slide from the organization's
  library, an uploaded PDF, a Notion page anyone with edit rights on it can
  change, the organization's own custom slide-type copy.
- **Model**: the vendor the instance configured. Deckyard does not try to make
  the model resist instructions in content; no prompt asks it to, with one
  exception named below. The model is assumed to follow the text it reads.
- **Sink**: where the answer goes. A slide in the starter's deck, a comment
  broadcast to collaborators, an email, the response to the starter's own agent.

A path is dangerous when author and starter differ **and** the sink has reach
the author lacks: a view-only collaborator whose slide is translated by the
owner, a public PDF whose text drives a deck the importer publishes, a slide
that an agent reads and then acts on with the user's API key.

## Where every call goes

Every AI feature ends in one function, `requestChatCompletionContent()` in
`server/utils/llm/index.js`, and every vendor adapter under
`server/utils/llm/providers/` makes the HTTP call from there (the
OpenAI-compatible adapter has its own `fetch`, to an endpoint from
`OPENAI_COMPAT_ENDPOINT`). Vendor and model resolve through `getLlmConfig()`
(`server/utils/llm/config.js`); a `vendor` named in a request body selects any
configured vendor. The only structured-output mode in use is plain JSON mode
(`{ type: 'json_object' }`), which the Claude adapter drops; no path uses a
JSON schema at the vendor.

The instance switch is `enableAi` (`server/config/flags-snapshot.js`): off
under `AI_ENABLED=false`, demo mode and **sandbox mode**, on every surface at
once ([`ai-pipeline.md`](ai-pipeline.md) § Config & flags). Everything below
assumes it is on.

## The paths

Thirty-one entry points reach the model. "Auth" means any signed-in user of
the instance; no path requires a designer or admin role. "Internal" routes are
cookie-authenticated and carry no rate limit or quota; "v1" and "MCP over
HTTP" are API-key routes with the per-key daily AI counter (§ Cost and abuse).

### Generation: a new deck from text

One pipeline, `generateDeck()` in `server/utils/ai/generate-deck.js`, three
plus _n_ model calls (analysis, structure, revision, then one refinement call
per slide group). The prompts are `server/utils/ai/prompts/base/outline.js`,
`revise-outline.js` and `refine-slides.js`; a fork may replace their copy
through `custom/ai/prompts.js`.

| Entry                                                  | Starter            | Author of the text                                                                                                                       | Sink                                                           |
| ------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `POST /api/ai/wizard`, `POST /api/ai/wizard-v2/stream` | Auth               | The starter's own text; a Notion page the editor fetched first; image URLs in the text, rehosted behind the SSRF guard                   | New deck in the starter's scope, through `createDeckFromParts` |
| `POST /api/convert`, `POST /api/convert/stream`        | Auth               | An **uploaded PPTX, PDF, DOCX, RTF or ODT**: slide text, speaker notes, document metadata (the file's author becomes the presenter name) | New deck                                                       |
| `POST /api/notion/import`, `/import/stream`            | Auth               | A **Notion page** the instance-wide integration can read, so anyone with edit rights on that page                                        | New deck                                                       |
| `POST /api/v1/ai/wizard`                               | API key `ai`       | The caller's text                                                                                                                        | New deck                                                       |
| MCP `create_presentation`                              | Key `ai`, or stdio | Whatever the agent passes, which may be anything the agent read earlier                                                                  | New deck, persisted                                            |

The source text goes into the user message bare, after a `SOURCE:` marker;
phase 2 feeds phase 1's own output back bare. What bounds the answer:
`validateAndFixRefinedSlides` repairs structure and refuses overlong text,
`resolveSourceImages` empties every remote URL the model wrote into a declared
image field, `normalizeSlides` refuses unknown slide types, and the deck is new,
so the model cannot touch anything the starter already had. Presenter `notes`
and the per-slide review metadata (`_aiReasoning`, `_aiAlternatives`,
`_aiWarnings`) are free text outside the schema.

### Editing verbs: the model writes into an existing deck

| Entry                                                                 | Starter                      | Author of the text                                                                                                      | Sink                                                                            |
| --------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /api/ai/append-slides` (`server/utils/openai/append.js`)        | Auth                         | The starter's request, plus a **deck summary the client sends** (collaborators' titles and bodies, quoted unescaped)    | Returned to the editor, which saves it through the ordinary PUT                 |
| `POST /api/v1/ai/append-slides`                                       | Key `ai`                     | Same                                                                                                                    | Returned; **skips `validateAndFixRefinedSlides`**, keeps the remote-image scrub |
| MCP `append_slides`                                                   | Key `ai`                     | The agent's text plus the **stored deck**                                                                               | **Persisted** through `replaceSlides` (field validation runs)                   |
| `POST /api/ai/refine-section` (`server/utils/ai/refine-section.js`)   | Auth                         | Selected and neighbouring slides from the client (collaborators), the starter's feedback bare                           | Returned; validated and repaired; **no remote-image scrub**                     |
| `POST /api/ai/iterate` (`server/utils/ai/iterate-deck.js`)            | Auth                         | The starter's command, **interpolated into the system prompt**; one slide or the **whole deck** as JSON (collaborators) | Returned as a plan plus the resulting deck; the editor applies it               |
| MCP `iterate_presentation`                                            | Key `ai`                     | The agent's command plus the stored deck                                                                                | **Persisted**: the whole slide list is replaced                                 |
| `POST /api/ai/convert-slide` (`server/utils/openai/convert-slide.js`) | Auth                         | One slide's fields, interpolated bare into a per-type-pair prompt                                                       | Returned as `content` with **no validation**                                    |
| MCP `convert_slide`                                                   | Key `ai`                     | The stored slide                                                                                                        | Persisted through `updateSlide` (field validation runs)                         |
| `POST /api/ai/compress-deck` (`server/utils/ai/compress-deck.js`)     | Auth                         | Deck title, headings, the first 100 characters of each body, item titles (collaborators), bare                          | A list of merges and removals; applying it deletes the slides the model chose   |
| MCP `compress_presentation`                                           | Key `ai`; write when applied | The stored deck, **unfiltered** for the preview (hidden slides included)                                                | With `apply: true`, **persisted** removals                                      |

What bounds these: every replacement slide goes through `validateAndFixSlide`
(structure, lengths), the persisted MCP paths run `validateSlide` and the
storage layer refuses unknown types. What does not: the plan of a **deck-wide
iteration can `replace`, `remove` or `split` any slide**, not only the one the
starter meant, and `applyIterationPlan` applies a `remove` with no further
check; compression's "never remove the title or payoff slide" lives only in
the prompt. On the editor paths the human sees the result before it is saved;
on the MCP paths it is saved first and the agent is told afterwards.

### Analysis: the model talks about a deck

| Entry                                                                             | Starter         | Author of the text                                                              | Sink                                                                                                                                                            |
| --------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/presentations/:id/analyze` (`server/utils/ai/analyze-presentation.js`) | Auth with write | The **whole stored deck** as JSON (every collaborator); the client's categories | **Comments** persisted under the AI identity and broadcast to every collaborator, each optionally carrying a `proposedSlide` whose content is **not validated** |
| MCP `analyze_presentation`                                                        | Key `ai`, read  | The stored deck, reader view                                                    | Returned to the agent as free text                                                                                                                              |
| `POST …/versions/:vid/compare-ai` (`server/utils/ai/compare-versions.js`)         | Auth with read  | Current deck and an older snapshot, titles quoted unescaped, bodies capped      | Returned; insights filtered to known slide ids and categories, the summary free text                                                                            |
| `POST …/description/generate` (`server/routes/api/presentations/description.js`)  | Auth with read  | The stored deck's prose                                                         | Returned; the human edits it in a textarea before saving                                                                                                        |

The comment sink matters: a slide written by one collaborator can make the
model post a suggestion that every other collaborator sees as "the AI's", and
"Apply suggestion" (`server/routes/api/presentations/comments-actions.js`)
writes the proposed content into the deck through `newSlide()` and
`updatePresentation()` **without the declared-field validation** every other
write path runs. The proposal's type is checked against the organization's
offer; its content is not.

### Translation

| Entry                                                                                                                                          | Starter                   | Author of the text                                                                                                                                                          | Sink                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST /api/presentations/:id/translate`, `POST /api/v1/presentations/:id/translate`, the translate queue worker (dormant: nothing enqueues it) | Auth with write; key `ai` | The **whole stored deck** as JSON, one call per batch (`server/utils/openai/translate.js`), plus the **organization admin's translation instructions** in the system prompt | Only translated values for declared per-language keys are accepted; persisted through `updatePresentation` |
| `POST …/translate/missing`                                                                                                                     | Auth with write           | The missing strings as a path map                                                                                                                                           | Written by path; persisted                                                                                 |
| `POST …/translate/fields`                                                                                                                      | Auth with read            | An **arbitrary field map the client sends**                                                                                                                                 | Returned only                                                                                              |

Translation has the only instruction boundary in the codebase:
`server/utils/openai/translation-instructions.js` labels the admin's reference
"data, not instructions" and tells the model to ignore commands inside it, and
its own comment says what that is worth: "Quoting is not a security boundary
against malicious text." Deck content, the larger and less trusted input on
the same call, carries no such label. What bounds the answer is structural:
the writer accepts only strings, only for keys the type declares as text (or
stores as prose), never a URL, enum, number or image field.
`translateShortText` in the same module has no callers.

### Media

| Entry                                                                                                                 | Starter                             | Author of the text                                                                                                                                                                                  | Sink                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `POST /api/image-library/generate-alts`, `POST /api/image-library/:id/generate-alts` (`server/utils/llm/alt-text.js`) | Auth; OpenAI as the resolved vendor | The **image itself** (vision: text inside a picture is an instruction channel), plus description, tags and photographer from the request or the library item, which another member may have written | Alt text per language, truncated; preview only, the human saves it |

`resolveImageUrlForVisionInput` (`server/utils/llm/vision.js`) passes an
`http(s)` URL to the vendor to fetch and inlines a local `/uploads/…` or
`/assets/…` path as base64 by joining it onto the uploads directory or the
repository root. The join is **not contained**: a path with `..` segments and
an image extension reads any readable image file on the host and sends it to
the vendor. The preview route takes that URL from the request body.

### Background

| Entry                                                                               | Starter  | Author of the text                                                                                  | Sink                                                       |
| ----------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Weekly user digest, `generateDigestWithAI` (`server/services/digest-generation.js`) | Cron job | The recipient's name and **deck titles** (which a collaborator may have written) with view counts   | Email: subject, greeting, highlights, up to three insights |
| Weekly team digest, `generateTeamDigestWithAI`                                      | Cron job | The organization's analytics object as JSON: **other members' deck titles, names and owner emails** | Email to the organization admin                            |

What bounds it: the HTML template escapes every field, the only `href` is the
preferences link and the dashboard link is built from `APP_URL`, so the model
cannot place a link. `sendEmail` refuses a subject with a control character, so
the subject cannot inject a header. Audience questions, comments and poll
answers are in no prompt anywhere. What does not: `validated()` checks neither
type nor length of `subject`, `highlights` or the `insights` entries, and the
team digest sends colleagues' names and email addresses to the vendor to
produce a mail about view counts.

## Sinks: what an answer can reach

The sink decides the blast radius. These are the places model output lands,
with the control at each.

- **Slide content.** `assertValidSlideFields` (`server/services/slide-field-validation.js`)
  refuses undeclared top-level keys and checks declared fields by type:
  `url` fields through `safeHref` (http(s), mailto, relative, no `javascript:`
  or `data:`), text by length, `image` fields **only that they are strings**
  (no scheme or host check), `enum` fields by option list. Keys inside `items`
  entries are not refused except by the strict Zod schema MCP
  `create_presentation_from_slides` uses. It runs on the editor PUT, the v1
  writes, the MCP slide tools, every create and every import. It does **not**
  run on collaboration live edits (`server/collab/persistence.js`, behind
  `COLLAB_LIVE_EDITS`, off by default), on "Apply suggestion", on the editor's
  convert-slide answer, or on translation (text paths only, no length cap).
- **Slide type.** The model picks from the organization's offer. That offer
  includes `embed-slide` (any `https:` URL in an iframe whose `sandbox` value
  is an enum the model may set to `permissive`), `video-slide` and the
  organization's database custom types (`{{raw}}` through DOMPurify). It does
  not include the raw-HTML type core removed in October 2026 (recorded in
  `shared/slide-types/removed.js`); a `markup: true` field exists only on fork
  types and is refused at publish.
- **URLs the viewer's browser fetches.** The app surfaces (editor, presenter,
  share viewer, follow-along) ship one CSP with `img-src 'self' data: blob:
https:`, `media-src`, `connect-src` and `frame-src` likewise open to any
  `https:` host ([`document-csp.js`](../../server/utils/document-csp.js) says
  itself that it is a host allowlist for code, not an XSS defence). A remote
  URL the model writes into an image field, a background image, an embed or a
  video therefore loads from every viewer's browser with no click: **a
  zero-click beacon**, with whatever the model put in the query string.
  `resolveSourceImages` empties model-written remote image URLs, but only on
  the generation pipeline and the three append paths; iterate, refine-section,
  convert-slide, compress and the analysis proposal keep them, and nothing
  touches `embedUrl` or the video `source`. **Published editions are closed**:
  `server/export/edition-input.js` refuses any frame and any non-`data:` URL
  at publish time. **Exports fetch server-side** through the SSRF guard, which
  blocks private and metadata addresses and accepts public hosts, so a public
  attacker URL is requested from the server's own address.
- **Links.** Markdown links allow `https?:` only and no images; `url` fields
  are checked at write time, and every renderer but `end-slide` re-checks the
  scheme at render time.
- **Destructive edits.** A deck-wide iteration plan and a compression plan can
  remove any slide; on the MCP tools the removal is persisted before the agent
  reads the summary.
- **Comments.** Analysis suggestions are persisted under the AI identity and
  broadcast; comment links go through the mention allowlist.
- **Email.** Digest fields are escaped in HTML and header-checked; the
  text/plain part inserts model text as is, which mail clients auto-link.
- **The user's agent (MCP).** Tool results are `JSON.stringify(result)` in one
  text block with no marker that says "this is user data". Some descriptions
  tell the agent the opposite: `get_slide_types` says to treat the
  organization's `usage` rules, written by a designer, as "binding";
  `preview_slide` says to display the slide HTML as an artifact. A slide one
  collaborator wrote therefore reaches the other user's agent as plain text
  and is acted on with that user's key (§ MCP as both sides).
- **Review metadata and notes.** `_aiReasoning`, `_aiAlternatives`,
  `_aiWarnings` and model-written `notes` are uncapped free text; they survive
  `normalizeSlides`, render in the editor's review grid, and are stripped from
  public output by `AI_REVIEW_KEYS`.
- **Logs.** The admin validation log (`server/routes/api/admin-ai-logs.js`)
  holds field names, slide titles and 100-character samples of unknown
  values, instance-wide, without prompts or identities. Full conversation
  logs exist only with `AI_SESSION_LOGS`, by default only in development, and
  no route serves them.

## MCP as both sides

An agent reads deck content through MCP and writes back with the session's
rights, so a slide is both an injection into the agent and the agent's means
of acting on it.

**Who the session is.** Over HTTP, a `dk_live_*` key validated on every
request; the actor is the key owner's email in the key's organization, with
the key's scopes (`read`, `write`, `export`, `ai`, `comments:*`,
`collaborators:*`) and tier (`server/mcp/authorization.js`). Over stdio there
is no key and no gate: with `DECKYARD_MCP_OWNER_EMAIL` the process acts as that
user with every scope; without it, as the unrestricted operator. No tool runs
as an organization admin; every deck-by-id tool goes through
`loadPresentationForActor` at the level it needs (read, write, delete, manage,
comment), and storage is scoped to the key's organization, so no tool reaches
another organization.

**What a hijacked agent can do inside Deckyard.** Nothing ties a session to
"the deck in this conversation": every tool takes any `presentationId`, so an
instruction in one slide acts on every deck the user can read. With `write`:
rewrite or remove slides, hide slides, trash a deck the user owns (`confirm:
true` is an argument the agent sets, not a human). With `ai`: rewrite a deck
through iterate, convert or compress with persistence, and choose the
`vendor` that receives the content. With `comments:write`: post comments as
the user, which email, notify and webhook other members. With
`collaborators:write` and `manage` on the deck: grant any organization member
`admin` and email them the invitation. With `collaborators:read`: list
collaborators' emails. What it cannot do: publish, make share links, translate
(v1 only), change organization settings, move ownership. **Publication and
share links are outside MCP**, which is the one reason an injected agent
cannot make a private deck public.

**What a reader can get out.** `duplicate_presentation` (and its v1 and
editor twins) loads the source at **read** access and copies every slide
field, `notes` and `visibility` included. A view-only collaborator with a
`write`-scoped key therefore gets the author's speaker notes and
`hideFromViewers` slides by copying the deck and reading the copy, which the
reader projection ([`viewer-read-data.md`](viewer-read-data.md)) exists to
prevent. The same holds in the browser. The preview of
`compress_presentation` sends the unfiltered deck to the model for a reader.

**Fork tools.** `custom/mcp-tools.js` is imported once per process from the
filesystem, runs with the server's full rights, and must still declare a
permission to be callable with a key. Content plays no part in which tools
load.

## Cost and abuse

- **No internal route is metered.** Every cookie-authenticated AI route has
  no rate limit and no quota; the only inbound buckets exist in demo and
  sandbox mode, where AI is off. Three routes spend tokens at **read**
  permission on a deck (version compare, description, `translate/fields`), so
  a view-only collaborator can spend the instance's budget on any deck they
  can open, and `translate/fields` accepts an arbitrary field map.
- **API keys are metered per request, not per call.** `aiCallsPerDay` is 10,
  100 or unlimited by tier (`server/storage/api-keys.js`), counted once per
  request, while a wizard run is three plus _n_ model calls and a translation
  one per batch. Keyless stdio MCP has no quota.
- **Token usage is observable, not recorded.** `server/utils/llm/usage.js`
  publishes per-call counts for OpenAI and Claude only; no production code
  subscribes, so there is no spend log or per-organization accounting
  ([`ai-pipeline.md`](ai-pipeline.md) § Honest gaps).
- **Injection can lengthen a call** but not loop it: `maxTokens` caps each
  answer, phase 2 retries once on a length refusal and then fails, and no path
  calls the model in a loop driven by its own output.
- **Sandbox.** `SANDBOX_MODE` forces `enableAi` off, and the sandbox's own
  Mistral-only rule in `getLlmConfig()` is belt and braces behind it. On the
  public sandbox nothing in this document is reachable today.

## Findings

Each finding is a planning item with the tier its risk point sets; the item
holds the acceptance criteria. Numbers are the items' addresses, not a
severity order, except that the first is the one to fix first.

1. **A video slide's `source` was echoed as the iframe `src`.**
   `bunnyEmbedUrlFromInput` returned the paste after a substring test on the
   host, so `javascript:…//iframe.mediadelivery.net/embed/` rendered as a
   frame that Chromium runs in the page's own origin under the app CSP, and
   any `https:` URL mentioning the host was framed without a sandbox. Stored
   XSS on every app surface for anyone who can write the field: editors,
   imports, agents, the model. Editions were not affected. A fix that rebuilds
   the URL from the two ids is open (DY-809).
2. **Copying a deck gives a reader the author's notes and hidden slides**
   (DY-810). Duplicate loads at read access and copies every field; the
   reader projection is bypassed by one tool call or one click.
3. **The model can plant a zero-click beacon** (DY-811). Remote URLs in
   image, background, embed and video fields load in every viewer's browser
   under the open `https:` CSP; the scrub that empties them runs on four of
   the eleven paths that write slide content.
4. **The model can delete and rewrite slides the starter did not name**
   (DY-812). Deck-wide iteration and compression plans apply `remove` and
   `replace` on any index; the MCP verbs persist before anyone sees the plan;
   `detectTargetSlide` lets the command text move the target.
5. **Four write paths skip the declared-field validation** (DY-813): "Apply
   suggestion", collaboration live edits, the editor's convert-slide answer
   and v1 `append-slides`; `end-slide` renders its three link fields without
   the render-time scheme check the other renderers have.
6. **Deck content enters every prompt as instructions can** (DY-814). No
   prompt delimits user text as data or tells the model to ignore commands
   in it, except the organization's translation reference; the iterate
   command is interpolated into the system prompt. One shared delimiting
   and one shared system rule, applied by the transport seam, replaces
   per-path copy.
7. **MCP hands content to the agent unmarked and some descriptions invert
   the trust** (DY-815). Results carry no "user data" marker; `usage` rules
   are described as binding; `preview_slide` asks for an artifact.
8. **AI spend is unmetered inside the app and under-counted on keys**
   (DY-816). No internal quota; three routes spend at read permission; the
   key counter counts requests, not calls; usage is not recorded.
9. **The vision helper reads outside the uploads directory** (DY-817).
   `/uploads/../…` with an image extension is joined and sent to the vendor;
   the preview route takes the path from the request.
10. **Digest output is uncapped and the team digest ships colleagues'
    identities to the vendor** (DY-818). `subject`, `highlights` and
    `insights` are not typed or bounded; the team prompt carries names and
    owner emails that the mail does not need.

### What the review did not find

Audience input (poll answers, questions, reactions, comments) is in no prompt.
Slide `notes` are in no prompt. Live data-source values are not written into
stored content and reach no prompt. No path loops on its own output. Markdown
rendering is safe by construction and pinned (`tests/markdown-escaped-by-construction.test.js`).
Published editions refuse frames and remote URLs at publish time and are
served from frozen bytes, so a published deck is the one surface where a
model-written URL cannot run or beacon.

## The sandbox gate

Is this threat model a launch condition for the public sandbox? **Not while
the sandbox offers no AI.** `SANDBOX_MODE` forces `enableAi` off, so none of
the paths above exist there and the findings do not change its posture. The
day the sandbox offers AI, findings 3, 4 and 8 become launch conditions first
(a beacon from a public deck, a model deleting slides in a stranger's deck, and
unmetered spend on a public URL), and the sandbox's Mistral-only rule stops
being belt and braces.

## Tests

What pins the controls above today, and the gaps per finding:

- Escaping and links: `tests/markdown-escaped-by-construction.test.js`,
  `security-slide-template-xss.test.js`, `field-types.test.js`,
  `field-change-validation.test.js`, `service-layer-presentation-save.test.js`
  (a `javascript:` link is refused on save), `content-schema-links.test.js`.
- CSP, SSRF and origins: `export-csp.test.js`, `export-ssrf-strip.test.js`,
  `ssrf-guard.test.js`, `bulk-export-ssrf.test.js`, `edition-input.test.js`,
  `no-third-party-origins.test.js`.
- Faked model seams (they stub `fetch`): `translate-undeclared-item-strings.test.js`,
  `nested-item-translation.test.js`, `fill-missing-per-path.test.js`,
  `ai-paths-org-registry.test.js`, `append-source-images.test.js`,
  `source-images.test.js`, `digest-generation.test.js`,
  `email-template-escaping.test.js`.
- Authorization: `tests/mcp/mcp-tool-permissions.test.js` (every tool
  declares a permission).

Not pinned by any test, one per finding: a `javascript:` or foreign-host
video source (added with the fix for finding 1), a reader's copy carrying
notes, a model-written remote URL surviving iterate or refine, a plan that
removes an unnamed slide, an applied suggestion with an invalid field, an
instruction inside deck content changing a translation or an iteration, an
MCP result for a slide that contains an instruction, a read-permission caller
spending tokens, a `..` vision path, an oversized digest subject. Each item
carries its regression test as an acceptance criterion, after the pattern of
the faked seam in `tests/translate-undeclared-item-strings.test.js`.
