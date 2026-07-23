# Self-hosting Deckyard on a VPS

The fastest path from a bare Ubuntu VPS to a running, HTTPS-enabled Deckyard
instance. Everything here uses the `docker-compose.yml` + `Caddyfile` shipped
in the repo root.

## Fastest start (local, one command)

To just try Deckyard on your own machine, run:

```bash
curl -fsSL https://raw.githubusercontent.com/jaapstronks/deckyard/main/scripts/install.sh | bash
```

The installer picks the fastest path it can find (Docker if you have it,
otherwise a plain Node.js 22+ checkout), writes a local `.env` (auth disabled
for a single-user try), starts the app, and opens `http://localhost:4177`. It is
safe to re-run: an existing install is updated in place and an existing `.env`
is left alone.

> **Piping to a shell?** The script is [`scripts/install.sh`](../../scripts/install.sh)
> in this repo. Read it first if you'd rather not pipe — it clones the repo,
> writes a local `.env`, installs dependencies, and starts the app; it sends
> none of your data anywhere. `git clone` + `bash scripts/install.sh` does the
> same thing from a checkout you can inspect. (A short `deckyard.eu/install.sh`
> alias for the marketing site is served from this same script.)

To configure interactively (AI provider + key, auth, port, theme) at any time:

```bash
npm run setup          # a few questions; writes .env
npm run setup -- --yes # non-interactive safe defaults (auth off, no AI)
```

The wizard upserts only the keys it asks about on top of your existing `.env`,
so `.env.example` stays the full reference and nothing you set by hand is lost.

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
  --repo https://github.com/jaapstronks/deckyard.git \
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

What sandbox mode does, and what it deliberately leaves on:

- **Publishing is off.** The `/publish` route returns 403 and the editor hides
  the Publish tab, so anonymous guests can't push arbitrary content onto a
  public `/p/` URL on your domain.
- **Direct uploads are off.** Guests can't upload their own files; the editor
  shows a sandbox-specific notice pointing them at the stock sources instead.
- **AI generation is off.** The "From content · AI" creation flow and the
  server AI routes are disabled, so a public URL can't run up an open-ended
  per-prompt LLM bill. (Same behaviour as `DEMO_MODE`.)
- **Only neutral built-in themes show.** The theme picker lists the generic
  built-ins (corporate, deckyard, editorial, midnight, playful) and hides any
  workspace custom themes, which may carry a customer's branding. Drop in
  `themes/sandbox-*.json` to curate a smaller set.
- **The slide library is hidden** in the New-presentation flow: a throwaway
  guest has no reusable slides to compose from.
- **Unsplash and Giphy stay on** as the stock image sources. Set
  `UNSPLASH_ACCESS_KEY` and `GIPHY_API_KEY` and enable each provider in Settings
  → Stock media. Downloaded stock images land in `SANDBOX_UPLOADS_DIR` (which is
  also what serves `/uploads/`), so a guest can still put an image on a slide.
- **A persistent sandbox banner** tells guests their work is wiped after the TTL.

Storage lives in `SANDBOX_DATA_DIR` / `SANDBOX_UPLOADS_DIR` (separate from your
main data), so the cleanup sweep only ever touches throwaway guest content. See
`.env.example` for the full `SANDBOX_*` list.
