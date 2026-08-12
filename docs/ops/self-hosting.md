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
| `DATABASE_*` | Override the bundled Postgres (host, credentials, SSL) — see below |
| `DEFAULT_THEME` | Default theme id for new decks |
| `COLLAB_ENABLED` (+ `COLLAB_LIVE_EDITS`) | Real-time collaboration: presence, and optionally live co-editing (default off) |
| `BREVO_API_KEY` + `BREVO_SENDER_*`, `APP_URL` | Outgoing notification email (optional); `APP_URL` is used for links in those mails |

After editing: `docker compose up -d` to apply.

### Storage: the bundled database

`docker compose up` starts a `postgres:16` service alongside the app and points
the app at it, so a fresh clone runs on Postgres with no extra step. The
database is not published to the host — only the app container can reach it —
and its data lives in the `pg_data` named volume, which survives
`docker compose restart` and `docker compose up -d --build`.

Migrations are applied automatically when the app container starts
(`scripts/docker-entrypoint.sh`). Applied migrations are recorded in a
`_migrations` table, so a restart re-runs nothing and the manual
`docker compose exec app npm run db:migrate` after each update is no longer
needed. Feature flags that need a migration on Postgres — `COLLAB_LIVE_EDITS`
requires `040_presentation_ydocs` — are covered by that automatic run.

Two things you may want to change in `.env`:

- **Credentials.** The bundled database defaults to `deckyard` / `deckyard` on
  database `deckyard`. Set `DATABASE_USER`, `DATABASE_PASSWORD` and
  `DATABASE_NAME` before the first `up` to pick your own; both containers read
  the same variables, so they stay in sync. Changing them after the volume
  exists does not rename the existing role or database.
- **A managed database instead.** Set `DATABASE_HOST` (plus port, name,
  credentials) to point at your provider. SSL is on by default for any
  non-localhost host; set `DATABASE_SSL_REJECT_UNAUTHORIZED=false` for a
  self-signed certificate. The bundled service still starts and idles. To stop
  it entirely, add a `docker-compose.override.yml` that both drops the
  dependency and parks the service behind an inactive profile — dropping only
  one of the two makes Compose refuse to start ("service app depends on
  undefined service postgres"):

  ```yaml
  services:
    app:
      depends_on: !reset []
    postgres:
      profiles: ["disabled"]
  ```

PostgreSQL is the only storage backend. The old `file` backend (JSON on disk)
was removed in 1.x, per the beta stance in
[`versioning.md`](../reference/versioning.md); `STORAGE_MODE` may be left
unset or set to `postgres`, and there is no third spelling:
`STORAGE_MODE=postgresql` is a boot error, not an alias.

> **Upgrading an existing file-storage install?** Your `server/data/` decks are
> not served from Postgres. Deckyard **refuses to start** when it finds decks
> on disk while the database holds none — so you get a stopped container,
> never an empty organization. Import the data once with `npm run db:import`
> (in compose: `docker compose exec app npm run db:import`). The import is
> idempotent and your files are never touched.

### Backups

The `pg_data` volume holds everything except uploaded media:

```bash
docker compose exec postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql
```

Back that up together with `server/uploads/`.

## Deploy updates

```bash
bash scripts/vps-deploy.sh --host <your-server-ip> --user root
```

This pulls the latest `main` and rebuilds the containers. Or set up your own
CI to run the same two commands over SSH.

## Back up

On the compose stack (Postgres): the `pg_data` volume plus `server/uploads/` —
see [Backups](#backups) above for the `pg_dump` command.

Outside compose, back up your own PostgreSQL plus the same two directories:

- `server/data/` — the deck-thumbnail cache plus whatever an old install's
  one-time import left behind (settings and decks live in PostgreSQL since 1.x)
- `server/uploads/` — uploaded media

## Pruning legacy disk data

An install that ran Deckyard before the PostgreSQL migration still carries the
old disk-JSON state under `server/data/` — decks, versions, interactions,
settings — all of which `db:import` and migrations 053/058–061 moved into the
database. Those files are dead copies, but do not delete them by hand: the
boot-time migration guard uses `server/data/presentations/` to detect an
un-imported install, so removing it in the wrong order disarms that guard.
What stays alive in that directory is exactly one thing: `deck-thumbs/`, the
thumbnail cache. `server/uploads/` is unrelated and always stays.

Do this in order (on a compose stack, prefix the npm commands with
`docker compose exec app`):

1. **Update first.** Run the release that ships `scripts/prune-legacy-data.js`
   (forks sync on tags, not `main`).
2. **Verify PostgreSQL carries the data** — this gate comes before any delete:

   ```sh
   npm run db:migrate:status   # 053, 058-061 applied?
   # then count the rows your install cares about, e.g. via psql:
   #   select count(*) from presentations;
   ```

   Zero rows in `presentations` while `server/data/presentations/` has decks →
   **stop**: run `npm run db:import` first.
3. **Back up the whole directory** before deleting anything, and keep the
   archive at least one release:

   ```sh
   tar czf server-data-preclean-$(date +%F).tgz server/data
   ```

4. **Dry-run the prune, then run it.** The script re-checks step 2 itself,
   defaults to a dry run, and never touches `deck-thumbs/` or the uploads
   directory:

   ```sh
   node scripts/prune-legacy-data.js            # lists what would go
   node scripts/prune-legacy-data.js --delete   # removes the fossils
   ```

5. **Boot and smoke-test**: log in, open a deck, run a live session with a
   poll, export a PDF. Only then consider the backup disposable.
6. **Running a fork?** Report back upstream what was actually on disk and
   whether anything broke — that is how this instruction stays honest.

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
watermarked exports, uploads disabled) for public demo instances. Run it as a
stack of its own — `docker compose -f docker-compose.sandbox.yml up -d --build`
— not as an override on `docker-compose.yml`: it defines its own app, proxy
and volumes, and runs on file storage in throwaway volumes. It sets
`SANDBOX_MODE=1` and the related `SANDBOX_*` variables (TTL, watermark, theme)
documented in `server/config/sandbox.js`.

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
  built-ins (brand, corporate, deckyard, editorial, midnight, playful) and hides any
  organization custom themes, which may carry a customer's branding. Drop in
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
