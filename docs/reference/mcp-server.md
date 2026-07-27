# Deckyard MCP Server

Deckyard includes a [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI agents create, read, and modify presentations using natural language.

## Quick Start

```bash
# Start the MCP server (stdio transport)
npm run mcp
# or
node server/mcp/index.js
```

## Connecting to Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "deckyard": {
      "command": "node",
      "args": ["server/mcp/index.js"],
      "cwd": "/path/to/your/deckyard",
      "env": {
        "DECKYARD_MCP_OWNER_EMAIL": "you@example.com"
      }
    }
  }
}
```

The `DECKYARD_MCP_OWNER_EMAIL` sets who owns presentations created via MCP. This should match your Deckyard user email. Without it, presentations are created without an owner and may show "Access Denied" in the web UI.

It also determines what the session may touch: every tool that fetches a deck by id enforces per-deck access for this owner (read for read-only tools; collaborator-aware write access for mutating tools; delete is owner-only). When the variable is unset, the stdio session is treated as a trusted local single-user process and per-deck checks are skipped.

## Connecting to Cursor

Add to your Cursor MCP settings:

```json
{
  "deckyard": {
    "command": "node",
    "args": ["server/mcp/index.js"],
    "cwd": "/path/to/your/deckyard"
  }
}
```

## Available Tools

### Reading

| Tool | Description |
|------|-------------|
| `get_slide_types` | List the slide types you may use, resolved for your organization (see [below](#which-slide-types-an-agent-sees)) |
| `list_presentations` | Browse presentations you can access (`scope`: owned/shared/all; with edit URLs) |
| `get_presentation` | Get full deck data (all slides) |
| `get_presentation_url` | Get edit and present URLs for sharing |
| `list_themes` | List available themes with brand colors |
| `list_comments` | List comments on one deck (newest first, with replies, slide context + snapshots, `since` filter); access-scoped |
| `list_recent_comments` | Latest comments across your decks, optionally by one reviewer or since-date (DB store only) |

### Creating

| Tool | Description |
|------|-------------|
| `create_presentation` | Generate a full deck from text content using AI |
| `create_presentation_from_slides` | Write a deck directly from a pre-structured slide array — no AI pass |
| `add_slide` | Add a slide at a specific position |
| `append_slides` | AI-generate new slides from content and add to existing deck |
| `duplicate_presentation` | Create a copy of an existing presentation |

### Modifying

| Tool | Description |
|------|-------------|
| `update_slide` | Update a slide's content directly |
| `remove_slide` | Remove a slide by index |
| `reorder_slides` | Move a slide from one position to another |
| `convert_slide` | AI-powered type conversion (e.g. content → list) |
| `iterate_presentation` | Natural language modification ("make slide 3 punchier") |

### Commenting

| Tool | Description |
|------|-------------|
| `add_comment` | New top-level comment as the acting user, optionally anchored to a slide (stores a slide snapshot) |
| `reply_to_comment` | Reply in an existing thread ("good point, fixed in slide 7") |
| `set_comment_status` | Resolve / reopen / dismiss (owner-only, same transitions as the app) |

Details, payload shape and the matching REST endpoints:
`docs/reference/comments-api.md`.

### Analyzing

| Tool | Description |
|------|-------------|
| `validate_presentation` | Check for density, repetition, and readability issues |
| `analyze_presentation` | AI-powered improvement suggestions (language, structure, brevity) |
| `compress_presentation` | Find merge/removal opportunities to tighten the deck |

### Previewing & exporting

| Tool | Description |
|------|-------------|
| `preview_slide` | Render one slide as self-contained HTML (display as an artifact) |
| `preview_presentation` | Render a slide range as self-contained HTML (visual gallery) |
| `export_presentation` | Get a download URL for a finished export (PDF, PPTX, HTML, JSON, or zipped per-slide PNGs) |

`export_presentation` returns a URL the user opens in a browser signed in to
Deckyard; the server renders the file on demand (PDF/PPTX/PNG take a few seconds
for large decks). Use `preview_presentation` instead when you want an inline
visual preview rather than a downloadable file.

### Deleting

| Tool | Description |
|------|-------------|
| `delete_presentation` | Move a presentation to trash |

## Guided prompts

Alongside the tools, the server registers seven **prompts** — the entries a
client surfaces in its `/` menu (Claude Desktop) or prompt picker. A prompt is a
parameterized workflow: the client collects the arguments, the server returns
the composed instruction, and the model then drives the tools itself.

| Prompt | What it does | Required | Optional |
|--------|--------------|----------|----------|
| `create-presentation` | Generate a slide deck from text, notes, or a document | `content` | `language`, `speaker` |
| `create-from-structured-data` | Build a deck from pre-structured slides — no AI rewriting. Use when you already know the exact slide types and content | `title`, `data` | `language` |
| `improve-presentation` | Analyze an existing presentation and apply improvements | `presentationId` | `focus` |
| `refine-slide` | Improve a specific slide with natural-language instructions | `presentationId`, `instruction` | — |
| `compress-presentation` | Make a presentation shorter and punchier by merging or removing slides | `presentationId` | `intensity` |
| `add-content` | Add new slides to an existing presentation from additional text | `presentationId`, `content` | — |
| `deck-overview` | Quick overview of a presentation: slides, themes, validation | — | `presentationId` |

`server/mcp/prompts.js` is the source of truth for both the list and the
argument shapes.

## Example Workflow

A typical agent interaction might look like:

1. **Create**: "Generate a presentation about our Q1 results from these meeting notes"
2. **Review**: Use `get_presentation` to see the generated slides
3. **Refine**: "Make slide 3 punchier and split slide 5"
4. **Validate**: Check for warnings
5. **Convert**: "Change the second list to an icon card grid"

## Architecture

The MCP server is a thin wrapper around Deckyard's existing modules:

```
server/mcp/
├── index.js               Entry point, initializes storage and starts stdio transport
├── protocol.js            JSON-RPC 2.0 protocol (no external dependencies)
├── tools.js               Tool definitions wrapping existing Deckyard functions
├── prompts.js             Guided prompts for the client's / menu
├── presentation-access.js Per-deck authorization for tool calls
├── preview.js             Self-contained HTML previews for preview_* tools
├── custom-tools-loader.js Auto-loads custom/mcp-tools.js (fork extension seam)
├── sse.js / sse-mount.js  Streamable HTTP/SSE transport on the main server
```

Each tool maps directly to existing Deckyard functionality:
- `create_presentation` → `generateDeckV2()` + `createPresentation()`
- `create_presentation_from_slides` → `validateRefinedSlidesStrict()` / `validateAndFixRefinedSlides()` + `createPresentation()` + `updatePresentation()` (no AI pass)
- `convert_slide` → `convertSlideWithAi()`
- `iterate_presentation` → `iteratePresentation()`
- `validate_presentation` → `validateAndFixRefinedSlides()`

### Raw-mode example: `create_presentation_from_slides`

When the caller is itself an LLM (or any agent that already has structured data), `create_presentation_from_slides` writes the deck verbatim — no second AI pass that could re-pick types or paraphrase content.

```json
{
  "title": "Team kickoff",
  "lang": "nl",
  "slides": [
    {
      "type": "title-slide",
      "content": { "title": "Team kickoff", "subheading": "Q2 2026" }
    },
    {
      "type": "team-cards-slide",
      "content": {
        "title": "Wie zit er aan tafel",
        "members": [
          { "name": "Jaap", "byline": "Lead", "image": "https://…" },
          { "name": "Sofie", "byline": "Design", "image": "https://…" }
        ]
      }
    }
  ],
  "validation": "strict"
}
```

- `validation: "strict"` (default) throws `{ slideIndex, slideType, field, expected, got, message }` on the first issue — no partial write.
- `validation: "fix"` applies auto-fixes (truncate, pad, layout switch) and returns them as `appliedFixes` in the response.
- `auto_prepend_title: true` prepends the theme's default title-slide using `title` when the first slide isn't already one.

Call `get_slide_types` first (it returns an `example` field per type) to see the exact content shape for each slide type.

## Which slide types an agent sees

`get_slide_types` derives its answer from the **runtime registry**, not from the
hand-written editorial catalog. Every registered type is offered unless it opts
out, so a type that shows up in the editor's picker also shows up here. Each
entry lands in exactly one of three states:

| State | How it is expressed | What the agent gets |
|---|---|---|
| Documented | An entry in the AI catalog (`server/utils/ai/slide-catalog/`) | Full `description` / `bestFor` / `notFor`, `documented: true` |
| Undocumented | Registered, no catalog entry | A generic description, `documented: false` |
| Withheld | `deprecated: true` or `ai: false` on the definition | Not listed at all |

The `schema` is the same in all three: it is **always** derived from the type's
`fields[]` — what the editor renders a form from and validation runs against —
so an agent is never told about a field the type does not have. A catalog entry
contributes prose only. Individual fields opt out with `ai: false` (or
`hidden` / `deprecated`, which legacy mirror fields already carry), and a
field's `helpText` travels along as the schema entry's `description`.

`ai: false` is the deliberate opt-out for a live type — an app-managed slide, a
back-compat alias, a capability-gated escape hatch. It is the same `ai` key that
carries the catalog entry on a custom file-based type, so one field says either
"here is my agent contract" or "I deliberately have none". Silent absence is no
longer a way to withhold a type: without the flag the type shows up, at worst
as `documented: false`.

The response is resolved **per organization**:

- **Tier 1** — core plus `custom/slide-types/*.js` types from the registry.
- **Tier 2** — slide types this organization published in the builder UI, keyed
  `custom-<slug>` (the same key `/api/slide-types` uses).
- Types the organization **disabled** in its settings are filtered out, so an
  agent never offers what the editor forbids.

Each entry carries its canonical `typeId` (`core/title-slide`,
`acme/hero@2`, `custom/<slug>`) so an agent can talk about versions.

A stdio session has no organization and resolves against the default one; an
SSE session resolves against the organization its API key belongs to.

### `usage` — the organization's own rules

An entry may also carry a `usage` string, and it answers a different question
from the rest of the entry:

| Field | Question it answers | Written by |
|---|---|---|
| `description` / `bestFor` / `notFor` | which type should I pick? | whoever authored the type |
| `usage` | how does this organization require the type to be filled? | the organization |

Sources, cut-off dates, mandatory explanations, escalation rules. It sits after
`schema` in the entry so an agent reads the shape first and the house rule
second, and it is **omitted entirely when there is no rule** rather than sent
empty. Agents should treat it as binding.

Four authoring surfaces, one field:

| Where | How |
|---|---|
| Core type | `usage` on the catalog entry in `server/utils/ai/slide-catalog/` |
| Core type, fork override | `usage` in `custom/ai/catalog.js` (no OSS patch needed) |
| Fork file-JS type | `ai.usage` in `custom/slide-types/<type>.js` |
| Tier-2 DB type | the **Usage rules for AI** field in the slide-type builder |

Text is dedented and capped at 1000 characters per type (it multiplies by every
visible type in every response). The authoring paths reject over-long input; the
fork load path truncates instead, so a long rule costs its tail rather than the
whole type. Rules live in `shared/slide-types/usage.js`.

## Custom tools (forks)

Downstream forks add their own MCP tools **without editing
`server/mcp/tools.js`** (which would re-conflict on every upstream merge).
Drop a `custom/mcp-tools.js` file — gitignored upstream, tracked in the fork,
same convention as `custom/slide-types/` — exporting a registrar:

```js
// custom/mcp-tools.js
export default function registerCustomTools(server, ctx) {
  server.tool(
    'publish_presentation',
    'Publish a presentation to its public URL',
    { type: 'object', properties: { presentationId: { type: 'string' } }, required: ['presentationId'] },
    async ({ presentationId }, context) => {
      const owner = ctx.getOwner(context); // per-request (SSE) or default (stdio)
      // ... fork logic; import core modules directly as needed
      return { url: ctx.presentationUrl(presentationId, 'present') };
    }
  );
}
```

Both transports auto-load it (`server/mcp/custom-tools-loader.js`): the stdio
entry point and the lazy SSE mount. Alternatively, call
`registerTools(server, { registerCustom })` yourself with any
`(server, ctx)` function.

`ctx` (the documented helper surface): `repoRoot`, `defaultOwnerEmail`,
`getOwner(context)` (prefers the SSE session's owner over the static default),
`getAppBaseUrl()`, `presentationUrl(id, mode)`. Custom handlers run in the
core process, so anything else can be imported directly.

Core's tool-count tests only count core tools; custom tools are the fork's to
test.

## Remote Access (SSE Transport)

The MCP server supports HTTP-based access at `/mcp` when the main Deckyard server is running. This enables remote AI agents, webhooks, and browser-based MCP clients.

### Authentication

All SSE requests require a Deckyard API key via Bearer token:

```
Authorization: Bearer dk_live_your_api_key_here
```

Create API keys in the Deckyard web UI (Settings → API Keys) or via the API.

### Protocol

The SSE transport implements the [MCP Streamable HTTP transport](https://spec.modelcontextprotocol.io/specification/basic/transports/#streamable-http):

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp` | Send JSON-RPC requests (tool calls, initialize) |
| `GET` | `/mcp` | Open SSE stream for server-initiated messages |
| `DELETE` | `/mcp` | Close a session |
| `OPTIONS` | `/mcp` | CORS preflight |

### Session Flow

```
1. POST /mcp  { "method": "initialize", ... }
   ← 200 { "result": { ... }, headers: { "Mcp-Session-Id": "abc-123" } }

2. POST /mcp  { "method": "tools/call", ... }
   Header: Mcp-Session-Id: abc-123
   ← 200 { "result": { ... } }

3. DELETE /mcp
   Header: Mcp-Session-Id: abc-123
   ← 200 { "ok": true }
```

### Stateless Mode

You can also use POST `/mcp` without session management — each request authenticates independently. Useful for simple integrations.

### Example: curl

```bash
# Initialize
curl -X POST https://your-deckyard.com/mcp \
  -H "Authorization: Bearer dk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

# List presentations (using session)
curl -X POST https://your-deckyard.com/mcp \
  -H "Authorization: Bearer dk_live_..." \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: <session-id-from-above>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_presentations","arguments":{}}}'
```

### Security

- API keys scope access: `read`, `write`, `ai`, `export`
- Rate limiting via existing API key tiers (free/pro/enterprise)
- Sessions expire after 30 minutes of inactivity
- Each session is bound to its API key owner — cross-key access is denied
- Per-deck authorization: tools use the same collaborator-aware
  `canRead`/`canWritePresentation` checks as the app. The key owner can read
  decks they own, workspace decks, and decks shared with them; mutating tools
  additionally require edit rights, and `delete_presentation` is owner-only
- CORS is open (`*`) — restrict via reverse proxy if needed

## Requirements

- Node.js 20+
- Deckyard `.env` configured with an LLM vendor (for AI tools)
- Storage adapter configured (SQLite or PostgreSQL)

## Transports

| Transport | Use case | Auth |
|-----------|----------|------|
| **stdio** | Local tools (Claude Desktop, Cursor) | None needed (local) |
| **SSE** | Remote agents, webhooks, web clients | API key (Bearer token) |
