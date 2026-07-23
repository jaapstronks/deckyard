# Install Deckyard (self-host) & connect over MCP

Set up a local or self-hosted [Deckyard](https://deckyard.eu) instance for the
user and wire yourself in over MCP so you can build presentations. This is an
*install* skill for shell-capable coding agents (Claude Code, Cursor, …) — not
the OpenClaw *usage* skill in `skills/openclaw-skill/`.

The canonical, always-current procedure lives at
[`docs/ops/agent-install.md`](../../docs/ops/agent-install.md); fetch it if you
can, and follow it. This file is the short version.

## Requirements

- **Docker** (with the compose plugin) **or** **Node.js 22+**, plus `git`.
- Shell access. No MCP SDK needed for the install itself.

Check first: `git --version`, and `docker compose version` or `node -v`. If
neither runtime exists, tell the user where to get one and stop — do not install
Docker or Node without asking.

## Steps

1. **Clone** (or update if present):
   ```bash
   git clone https://github.com/jaapstronks/deckyard.git && cd deckyard
   ```
2. **Configure `.env` non-interactively.** Deckyard refuses to start without an
   `AUTH_SECRET` unless auth is off, so always write `.env` first:
   ```bash
   npm run setup -- --yes                                  # local, auth off, no AI
   npm run setup -- --yes --ai=claude --ai-key=sk-ant-...  # add an AI provider
   npm run setup -- --yes --auth=on --admin-email=you@example.com
   ```
   Flags: `--ai` (openai|claude|mistral|deepseek|ollama), `--ai-key`, `--auth`
   (on|off), `--admin-email`, `--port`, `--theme`. Ask the user before adding a
   key or enabling auth; never echo or commit the key (it lands only in the
   gitignored `.env`).
3. **Start:**
   ```bash
   npm install && npm run start          # → http://localhost:4177
   # or, with Docker:
   docker compose up -d --build
   ```
4. **Wire MCP** into your own client config (stdio):
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
   For a remote instance use an API key + the SSE transport (`POST /mcp`,
   `Authorization: Bearer dk_live_...`); mint one with
   `node scripts/create-api-key.js --email you@example.com --name "Agent" --scopes read,write,ai`.
5. **Confirm** by listing the Deckyard MCP tools (expect `create_presentation`,
   `iterate_presentation`, and ~25 more), then report the local URL and any
   edit/present links back to the user.

## Notes

- `scripts/install.sh` does clone + configure + start in one step (auto Docker
  vs Node) if you'd rather not run the steps by hand:
  `curl -fsSL https://raw.githubusercontent.com/jaapstronks/deckyard/main/scripts/install.sh | bash`.
- Full MCP tool reference: `docs/reference/mcp-server.md`.
