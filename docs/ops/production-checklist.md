# Production checklist: the minimal environment

`.env.example` documents every option Deckyard has. A production install needs about fifteen of them. This page is that list, with one word per variable on why it is there; `npm run setup -- --profile production` writes the same block as a file you fill in.

```bash
npm run setup -- --profile production --out .env.production \
  --app-url https://slides.example.com --admin-email ops@example.com
```

The profile writes a fresh file and refuses an existing one (`.env` by default, so pass `--out` in a checkout that already has one). It generates `AUTH_SECRET`, fills what the flags give it, leaves empty what only you know, and writes the optional groups commented out. On a PaaS you paste the result into the platform's environment settings; on a VPS it becomes `.env`.

Then fill the empty values and run the doctor: every empty required value is a red line with its fix ([doctor.md](doctor.md)).

## The block

"Required" means a production install without it is wrong or broken. "Optional" means it belongs to a feature you may not want; leaving it out is a decision, not an omission.

### Core (required)

| Variable      | Why          | What to set                                                                                                     |
| ------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`    | strictness   | `production`. The Docker image sets it; the doctor's production-only checks (https, dev bypass) key on it.      |
| `HOST`        | reachability | `0.0.0.0`, so the proxy in front can reach the server. The image sets it; outside it the server binds loopback. |
| `APP_URL`     | links        | The public `https://` origin. Share links, mail links, exports and the SSO callback are built from it.          |
| `TRUST_PROXY` | client-IP    | `true` behind a proxy you control (the PaaS, Caddy). The login throttle keys on the real client IP.             |

### Auth (required)

| Variable           | Why      | What to set                                                                                        |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`      | sessions | 32+ random characters; the profile generates one. Keep it stable: a new secret signs everyone out. |
| `AUTH_ADMIN_EMAIL` | admin    | The address that gets the admin role on first sign-in.                                             |

### Database (required)

| Variable       | Why       | What to set                                                                                                                       |
| -------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | storage   | `postgres://user:password@host:5432/dbname`. PostgreSQL is the only storage backend. `DATABASE_HOST`/`_PORT`/`_USER`/… work too.  |
| `DATABASE_SSL` | transport | `false` for a database on the platform's private network; leave empty (SSL on for any non-localhost host) for a managed database. |

### Uploads (required: one of the two)

| Variable        | Why          | What to set                                                                                                     |
| --------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `UPLOADS_DIR`   | volume       | `server/uploads/` (in the image: `/app/server/uploads`). Mount a persistent volume there, writable by uid 1000. |
| `S3_ENDPOINT`   | object-store | Or store media in any S3-compatible bucket instead of a volume: all four of `S3_ENDPOINT`, `S3_BUCKET`, …       |
| `S3_BUCKET`     | object-store | … `S3_ACCESS_KEY` and `S3_SECRET_KEY` make S3 the store (`MEDIA_STORAGE_MODE=auto`).                            |
| `S3_REGION`     | object-store | As your provider names it.                                                                                      |
| `S3_ACCESS_KEY` | object-store | A key that may put, get and delete objects.                                                                     |
| `S3_SECRET_KEY` | object-store | Its secret.                                                                                                     |

The bucket serves `uploads/*` publicly and must keep `private/*` private; the doctor's upload probe refuses a bucket that serves both.

### Mail (required for magic links and invitations)

| Variable             | Why      | What to set                                                                                                      |
| -------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `BREVO_API_KEY`      | delivery | Magic links, invitations, password resets and notifications. Without it none of them is sent (a doctor warning). |
| `BREVO_SENDER_EMAIL` | sender   | An address on a domain the provider has verified.                                                                |

An SSO-only install signs in without mail; invitations and notifications still need it.

### SSO (optional)

| Variable             | Why      | What to set                                                                   |
| -------------------- | -------- | ----------------------------------------------------------------------------- |
| `SSO_ENABLED`        | switch   | `true` when an OpenID Connect provider signs your users in.                   |
| `OIDC_ISSUER_URL`    | identity | The issuer itself (ZITADEL: the instance URL; Keycloak: `…/realms/<realm>`).  |
| `OIDC_CLIENT_ID`     | client   | From the application you registered at the provider.                          |
| `OIDC_CLIENT_SECRET` | client   | Its secret.                                                                   |
| `OIDC_REDIRECT_URI`  | callback | `APP_URL` + `/api/auth/oidc/callback`; register exactly this at the provider. |

The rest (domains, roles, groups, organizations) is in [sso-oidc.md](../reference/sso-oidc.md).

### Themes (optional)

| Variable              | Why     | What to set                                                                  |
| --------------------- | ------- | ---------------------------------------------------------------------------- |
| `DEFAULT_THEME`       | default | Seed slug of the theme new decks get.                                        |
| `ENABLED_THEMES`      | picker  | Comma-separated seed slugs people may pick; empty means all.                 |
| `DECKYARD_CUSTOM_DIR` | fork    | Absolute path of a fork's `custom/` directory, when it is not at `./custom`. |

### AI (optional)

| Variable     | Why        | What to set                                                                                       |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------- |
| `OPENAI_API` | generation | AI features are on only when a provider key is set. One provider is enough.                       |
| `CLAUDE_API` | generation | Or this one; `.env.example` § AI lists the others (Mistral, DeepSeek, an OpenAI-compatible host). |

No key, no AI: nothing is sent to a model provider unless you set one.

## Then

1. Deploy: [deploy-paas.md](deploy-paas.md) for a PaaS, [self-hosting.md](self-hosting.md) for a VPS with the bundled compose stack.
2. Run the doctor in the running container: `node scripts/doctor.js`. Zero red lines before the first user.
3. Set up back-ups and rehearse a restore once: [backup-restore.md](backup-restore.md).
