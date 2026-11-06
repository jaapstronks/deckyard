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
cookie-authenticated and carry no rate limit or quota of their own, though
every model call counts against the installation's daily ceiling; "v1" and "MCP over
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
`resolveSourceImages` copies the images a slide chose and then holds every
media field to the rule in § Sinks (an image the model named is emptied, a
slide built around an embed or video it named is left out),
`normalizeSlides` refuses unknown slide types, and the deck is new,
so the model cannot touch anything the starter already had. Presenter `notes`
and the per-slide review metadata (`_aiReasoning`, `_aiAlternatives`,
`_aiWarnings`) are free text outside the schema.

### Editing verbs: the model writes into an existing deck

| Entry                                                                 | Starter                      | Author of the text                                                                                                               | Sink                                                                                         |
| --------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `POST /api/ai/append-slides` (`server/utils/openai/append.js`)        | Auth                         | The starter's request, plus a **deck summary the client sends** (collaborators' titles and bodies, quoted unescaped)             | Returned to the editor, which saves it through the ordinary PUT                              |
| `POST /api/v1/ai/append-slides`                                       | Key `ai`                     | Same                                                                                                                             | Returned                                                                                     |
| MCP `append_slides`                                                   | Key `ai`                     | The agent's text plus the **stored deck**                                                                                        | **Persisted** through `replaceSlides` (field validation runs)                                |
| `POST /api/ai/refine-section` (`server/utils/ai/refine-section.js`)   | Auth                         | Selected and neighbouring slides from the client (collaborators), the starter's feedback bare                                    | Returned; validated and repaired                                                             |
| `POST /api/ai/iterate` (`server/utils/ai/iterate-deck.js`)            | Auth                         | The starter's command, **in the user message as the starter's request**; one slide or the **whole deck** as JSON (collaborators) | Returned as a plan plus the resulting deck, bounded to the open slide; the editor applies it |
| MCP `iterate_presentation`                                            | Key `ai`                     | The agent's command plus the stored deck                                                                                         | Returned as a plan; with `apply`, **persisted** for the listed slides only                   |
| `POST /api/ai/convert-slide` (`server/utils/openai/convert-slide.js`) | Auth                         | One slide's fields, fenced, in a per-type-pair prompt                                                                            | Returned as `content`                                                                        |
| MCP `convert_slide`                                                   | Key `ai`                     | The stored slide                                                                                                                 | Persisted through `updateSlide` (field validation runs)                                      |
| `POST /api/ai/compress-deck` (`server/utils/ai/compress-deck.js`)     | Auth                         | Deck title, headings, the first 100 characters of each body, item titles (collaborators), bare                                   | Returned as a list of merges and removals; nothing is applied                                |
| MCP `compress_presentation`                                           | Key `ai`; write when applied | The stored deck                                                                                                                  | Returned; `apply` removes the slides the agent lists, without a model call                   |

What bounds these: every replacement slide goes through `validateAndFixSlide`
(structure, lengths), the persisted MCP paths run `validateSlide` and the
storage layer refuses unknown types. The scope of a plan is bounded in code,
not in the prompt (`scopePlan`, finding 4): a plan writes only the slides the
starter pointed at (the editor's open slide, the indexes in MCP `apply`) or,
for a deck-wide command, any slide; a removal is never written, only
proposed. MCP returns the plan before anything is stored. Every one of these
answers keeps, in a field the viewer's browser loads, only what the slides the
model was shown already held (§ Sinks, finding 3).

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
writes the proposed content into the deck, after the field validation. A
proposed slide is held to the media rule before it becomes a comment, so it
can reuse an image or embed the deck holds and bring none of its own.

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
  store, per field: a refused value stays in the doc binary, the field keeps its
  stored value in the deck JSON, the rest of the store is written and prose may
  be empty while someone retypes it; inside a list per item value, which is
  left out of its item and never restored by index, while a list refused as a
  list keeps the field's stored list and a value the stored list already holds
  stops nothing; on "Apply suggestion"; and on two answers
  that write nothing, editor `convert-slide` and v1 `append-slides`, where a
  refusal is a 502 `bad_gateway` that names the field, because the model failed
  and not the caller.
- **Slide type.** The model picks from the organization's offer. That offer
  includes `embed-slide` and `video-slide`, but the model cannot name a URL
  for what they frame (next point): an embed survives only where the model
  rewrote one that already had its page, a video also with a bare id in the
  installation's library. It also includes the
  organization's database custom types (`{{raw}}` through DOMPurify). It does
  not include the raw-HTML type core removed in October 2026 (recorded in
  `shared/slide-types/removed.js`); a `markup: true` field exists only on fork
  types and is refused at publish.
- **URLs the viewer's browser fetches.** The app surfaces (editor, presenter,
  share viewer, follow-along) ship one CSP with `img-src 'self' data: blob:
https:`, `media-src`, `connect-src` and `frame-src` likewise open to any
  `https:` host ([`document-csp.js`](../../server/utils/document-csp.js) says
  itself that it is a host allowlist for code, not an XSS defence, and why the
  content directives stay open: an author chooses where a deck's media lives).
  So what a field holds is the control, and for a model's answer that is
  `dropForeignMedia` (`server/utils/ai/model-media.js`): in an image field, a
  slide background, an embed and a video, declared as `type: 'image'` or
  `mediaRef`, the answer keeps only a value the slides the model was given
  already held there, or one that names no other host (a served path, a bare
  video id in the installation's library), read the way the browser resolves
  it. A value the URL parser refuses counts as another host: an attribute
  loads nothing from it, but a CSS `url()` still loads it from the host it
  names. The rule judges what the slide will use: the value as every renderer
  reads it (`mediaValue()` in `shared/slide-types/helpers.js`; anything but a
  string is emptied), on the slide as a read yields it (the read funnel's
  legacy keys folded first). No sink changes that value after the rule: the
  background layer writes it unchanged and HTML-escaped into `url('...')`, and
  renders no background for a value its CSS string cannot carry (a quote, a
  backslash, a control character) or the URL parser refuses
  (`resolveMediaUrl()`, the one question the rule and the layer share). A media field belongs in a `src`; a fork
  type that writes one into CSS `url()` needs more than `mediaValue()` and
  `escapeHtml`. Anything else is emptied with a warning, and a
  slide left without a field its type requires is not in the answer. A URL in
  the source text is data and does not count as held. One known slack: for a
  slide whose type the installation does not know, the held set is wider than
  that slide's media fields; it holds only values the deck already has. It runs after composition on every path that
  turns an answer into slide content (finding 3). A person or an agent with
  write access can still put any `https:` URL in such a field: that is their
  own write. Two loads are not a media field, and the same call holds them
  to the same rule (DY-863). **Text a renderer turns into a load**: a
  database type writes a field into its markup as it is (`{{raw}}`) or into
  an attribute (`<img src="{{esc photo}}">`), a fork type may do the same,
  and the sanitizer keeps `<img src="https://…">` for every writer. So the
  rule renders each slide as a viewer gets it, reads what the markup asks a
  browser to load (every attribute but a link's `href` and a short list of
  names and sizes, read as an address and word by word, and as CSS, where an
  escape, a comment or any function that is not arithmetic, colour, gradient,
  shape, transform or filter counts), and empties a value the model wrote
  that adds a load the render without its values does not have. A value the
  given slides held in the same field of the same type stays; a choice among
  a field's declared options is no writing. **A field the type withholds**
  (`ai: false`, such as a video's Bunny library): an answer that fills it
  gets back what the given slides held there, or the type's default, which
  carries the installation's configuration. The sanitizer itself was not
  narrowed: a person's markup that loads a partner's picture is their own
  write. **Published editions are closed**:
  `server/export/edition-input.js` refuses any frame and any non-`data:` URL
  at publish time. **Exports fetch server-side** through the SSRF guard, which
  blocks private and metadata addresses and accepts public hosts, so a public
  URL an author chose is requested from the server's own address.
- **Links.** Markdown links allow `https?:` only and no images; `url` fields
  are checked at write time, and renderers re-check the scheme at render time.
- **Destructive edits.** A model's plan never removes a slide and writes
  only the slides the starter pointed at; removals come back as proposals
  (finding 4).
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
([`viewer-read-data.md`](viewer-read-data.md)) bounds what a reader sees, and
a copy by a reader is the same projection (finding 2).

**Fork tools.** `custom/mcp-tools.js` is imported once per process from the
filesystem, runs with the server's full rights, and must still declare a
permission to be callable with a key. Content plays no part in which tools
load.

## Cost and abuse

- **Every model call is metered on the transport** (`server/utils/llm/meter.js`,
  DY-844): counted per organization and person per day, whichever route,
  key, MCP session or job started it, and refused with 429
  `ai_quota_exceeded` past the installation's `AI_DAILY_CALL_LIMIT`. The
  organization's admins see the count under Settings > Organization. There is
  no per-route rate limit and no budget per organization or person; who may
  start a call is finding 8.
- **API keys are metered per request, not per call.** `aiCallsPerDay` is 10,
  100 or unlimited by tier (`server/storage/api-keys.js`), counted once per
  request, while a wizard run is three plus _n_ model calls and a translation
  one per batch. Keyless stdio MCP has no quota.
- **Tokens are recorded next to the calls** where the vendor reports them
  (`usage.js`; every vendor's usage shape is now read). The ceiling counts
  calls, not tokens: a call is known before it goes out, its tokens only after
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
2. **What a reader can get out of a deck was wider than the reader
   projection.** Fixed: a copy by an actor who may not write the source is the
   reader projection, on the editor, v1 and MCP alike;
   `tests/duplicate-reader-projection.test.js` pins it (DY-810).
3. **A URL the model wrote could load in a viewer's browser without a click.**
   The scrub for remote images ran on four generation and append paths and
   read image fields only, so section refine, iterate, convert and an
   analysis's proposed slide returned or stored whatever the model put in an
   image, a background, an embed or a video, with the deck's text in its
   query if a slide asked for that. Fixed: every path that turns an answer
   into slide content holds it to one rule, `dropForeignMedia` (§ Sinks), and
   `tests/ai-model-media.test.js` drives each path with a model that plants a
   URL and fails on a call to the transport it has not filed (DY-811). The
   same call holds the two loads that are not a media field: a text the
   model wrote that a type renders into a load (markup through `{{raw}}`, a
   value in an attribute) is emptied, read off the rendered slide, and a
   field a type withholds from the model gets back what was held or the
   type's default (DY-863).
4. **A plan could reach further than the slides the starter named.** A
   deck-wide iteration and a compression plan applied `remove` and `replace`
   on any index, MCP stored that before the agent saw it, and a slide title
   could pull the target of a command. Fixed: `scopePlan`
   (`server/utils/ai/iterate-deck.js`) writes a modification only on a slide
   the starter pointed at (the editor's open slide, MCP `apply`) or under a
   deck-wide command, and turns every removal into a proposal; MCP
   `iterate_presentation` and `compress_presentation` write only with `apply`
   and its indexes, compression without asking the model again; the target
   is read from the command, never from a title. "Never remove the title or
   payoff slide" stays in the prompt as advice, not as the boundary.
   `tests/ai-plan-scope.test.js` pins an injection in slide 7 that asks to
   remove slide 2 (DY-812).
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
8. **AI spend was unmetered inside the app and under-counted on keys.**
   Fixed: every model call is counted on the transport per organization and
   person, and the installation's daily ceiling refuses with 429;
   `tests/ai-usage-meter.test.js` pins both (DY-844). An organization's
   admin reads its own counts, but of the installation only the share of the
   ceiling used, and nothing without a ceiling: the installation total is every
   organization's calls together (DY-860). The per-key counter
   still counts requests, not calls. The permission half is fixed too: `compare-ai`, `description/generate` and
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
day the sandbox offers AI, the release with the fixes for finding 3 (DY-811,
DY-863) becomes a launch condition first (a beacon from a public deck), and
the sandbox's Mistral-only
rule stops being belt and braces.

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
- The scope of a plan: `tests/ai-plan-scope.test.js`.
- Media a model's answer may hold, on every writing path:
  `tests/ai-model-media.test.js` drives every path with planted media in every
  known spelling, and renders every media field of every type and every legacy
  key the read funnel folds into one, resolving what a browser would fetch
  (attributes through an HTML parser, CSS with its escapes; any CSS address
  the parser refuses counts as a load). The planted set carries markup into
  a database type's text and attribute and a Bunny library of the model's
  own onto every path that offers such a type, and every form of planted
  markup is rendered through the sanitizer.
- Authorization: `tests/mcp/mcp-tool-permissions.test.js` (every tool
  declares a permission).

Not pinned by any test: a `javascript:` or foreign-host video source (added
with the fix for finding 1). Each item
carries its regression test as an acceptance criterion, after the pattern of
the faked seam in `tests/translate-undeclared-item-strings.test.js`.
