# Install Deckyard with your AI agent

Deckyard is MCP-native, so it makes sense to let an AI coding agent (Claude
Code, Cursor, or any shell-capable agent) set it up for you: clone it, configure
it with your keys, start it, and wire itself in over MCP so it can immediately
build presentations.

This page is the stable procedure the agent follows. The block below is what a
human pastes to their agent; everything after it is the reference the agent
reads.

## The prompt (paste this to your agent)

```text
Install Deckyard for me and connect to it over MCP.

Follow the procedure at:
https://raw.githubusercontent.com/jaapstronks/deckyard/main/docs/ops/agent-install.md

Do this:
1. Clone https://github.com/jaapstronks/deckyard into ./deckyard (or update it
   if it's already there).
2. Configure it non-interactively with: npm run setup -- --yes
   Ask me first whether I want to add an AI provider key or enable auth, and if
   so pass the matching flags (see the doc). If I don't care, use the defaults.
3. Start it (npm run start; or, if I have Docker, the local compose path in the
   doc that publishes localhost:4177).
4. Add the MCP server to your own config so you can create presentations, then
   confirm the connection by listing the available Deckyard tools.

Tell me the URL to open and the edit/present links for anything you create.
```

## Procedure (for the agent)

### 1. Prerequisites

The install needs **either** Docker (with the compose plugin) **or** Node.js
22+, plus `git`. Check with `docker compose version`, `node -v`, `git --version`.
If neither runtime is present, tell the user where to get one and stop — do not
try to install Docker or Node yourself without asking.

### 2. Get the code

```bash
git clone https://github.com/jaapstronks/deckyard.git
cd deckyard
```

If `./deckyard` already exists, `cd deckyard && git pull --ff-only` instead.

The repo also ships `scripts/install.sh`, which does clone + configure + start in
one step and auto-picks Docker vs Node. You may call it directly instead of the
manual steps — but the manual steps give you more control over configuration,
which is the point of the agent path.

### 3. Configure `.env` (non-interactive)

Deckyard is secure-by-default: the server **refuses to start** without an
`AUTH_SECRET` unless auth is explicitly disabled. So always write a `.env`
before starting. Use the setup script's non-interactive flags:

```bash
npm run setup -- --yes                       # local single-user: auth off, no AI
npm run setup -- --yes --ai=claude --ai-key=sk-ant-...   # with an AI provider
npm run setup -- --yes --auth=on --admin-email=you@example.com  # enable auth
```

Recognised flags:

| Flag | Values | Effect |
|---|---|---|
| `--ai` | `openai` \| `claude` \| `mistral` \| `deepseek` \| `ollama` | Which AI provider |
| `--ai-key` | your key | API key for that provider (skipped if absent) |
| `--auth` | `on` \| `off` | On generates a strong `AUTH_SECRET`; off disables auth |
| `--admin-email` | email | The user who gets the admin role (with `--auth=on`) |
| `--port` | number | App port (default 4177) |
| `--theme` | theme id | Default theme (default `deckyard`) |

The wizard upserts only the keys it is given on top of `.env.example`, so
`.env.example` stays the full reference and nothing set by hand is lost. Never
echo or commit the key — it only ever lands in the local, gitignored `.env`.

**If you hand-edit `.env` instead of using the flags**, use the exact variable
names the app reads (see `.env.example`), not the provider's own naming:

| Provider | `.env` variable |
|---|---|
| Anthropic (Claude) | `CLAUDE_API` |
| OpenAI | `OPENAI_API` (not `OPENAI_API_KEY`) |
| Mistral | `MISTRAL_API` |
| DeepSeek | `DEEPSEEK_API` |

`.env` values are read literally, so a secret-manager reference like
`op://vault/item/key` won't resolve unless you launch the process through that
manager (e.g. `op run -- npm run start`). Paste the resolved key, or use the
`--ai-key` flag.

For a local (auth-off) install the setup script also writes
`APP_URL=http://localhost:<port>`, so the MCP `get_presentation_url` and
`export_presentation` tools return working links out of the box.

### 4. Start

```bash
npm install && npm run start        # Node path → http://localhost:4177
```

If the user prefers Docker, the **local** path publishes the app port directly
(the bare `docker compose up` topology puts the app behind a Caddy reverse proxy
that needs a `DOMAIN`, which a local install does not have):

```bash
# Local: reachable at http://localhost:4177
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build

# Production (behind Caddy on 80/443, needs DOMAIN + LETSENCRYPT_EMAIL in .env):
docker compose up -d --build
```

> **Node is the simplest local path.** For a single-user local try, prefer
> `npm run start`; reach for Docker only if the user explicitly wants it.

### 5. Wire yourself in over MCP

Add Deckyard's stdio MCP server to your own client config so you can create and
edit decks. For a Claude Desktop-style config:

```json
{
  "mcpServers": {
    "deckyard": {
      "command": "node",
      "args": ["server/mcp/index.js"],
      "cwd": "/absolute/path/to/deckyard",
      "env": { "DECKYARD_MCP_OWNER_EMAIL": "you@example.com" }
    }
  }
}
```

`DECKYARD_MCP_OWNER_EMAIL` stamps the owner on decks the agent creates. With
**auth enabled** set it to your account email so the decks are yours in the
browser. With **auth off** (the local default) it is optional — the single local
operator can open every deck regardless of owner, so you can drop it or leave it.

For a remote instance, create an API key and use the SSE transport instead:

```bash
node scripts/create-api-key.js --email you@example.com --name "Agent" --scopes read,write,ai
# then POST https://your-deckyard.com/mcp  with  Authorization: Bearer dk_live_...
```

Confirm the connection by listing the Deckyard tools (you should see
`create_presentation`, `iterate_presentation`, and ~25 more). Full tool
reference: [`docs/reference/mcp-server.md`](../reference/mcp-server.md).

To verify end-to-end **without an AI key**, call `get_slide_types` (returns the
slide catalogue with example content) and then `create_presentation_from_slides`
(builds a deck from hand-authored slides, no AI). `create_presentation` and
`iterate_presentation` need an AI provider, so skip those on a keyless install.

### 6. Report back

Give the user the local URL (`http://localhost:4177`) and, for anything you
create, the edit and present links returned by the MCP tools.
