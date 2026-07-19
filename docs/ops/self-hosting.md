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
| `OPENAI_API` / `CLAUDE_API` / `MISTRAL_API` / `DEEPSEEK_API` | Enable the AI wizard (optional; one is enough) |
| `DATABASE_*` | Postgres storage instead of JSON files (optional) |
| `DEFAULT_THEME` | Default theme id for new decks |
| `COLLAB_ENABLED` (+ `COLLAB_LIVE_EDITS`) | Real-time collaboration: presence, and optionally live co-editing (default off) |
| `BREVO_API_KEY` + `BREVO_SENDER_*`, `APP_URL` | Outgoing notification email (optional); `APP_URL` is used for links in those mails |

After editing: `docker compose up -d` to apply.

### Database migrations

When running with Postgres, apply migrations after each update:

```bash
cd /opt/deckyard && docker compose exec app npm run db:migrate
```

Feature flags that need a migration on Postgres: `COLLAB_LIVE_EDITS` requires
migration `040_presentation_ydocs` (included in a normal `db:migrate` run).

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

## Security defaults

The container runs as a **non-root user** (`node`, uid 1000) so a compromise of
the headless-Chromium renderer used for PDF/PNG export lands as an unprivileged
user rather than root. Two consequences for self-hosters on Linux:

- **Bind-mounted volumes must be writable by uid 1000.** `docker-compose.yml`
  mounts `./server/data` and `./server/uploads` from the host. On a Linux VPS a
  bind mount keeps its host ownership, so if those directories are owned by root
  the app cannot write to them. After the first clone/deploy, run once on the
  host:

  ```bash
  sudo chown -R 1000:1000 server/data server/uploads
  ```

- **Chromium's in-browser sandbox is off by default.** Its namespace sandbox
  needs syscalls that Docker's default seccomp profile blocks, so enabling it
  on the stock profile would break export. Non-root already contains the risk.
  If you want the extra layer, run the container with a Chromium seccomp profile
  (or `--cap-add=SYS_ADMIN`) and set `PUPPETEER_SANDBOX=true`.

## Running a public sandbox

Deckyard has a sandbox mode (anonymous guest sessions, 24h auto-cleanup,
watermarked exports, uploads disabled) for public demo instances. Use
`docker-compose.sandbox.yml`; it sets `SANDBOX_MODE=1` and the related
`SANDBOX_*` variables (TTL, watermark, theme) documented in
`server/config/sandbox.js`.
