# Deploy Deckyard to production with your AI agent

[agent-install.md](agent-install.md) gets Deckyard running on your own machine. This page is the step after it: a production deploy of Deckyard (or your fork) on a PaaS, with PostgreSQL, sign-in and optionally SSO, checked by the doctor before anyone uses it.

The block below is what a human pastes to their agent; everything after it is the procedure the agent follows. It calls the other operations pages in order instead of repeating them, so there is one reading of the configuration, not a new one per deploy.

## The prompt (paste this to your agent)

```text
Deploy my Deckyard to production on <Coolify | Railway | Render | Fly>,
with PostgreSQL and sign-in (and SSO with <provider>, if I say so).

Follow the procedure at:
https://raw.githubusercontent.com/jaapstronks/deckyard/main/docs/ops/agent-deploy.md

Before you start, ask me for: the public URL, the admin email, the repository
and the tag or branch to deploy, and whether media goes on a volume or in S3.
Ask me for every secret; never invent one and never commit one.

The deploy is done when `node scripts/doctor.js` in the running container
shows no red line. Show me its output, then tell me the URL to sign in.
```

## Procedure (for the agent)

### 1. Collect the inputs

Ask the operator for what only they know, before touching the platform:

| Input                    | Used for                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Platform                 | Which section of [deploy-paas.md](deploy-paas.md) applies                                    |
| Public URL (`https://…`) | `APP_URL`, the platform's domain, and the SSO callback                                       |
| Admin email              | `AUTH_ADMIN_EMAIL`: this address gets the admin role on first sign-in                        |
| Repository and ref       | The fork or `jaapstronks/deckyard`, at a release tag (a fork deploys tags, not `main`)       |
| Media                    | Persistent volumes at `/app/server/uploads` and `/app/server/data`, or an S3 bucket (`S3_*`) |
| Mail                     | A Brevo key and a verified sender, or a decision to run without mail (SSO-only sign-in)      |
| SSO (optional)           | The provider's issuer URL, client id and secret; see [sso-oidc.md](../reference/sso-oidc.md) |
| AI (optional)            | A provider key. No key means no AI features, and nothing is sent to a model provider         |

If the operator has no PaaS account or no database option, say so and stop. Do not sign up for a platform on their behalf.

### 2. Generate the environment

In a checkout of the repo at the ref you deploy, write the minimal production block with the setup profile:

```bash
npm run setup -- --profile production --out .env.production \
  --app-url https://slides.example.com --admin-email ops@example.com
```

It generates `AUTH_SECRET`, fills what the flags give it, derives `OIDC_REDIRECT_URI` from `--app-url`, leaves empty what only the operator knows, and writes the optional groups commented out. It refuses to overwrite an existing file. What each variable is for: [production-checklist.md](production-checklist.md).

Fill the empty values with the operator's answers from step 1. `.env.production` holds secrets: it is gitignored like `.env`, so never `git add -f` it, never print its secret values in your reply, and delete the local copy once the platform has it.

### 3. Provision and deploy

Follow [deploy-paas.md](deploy-paas.md): the contract for any platform, then the section for the operator's platform. In short:

1. A PostgreSQL resource (14+). Use its **internal** URL as `DATABASE_URL`, with `DATABASE_SSL=false` on the platform's private network.
2. An application built from the repo's `Dockerfile` (not a buildpack), internal port `4177`, the operator's domain on it. TLS is the platform's job.
3. The environment block from step 2 pasted into the platform's environment settings.
4. Media: persistent volumes at `/app/server/uploads` and `/app/server/data` (the image owns both paths, so a new volume there is writable by uid 1000), or the `S3_*` values and no volume.
5. Deploy. The entrypoint applies migrations before the server starts; there is no release command to configure and no `db:migrate` to run.

Wait until the platform reports the container **healthy**. The image carries its own `HEALTHCHECK` on `GET /health`, so the platform needs no health-check configuration. If it never turns healthy, read the container log first: a refused boot names its cause (`DATABASE_HOST=localhost`, a short `AUTH_SECRET`, an incomplete SSO config).

### 4. SSO (only if the operator asked for it)

Register an application at the provider with exactly the redirect URI from the profile (`APP_URL` + `/api/auth/oidc/callback`), set `SSO_ENABLED=true` and the `OIDC_*` values, and redeploy. Provider specifics, domains, roles and groups: [sso-oidc.md](../reference/sso-oidc.md). The doctor in step 6 checks the callback path and fetches the issuer's discovery document, so a wrong issuer shows there rather than at the first sign-in.

### 5. Back-ups

Set them up now, not after the first incident: [backup-restore.md](backup-restore.md). On Coolify, schedule the PostgreSQL resource's own dumps; on a managed database, check the snapshot retention. A media volume is rarely in the platform's back-up, so say so to the operator if media is not in S3. Rehearsing a restore once (§ _Rehearse it once_) is the operator's call; offer it.

### 6. Run the doctor: the last step before the first user

In the running container (the platform's terminal, or its exec command):

```bash
node scripts/doctor.js          # one line per check, and the fix for every red one
node scripts/doctor.js --json   # the same findings as JSON, for you to parse
```

Each finding has an `id`, a `status` (`ok`, `warn`, `fail` or `skip`) and a `message`, plus a `fix` for most red and warning lines. The command exits `1` while any check fails.

- **Red (`fail`)**: apply the fix (usually an environment value), redeploy, and run the doctor again. Repeat until there is no red line. Do not hand the deploy over with a red line in it.
- **Warning (`warn`)**: report each one to the operator. A warning can be a decision (no mail transport on an SSO-only install), so ask; don't silence it.

What every check means: [doctor.md](doctor.md).

### 7. Report back, then invite the first user

Show the operator the doctor's final output and tell them:

- the URL to sign in, and that `AUTH_ADMIN_EMAIL` gets the admin role on its first sign-in (by magic link, which needs mail, or through SSO);
- that they invite the rest of their people from **Settings → Users** once signed in;
- where back-ups go and whether a restore was rehearsed;
- which warnings they chose to keep.

To connect yourself to the new instance over MCP afterwards, create an API key in the running container and use the remote transport described in [agent-install.md](agent-install.md) § _Wire yourself in over MCP_.
