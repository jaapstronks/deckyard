# Deploy on a PaaS (Coolify, Railway, Fly, Render)

A PaaS builds the repo's `Dockerfile`, runs the container behind its own TLS proxy and gives it a database. This page is the contract the image offers any platform, then the one platform-specific section we run ourselves (Coolify). For a bare VPS with the bundled compose stack, see [self-hosting.md](self-hosting.md) instead.

## The contract

| Fact        | Value                                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build       | The `Dockerfile` in the repo root (two stages; no build arguments). Choose "Dockerfile", not a buildpack.                                                                              |
| Port        | `4177` (`PORT`, set in the image). The server listens on `0.0.0.0` (`HOST`, set in the image).                                                                                         |
| Health      | `GET /health` answers `200` with no auth and no database. The image carries its own `HEALTHCHECK` on it, so the platform needs no health-check configuration.                          |
| Migrations  | The entrypoint (`scripts/docker-entrypoint.sh`) applies pending migrations before the server starts, retrying while the database comes up. No release command, no manual `db:migrate`. |
| Storage     | PostgreSQL 14+ (`DATABASE_URL`). Media on a persistent volume at `/app/server/uploads`, or in S3 (`S3_*`), then no volume.                                                             |
| TLS         | Terminated by the platform. The repo's `Caddyfile` and the compose `caddy` service are not used. Set `APP_URL` to the `https://` origin and `TRUST_PROXY=true`.                        |
| User        | The container runs as `node` (uid 1000). A mounted volume must be writable by that uid.                                                                                                |
| Environment | The minimal block in [production-checklist.md](production-checklist.md); `npm run setup -- --profile production` writes it.                                                            |
| Last step   | `node scripts/doctor.js` in the running container: every check green (or a warning you chose) before the first user. See [doctor.md](doctor.md).                                       |

Two things that are not the platform's job and still go wrong: `DATABASE_HOST=localhost` inside a container points at the app itself (the entrypoint refuses it and says so), and a database on the platform's private network usually speaks plaintext, so set `DATABASE_SSL=false` for it. SSL is on by default for any non-localhost host.

`/app/server/data` holds only the deck-thumbnail cache. It may be a volume too (thumbnails survive a redeploy) or not (they are rebuilt on demand).

## Coolify

The two production instances we run are on Coolify. In the project:

1. **Database.** Add a PostgreSQL resource (16 is fine). Copy its **internal** connection URL; the app reaches it over Coolify's network by service name.
2. **Application.** Add a resource from the Git repository: the **GitHub App** for a private fork (it also gives you deploy-on-push), or a **deploy key** for a plain SSH clone. Build pack: **Dockerfile**. Ports exposed: `4177`.
3. **Domain.** Set the domain on the application (`https://slides.example.com`); Coolify's proxy fetches the certificate and forwards to port 4177.
4. **Environment.** Paste the block from `npm run setup -- --profile production` into the environment variables (Coolify accepts a whole `.env` at once), with `DATABASE_URL` = the internal URL from step 1 and `DATABASE_SSL=false`.
5. **Storage.** Add a persistent volume with destination path `/app/server/uploads` (skip it with S3). Coolify creates the volume; if you bind a host directory instead, `chown 1000:1000` it on the host.
6. **Deploy**, wait for the container to turn healthy (the image's own `HEALTHCHECK`), then open the application's **Terminal** and run `node scripts/doctor.js`.
7. **Auto deploy.** With the GitHub App, enable automatic deployment on push to the branch you deploy. A fork usually deploys a release tag rather than `main`: see [fork-setup.md](../reference/fork-setup.md).

Back-ups of that database: [backup-restore.md](backup-restore.md) § Coolify.

## Other platforms

The contract above is all a platform needs; each names the same things in its own words. Railway, Render and Fly each build a `Dockerfile`, take `4177` as the internal port, and offer a managed PostgreSQL plus a persistent volume or disk to mount at `/app/server/uploads`. Where the platform has no volumes, use S3. Whatever the platform, the last step is the same: the doctor in the running container.
