# Check an installation: `npm run doctor`

`npm run doctor` checks an installation's configuration **without starting the server**: one line per check, green or red, and for red the fix. Run it after editing `.env`, before the first user, and after every upgrade. It exits `1` when any check failed, so a deploy step can gate on it; warnings do not fail.

```bash
npm run doctor                                  # in a checkout, reads .env
docker compose exec app node scripts/doctor.js  # in the running container
npm run doctor -- --json                        # the same findings as JSON, for an agent
```

The report is the only thing on stdout; the server's own log lines (the database connecting, the media provider starting) go to stderr, so `--json` pipes cleanly.

```
✓ Authentication  AUTH_SECRET set, auth enabled
✓ Public URL      https://slides.example.com
✓ Storage mode    postgres
✓ Database        deckyard@postgres:5432/deckyard
✓ Migrations      all applied
✓ SSO config      callback https://slides.example.com/api/auth/oidc/callback
✗ OIDC issuer     https://idp.example.com/.well-known/openid-configuration answered HTTP 404.
                  fix: Check OIDC_ISSUER_URL: it is the issuer itself (ZITADEL: the instance URL, Keycloak: …/realms/<realm>), and this host must reach it.
```

## The checks

The doctor asks the same functions boot asks (`authConfigError()`, `storageModeError()`, `pendingMigrationsError()`, …), so it never disagrees with the server about what is fatal, and what boot only warns about is a warning here too. On top of that it checks what boot cannot know until the first user needs it.

| Check            | Red when                                                                                                                                                      | Warns when                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `auth`           | `AUTH_SECRET` missing or under 32 characters (boot refuses); `AUTH_DEV_BYPASS` set in production                                                              | `AUTH_ENABLED=false` (everyone is admin, unless a proxy authenticates)                       |
| `public-url`     | in production: no `APP_URL`/`DOMAIN`, or not `https`; always: not a URL, or `APP_URL` and `DOMAIN` name different hosts                                       | outside production: no URL, or not `https`                                                   |
| `storage-mode`   | `STORAGE_MODE` is not a storage backend (boot refuses)                                                                                                        |                                                                                              |
| `database`       | PostgreSQL cannot be reached with the `DATABASE_*` settings (boot refuses, same message)                                                                      |                                                                                              |
| `migrations`     | migrations are pending (boot refuses); skipped when the database is not reachable                                                                             |                                                                                              |
| `sso-config`     | `SSO_ENABLED=true` with an incomplete provider config (boot refuses); skipped when SSO is off                                                                 | `OIDC_REDIRECT_URI` is not `APP_URL` + `/api/auth/oidc/callback` (the expected URI is named) |
| `oidc-discovery` | the issuer's `/.well-known/openid-configuration` does not answer, or names another issuer than `OIDC_ISSUER_URL`                                              |                                                                                              |
| `custom-dir`     | `DECKYARD_CUSTOM_DIR` is set but is not a directory; skipped when there is no `./custom`                                                                      |                                                                                              |
| `themes`         | a core or fork theme seed does not validate (boot refuses); `DEFAULT_THEME` or an `ENABLED_THEMES` slug names no seed; the default is not in `ENABLED_THEMES` |                                                                                              |
| `chromium`       | `puppeteer-core` is not installed, or no Chrome/Chromium is found: PDF, PNG and thumbnail exports fail                                                        | `PUPPETEER_EXECUTABLE_PATH` points nowhere and another browser is used                       |
| `uploads`        | a private probe object cannot be written, read back and deleted (local directory or S3); skipped when uploads are disabled                                    | the media config itself warns (e.g. a legacy `SCW_*` name)                                   |
| `mail`           |                                                                                                                                                               | no mail transport: magic links, invitations, password resets and notifications are not sent  |

"Production" means `NODE_ENV=production`, which the Docker image sets. In a checkout without it, the production-only checks warn instead of failing.

A module that refuses its environment at import time (a relative `DECKYARD_CUSTOM_DIR`, for one) shows as a single red `Startup` line instead of a stack trace.

## What it does not do

- **It writes nothing lasting.** The `uploads` probe is one private object (never reachable over a public URL) that is deleted in the same check. The doctor does not migrate, seed or create anything; `npm run db:migrate` does that.
- **It does not start the server or contact anything but the database, the IdP's discovery document and the configured object store.**

## Health of a running container

The image carries its own `HEALTHCHECK` on `GET /health` (no auth, no database), so Docker, Coolify or any orchestrator knows when the container serves without configuring one. The doctor is the other half: `/health` says the process is up, the doctor says it is configured right.
