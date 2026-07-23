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
3. Start it (npm run start, or docker compose up -d --build if I have Docker).
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

### 4. Start

```bash
npm install && npm run start        # Node path → http://localhost:4177
# or, if the user has Docker:
docker compose up -d --build        # → http://localhost:4177
```

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

For a remote instance, create an API key and use the SSE transport instead:

```bash
node scripts/create-api-key.js --email you@example.com --name "Agent" --scopes read,write,ai
# then POST https://your-deckyard.com/mcp  with  Authorization: Bearer dk_live_...
```

Confirm the connection by listing the Deckyard tools (you should see
`create_presentation`, `iterate_presentation`, and ~25 more). Full tool
reference: [`docs/reference/mcp-server.md`](../reference/mcp-server.md).

### 6. Report back

Give the user the local URL (`http://localhost:4177`) and, for anything you
create, the edit and present links returned by the MCP tools.
