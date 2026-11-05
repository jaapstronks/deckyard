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

The source text goes into the user message fenced as data (§ Findings 6), and
so does phase 1's own output when phase 2 feeds it back. What bounds the answer:
`validateAndFixRefinedSlides` repairs structure and refuses overlong text,
`resolveSourceImages` empties every remote URL the model wrote into a declared
image field, `normalizeSlides` refuses unknown slide types, and the deck is new,
so the model cannot touch anything the starter already had. Presenter `notes`
and the per-slide review metadata (`_aiReasoning`, `_aiAlternatives`,
`_aiWarnings`) are free text outside the schema.

### Editing verbs: the model writes into an existing deck

| Entry                                                                 | Starter                      | Author of the text                                                                                                               | Sink                                                                          |
| --------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/ai/append-slides` (`server/utils/openai/append.js`)        | Auth                         | The starter's request, plus a **deck summary the client sends** (collaborators' titles and bodies, quoted unescaped)             | Returned to the editor, which saves it through the ordinary PUT               |
| `POST /api/v1/ai/append-slides`                                       | Key `ai`                     | Same                                                                                                                             | Returned                                                                      |
| MCP `append_slides`                                                   | Key `ai`                     | The agent's text plus the **stored deck**                                                                                        | **Persisted** through `replaceSlides` (field validation runs)                 |
| `POST /api/ai/refine-section` (`server/utils/ai/refine-section.js`)   | Auth                         | Selected and neighbouring slides from the client (collaborators), the starter's feedback bare                                    | Returned; validated and repaired                                              |
| `POST /api/ai/iterate` (`server/utils/ai/iterate-deck.js`)            | Auth                         | The starter's command, **in the user message as the starter's request**; one slide or the **whole deck** as JSON (collaborators) | Returned as a plan plus the resulting deck; the editor applies it             |
| MCP `iterate_presentation`                                            | Key `ai`                     | The agent's command plus the stored deck                                                                                         | **Persisted**: the whole slide list is replaced                               |
| `POST /api/ai/convert-slide` (`server/utils/openai/convert-slide.js`) | Auth                         | One slide's fields, fenced, in a per-type-pair prompt                                                                            | Returned as `content`                                                         |
| MCP `convert_slide`                                                   | Key `ai`                     | The stored slide                                                                                                                 | Persisted through `updateSlide` (field validation runs)                       |
| `POST /api/ai/compress-deck` (`server/utils/ai/compress-deck.js`)     | Auth                         | Deck title, headings, the first 100 characters of each body, item titles (collaborators), bare                                   | A list of merges and removals; applying it deletes the slides the model chose |
| MCP `compress_presentation`                                           | Key `ai`; write when applied | The stored deck                                                                                                                  | With `apply: true`, **persisted** removals                                    |

What bounds these: every replacement slide goes through `validateAndFixSlide`
(structure, lengths), the persisted MCP paths run `validateSlide` and the
storage layer refuses unknown types. What does not is the scope of a plan:
finding 4. On the editor paths the human sees the result before it is saved; on
the MCP paths it is saved first and the agent is told afterwards.

### Analysis: the model talks about a deck

| Entry                                                                             | Starter         | Author of the text                                                              | Sink                                                                                                                         |
| --------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/presentations/:id/analyze` (`server/utils/ai/analyze-presentation.js`) | Auth with write | The **whole stored deck** as JSON (every collaborator); the client's categories | **Comments** persisted under the AI identity and broadcast to every collaborator, each optionally carrying a `proposedSlide` |
| MCP `analyze_presentation`                                                        | Key `ai`, read  | The stored deck, reader view                                                    | Returned to the agent as free text                                                                                           |
| `POST …/versions/:vid/compare-ai` (`server/utils/ai/compare-versions.js`)         | Auth with write | Current deck and an older snapshot, titles quoted unescaped, bodies capped      | Returned; insights filtered to known slide ids and categories, the summary free text                                         |
| `POST …/description/generate` (`server/routes/api/presentations/description.js`)  | Auth with write | The stored deck's prose                                                         | Returned; the human edits it in a textarea before saving                                                                     |

The comment sink matters: a slide written by one collaborator can make the
model post a suggestion that every other collaborator sees as "the AI's", and
"Apply suggestion" (`server/routes/api/presentations/comments-actions.js`)
writes the proposed content into the deck, after the field validation.

### Translation

| Entry                                                                                                                                          | Starter                   | Author of the text                                                                                                                                                          | Sink                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST /api/presentations/:id/translate`, `POST /api/v1/presentations/:id/translate`, the translate queue worker (dormant: nothing enqueues it) | Auth with write; key `ai` | The **whole stored deck** as JSON, one call per batch (`server/utils/openai/translate.js`), plus the **organization admin's translation instructions** in the system prompt | Only translated values for declared per-language keys are accepted; persisted through `updatePresentation` |
| `POST …/translate/missing`                                                                                                                     | Auth with write           | The missing strings as a path map                                                                                                                                           | Written by path; persisted                                                                                 |
| `POST …/translate/fields`                                                                                                                      | Auth with write           | A **field map the client sends**                                                                                                                                            | Returned only                                                                                              |

Deck content and the admin's reference
(`server/utils/openai/translation-instructions.js`) are both fenced as data,
and that module's comment says what that is worth: "Fencing is not a security
boundary against malicious text." What bounds the answer is structural:
the writer accepts only strings, only for keys the type declares as text (or
stores as prose), never a URL, enum, number or image field.
`translateShortText` in the same module has no callers.

### Media

| Entry                                                                                                                 | Starter                             | Author of the text                                                                                                                                                                                  | Sink                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `POST /api/image-library/generate-alts`, `POST /api/image-library/:id/generate-alts` (`server/utils/llm/alt-text.js`) | Auth; OpenAI as the resolved vendor | The **image itself** (vision: text inside a picture is an instruction channel), plus description, tags and photographer from the request or the library item, which another member may have written | Alt text per language, truncated; preview only, the human saves it |

`resolveImageUrlForVisionInput` (`server/utils/llm/vision.js`) passes an
`http(s)` URL to the vendor to fetch and inlines a local `/uploads/…`,
`/assets/…` or `/custom/assets/…` path as base64. How it resolves that path is
finding 9.

### Background

| Entry                                                                               | Starter  | Author of the text                                                                              | Sink                                             |
| ----------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Weekly user digest, `generateDigestWithAI` (`server/services/digest-generation.js`) | Cron job | **Deck titles** (which a collaborator may have written) with view counts; no names or addresses | Email: subject, highlights, up to three insights |
| Weekly team digest, `generateTeamDigestWithAI`                                      | Cron job | **Other members' deck titles** with view and presenter counts; no names or addresses            | Email to the organization admin                  |

What bounds it: the HTML template escapes every field, the only `href` is the
preferences link and the dashboard link is built from `APP_URL`, so the model
cannot place a link. `sendEmail` refuses a subject with a control character, so
the subject cannot inject a header. Audience questions, comments and poll
answers are in no prompt anywhere. Every text field from the model must be a string
within a maximum, and the subject a single line, or the template says it
instead. The greeting is the template's in both digests, so the recipient's name
stays out of the prompt. The team prompt lists its fields, so colleagues' names
and email addresses stay out of it; the mail lists the presenters' names from
the analytics. A deck title can still hold a name.

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
  writes, the MCP slide tools, every create and every import; on the collab
  store, where a refused value keeps the doc binary but stays out of the deck
  JSON and prose may be empty while someone retypes it; on "Apply suggestion";
  and on two answers that write nothing, editor `convert-slide` and v1
  `append-slides`.
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
  video loads from every viewer's browser with no click, which `resolveSourceImages`
  covers on part of the paths: finding 3. **Published editions are closed**:
  `server/export/edition-input.js` refuses any frame and any non-`data:` URL
  at publish time. **Exports fetch server-side** through the SSRF guard, which
  blocks private and metadata addresses and accepts public hosts, so a public
  attacker URL is requested from the server's own address.
- **Links.** Markdown links allow `https?:` only and no images; `url` fields
  are checked at write time, and renderers re-check the scheme at render time.
- **Destructive edits.** Iteration and compression plans can remove slides: finding 4.
- **Comments.** Analysis suggestions are persisted under the AI identity and
  broadcast; comment links go through the mention allowlist.
- **Email.** Digest fields are escaped in HTML and header-checked; the
  text/plain part inserts model text as is, which mail clients auto-link.
- **The user's agent (MCP).** Every tool result is fenced as data on the
  `tools/call` path, and `initialize` carries the rule. `usage` rules bind the
  slide content an agent writes and nothing else; `preview_*` returns HTML for
  the user to look at. A slide one collaborator wrote still reaches the other
  user's agent, which acts with that user's key, and an agent can be talked out
  of a marking (§ MCP as both sides).
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

**What a reader can get out.** The reader projection
([`viewer-read-data.md`](viewer-read-data.md)) bounds what a reader sees. Where
that does not hold yet: finding 2.

**Fork tools.** `custom/mcp-tools.js` is imported once per process from the
filesystem, runs with the server's full rights, and must still declare a
permission to be callable with a key. Content plays no part in which tools
load.

## Cost and abuse

- **No internal route is metered.** Every cookie-authenticated AI route has
  no rate limit and no quota; the only inbound buckets exist in demo and
  sandbox mode, where AI is off. Who may start a call is finding 8.
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
severity order, except that the first is the one to fix first. An open finding
says what it touches; the exact form follows with its fix.

1. **A video slide's `source` was echoed as the iframe `src`.**
   `bunnyEmbedUrlFromInput` returned the paste after a substring test on the
   host, so `javascript:…//iframe.mediadelivery.net/embed/` rendered as a
   frame that Chromium runs in the page's own origin under the app CSP, and
   any `https:` URL mentioning the host was framed without a sandbox. Stored
   XSS on every app surface for anyone who can write the field: editors,
   imports, agents, the model. Editions were not affected. Fixed: the helper
   now rebuilds the URL from the library id and video UUID, and anything else
   embeds nothing (DY-809).
2. **What a reader can get out of a deck is wider than the reader projection**
   (DY-810).
3. **A URL the model writes can load in a viewer's browser without a click**
   (DY-811). The scrub for such URLs does not cover every path yet.
4. **A plan can reach further than the slides the starter named** (DY-812).
5. **Not every path that wrote slide content ran the declared-field validation,
   and the end slide did not re-check a link.** Fixed: the four paths refuse
   (§ Sinks) and the end slide renders a link only through `safeHref`. Editor
   `append-slides`, `refine-section` and `iterate` still answer unvalidated
   links for a human to review; the save refuses them and every renderer
   re-checks (DY-813).
6. **Deck content entered every prompt as instructions can.** No prompt
   delimited user text as data, and the iterate command stood in the system
   prompt. Fixed as a first layer of defence, not a boundary: every prompt
   fences data with `untrustedData()` and the starter's words with
   `starterRequest()` (`server/utils/llm/untrusted-data.js`); the transport adds
   the one rule that gives the fences their meaning and refuses a user message
   without one. `tests/llm-data-boundary.test.js` drives every path against a
   fake model that obeys what it reads outside a fence (DY-814).
7. **MCP handed content to the agent unmarked and some descriptions inverted
   the trust.** Fixed as a first layer of defence, not a boundary: every result
   is fenced on the `tools/call` path, a session starts with the rule, `usage`
   binds only the content an agent writes, and no description asks for an
   artifact. `tests/mcp/mcp-result-marking.test.js` reads it as a client does
   (DY-815).
8. **AI spend is unmetered inside the app and under-counted on keys** (DY-844).
   The permission half is fixed: `compare-ai`, `description/generate` and
   `translate/fields` ask for write, so a view or comment collaborator cannot
   start a model call. `tests/ai-spend-write-permission.test.js` pins it through
   the route table and the real authorization, with the model call counted.
9. **The vision helper read local paths without containment.** Fixed: it reads
   only what the installation serves as an asset, through the resolver the
   exports use, and refuses any other local path. `tests/llm-vision-input.test.js`
   pins this (DY-817).
10. **Digest output was uncapped and the team digest shipped colleagues'
    identities to the vendor.** Fixed: every model field is typed and bounded
    with the template as fallback, the greeting is the template's, and the team
    prompt carries titles and counts. `tests/digest-generation.test.js` pins
    these (DY-818).

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
  (a `javascript:` link is refused on save), `content-schema-links.test.js`,
  `ai-output-field-validation.test.js` (two model answers and the end slide),
  `collab-persistence.test.js` and `comments-routes-authz.test.js` (the collab
  store and "Apply suggestion").
- CSP, SSRF and origins: `export-csp.test.js`, `export-ssrf-strip.test.js`,
  `ssrf-guard.test.js`, `bulk-export-ssrf.test.js`, `edition-input.test.js`,
  `no-third-party-origins.test.js`.
- Faked model seams (they stub `fetch`): `translate-undeclared-item-strings.test.js`,
  `nested-item-translation.test.js`, `fill-missing-per-path.test.js`,
  `ai-paths-org-registry.test.js`, `append-source-images.test.js`,
  `source-images.test.js`, `digest-generation.test.js`,
  `email-template-escaping.test.js`.
- Deck content as data on every model path: `llm-data-boundary.test.js`.
- Tool results as data for the agent: `tests/mcp/mcp-result-marking.test.js`.
- Authorization: `tests/mcp/mcp-tool-permissions.test.js` (every tool
  declares a permission).

Not pinned by any test, one per finding: a `javascript:` or foreign-host
video source (added with the fix for finding 1), and the open findings 2, 3, 4,
8 and 9. Each item
carries its regression test as an acceptance criterion, after the pattern of
the faked seam in `tests/translate-undeclared-item-strings.test.js`.
