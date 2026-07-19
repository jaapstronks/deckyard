# Security policy

Thanks for helping keep this project and its users safe.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Instead, use **GitHub's private vulnerability reporting**: go to the
repository's **Security** tab and click **"Report a vulnerability"**. This
opens a private advisory that only the maintainers can see.

Include:

- A clear description of the issue and impact
- Steps to reproduce (or a proof-of-concept)
- Affected versions / commit SHA if known
- Any suggested fix/mitigation (optional)

## Supported versions

This is a small, fast-moving project. Security fixes are provided on a
**best effort** basis for the latest version on the default branch.

## Response expectations

We aim to acknowledge reports within **7 days**, but cannot guarantee a
specific SLA.

## Hardening and secure deployment

Deckyard is designed to run **self-hosted behind a reverse proxy (e.g. Caddy),
with authentication enabled**. In that setup the defaults are safe. The
following controls are built in; the env vars are documented in `.env.example`.

- **Authentication fails closed.** If `AUTH_SECRET` is missing the server
  refuses to start, rather than falling back to anonymous admin access. To run
  intentionally without auth, set `AUTH_ENABLED=false` (sandbox/demo modes also
  boot without auth). See the breaking-change note below.
- **Dev auth bypass is gated on `NODE_ENV`.** `AUTH_DEV_BYPASS=true` only
  takes effect when `NODE_ENV=development`; a leftover flag in staging or
  production (or with `NODE_ENV` unset) can never grant passwordless admin.
- **Login brute-force throttle.** Password logins are rate-limited per IP and
  per email. Behind a proxy, set `TRUST_PROXY=true` so the throttle keys on the
  real client IP instead of the proxy address.
- **CSRF protection.** Cookie-authenticated state-changing requests must be
  same-origin (the `Origin`/`Referer` host must match the app `Host`, `APP_URL`
  or `DOMAIN`). Token / API-key clients are unaffected. Add trusted partner
  origins with `CSRF_ALLOWED_ORIGINS`.
- **SSRF guard on export/render.** Remote images pulled into server-side PDF/PNG
  rendering are resolved and blocked if they point at loopback, private,
  link-local or cloud-metadata addresses (IPv4 and IPv6, including
  IPv4-mapped/compatible forms), so a slide cannot make the server fetch
  internal endpoints.
- **Uploaded SVGs are served inert.** User-uploaded SVGs are served with
  `Content-Disposition: attachment`, `nosniff` and a script-blocking CSP, so a
  malicious SVG cannot run scripts in the app's origin.
- **Request-body size cap.** JSON bodies are bounded (`MAX_REQUEST_BODY_BYTES`,
  default 25 MB) to prevent memory exhaustion from oversized requests.
- **Non-root container + optional Chromium sandbox.** The Docker image runs the
  app (and headless Chromium) as a non-root user, so a renderer compromise is
  contained without root. Chromium's own sandbox is off by default because the
  namespace sandbox needs syscalls Docker's default seccomp profile blocks; if
  you harden the runtime, set `PUPPETEER_SANDBOX=true` to re-enable it.
- **Media keys are confined to the uploads directory**, preventing path
  traversal out of the storage root.

### Breaking change: auth no longer fails open

Deployments that previously ran **without** `AUTH_SECRET` relied on the old
fail-open behavior (anonymous admin). After upgrading, such a deployment will
refuse to start until you either set `AUTH_SECRET` (recommended) or explicitly
set `AUTH_ENABLED=false` to keep running without auth.

### Upgrading an existing Docker deployment

Because the container now runs as a non-root user (uid 1000), bind-mounted
`server/data` and `server/uploads` directories created by an older, root-running
image may be owned by root and cause `EACCES` on first write. Fix once with:

```sh
chown -R 1000:1000 ./server/data ./server/uploads
```
