# Self-hosting Deckyard on a VPS

The fastest path from a bare Ubuntu VPS to a running, HTTPS-enabled Deckyard
instance. Everything here uses the `docker-compose.yml` + `Caddyfile` shipped
in the repo root.

## What you need

- A VPS (any provider) running Ubuntu 22.04+ with ports **80** and **443** open
- A domain with an **A record** pointing at the VPS (e.g. `slides.example.com`)
- SSH access as root (or a sudo user)

## One-command bootstrap

From your own machine:

```bash
bash scripts/vps-bootstrap.sh \
  --host <your-server-ip> \
  --user root \
  --repo git@github.com:yourorg/deckyard.git \
  --domain slides.example.com \
  --email admin@example.com
```

This installs Docker, clones the repo to `/opt/deckyard`, writes a minimal
`.env` (domain + Let's Encrypt email), and starts the stack. Caddy obtains a
TLS certificate automatically; a minute later the app is live at
`https://slides.example.com`.

> Cloning a private fork? Give the VPS a GitHub deploy key first and use the
> SSH clone URL.

## Configure

Edit `/opt/deckyard/.env` on the server. `.env.example` in the repo documents
every option; the ones most installs want:

| Variable | Purpose |
|---|---|
| `AUTH_ENABLED` + `AUTH_SECRET` | Enable auth; long random string for session signing |
| `AUTH_ADMIN_EMAIL` | This user gets the admin role |
| `DEEPSEEK_API_KEY` / `OPENAI_*` | Enable the AI wizard (optional) |
| `DATABASE_*` | Postgres storage instead of JSON files (optional) |
| `DEFAULT_THEME` | Default theme id for new decks |

After editing: `docker compose up -d` to apply.

### Database migrations

When running with Postgres, apply migrations after each update:

```bash
cd /opt/deckyard && docker compose exec app npm run db:migrate
```

## Deploy updates

```bash
bash scripts/vps-deploy.sh --host <your-server-ip> --user root
```

This pulls the latest `main` and rebuilds the containers. Or set up your own
CI to run the same two commands over SSH.

## Back up

Two directories hold all state when using file storage:

- `server/data/` — presentations, versions, settings
- `server/uploads/` — uploaded media

With Postgres, back up the database plus `server/uploads/`.

## Running a public sandbox

Deckyard has a sandbox mode (anonymous guest sessions, 24h auto-cleanup,
watermarked exports, uploads disabled) for public demo instances. Use
`docker-compose.sandbox.yml`; it sets `SANDBOX_MODE=1` and the related
`SANDBOX_*` variables (TTL, watermark, theme) documented in
`server/config/sandbox.js`.
