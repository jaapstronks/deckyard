# Authentication & sessions

## Purpose & scope

This document describes how Deckyard authenticates a request and carries a
session: the cookie/token mechanics, the four ways a user can prove identity
(password, magic-link, SSO, dev-bypass), password reset, and the rate limits
that guard those endpoints. The single-sign-on protocol layer has its own doc
([`sso-oidc.md`](sso-oidc.md)); this one covers the shared session machinery and
the non-SSO login paths, and points at SSO where they meet.

Scope is `server/auth/` plus the auth route handlers under `server/routes/api/`.
Authorization (who may do what, org-scoping) lives in
[`tenant-isolation.md`](tenant-isolation.md); this doc stops at _who you are_,
not _what you may touch_.

## Module map

- `server/auth/auth.js` (~568 lines) — the core session library: cookie-based
  sessions, HMAC-signed tokens, password-login verification, dev-bypass, and the
  boot-time config validation. Main exports below.
- `server/auth/sandbox.js` — anonymous throwaway guest sessions for sandbox mode
  (separate `sb_sandbox` cookie, synthetic `@sandbox.local` identities). See
  [`sandbox-mode.md`](sandbox-mode.md).
- `server/auth/providers/oidc.js` — the OIDC protocol wrapper (discovery, PKCE,
  code exchange, ID-token verification, claim→identity mapping), dynamically
  imported so non-SSO installs never load `openid-client`.

Key `auth.js` exports:

- `COOKIE_NAME = 'sb_session'` — the session cookie.
- `authEnabled()` / `authConfigError()` / `authConfigWarnings()` — auth is on
  unless `AUTH_ENABLED=false`; boot **fails** on a missing `AUTH_SECRET` or one
  shorter than `MIN_AUTH_SECRET_LENGTH` (32) unless explicitly waived.
- `getUserFromRequest(req)` — synchronous, signature+expiry only; returns
  `_needsDbValidation: true` and is explicitly **not** for authorization.
- `getUserFromRequestAsync(req, ctx)` — the authoritative resolver: re-reads the
  user, checks the cookie's version claim against `sessionVersion(dbUser)`, and
  resolves the active org membership.
- `setSessionCookie` / `updateSessionOrganization` / `clearSessionCookie` — mint,
  re-mint (organization switch), and clear the cookie.
- `verifyLoginAsync(email, password, ctx)` — password login against a
  database-source user.
- `devAuthBypassEnabled()` / `devBypassUser()` — the dev-only passwordless admin.

## Data model & token shape

There is no server-side session store. A session **is** the signed cookie:

```
token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(AUTH_SECRET, payloadB64))
payload = { email, role, name, exp, v, orgId? }
```

- Signature is verified with `timingSafeEqual`; `exp` is checked on every
  request. Default lifetime is **14 days**.
- `v` is the **session version** (`server/utils/session-version.js`,
  `sessionVersion(dbUser)`) — changing a password or the underlying user row
  bumps it, invalidating every outstanding cookie without server state.
- `orgId` is embedded only when multi-organization mode is enabled; an organization
  switch re-mints the cookie (`updateSessionOrganization`) preserving remaining
  lifetime.
- Cookie attributes: `Path=/; HttpOnly; SameSite=Lax; Max-Age=…`, plus `Domain=`
  from `COOKIE_DOMAIN` and `Secure` when `shouldUseSecureCookies(req)`.

Password hashing and reset tokens live in `server/storage/password-reset.js`
(`verifyPassword`); magic-link tokens in `server/storage/magic-link.js`.

## Flows (routes)

Auth routes are dispatched from `server/routes/api/index.js`.

**Password + session** (`server/routes/api/auth.js`):

- `GET  /api/auth/config` — public login-page/SSO config.
- `POST /api/auth/login` — password login; **throttled** (see below).
- `POST /api/auth/logout` — clear the session cookie.
- `GET  /api/auth/me` — the current user (or the sandbox guest in sandbox mode).
- `POST /api/auth/dev-login` — dev bypass, guarded by `devAuthBypassEnabled()`.

**Magic-link** (`server/routes/api/magic-link.js`): `POST /api/auth/magic-link`
requests a link (token expiry 15 min); `POST /api/auth/magic-link/verify`
consumes it and sets the session. Delivery via `server/integrations/brevo.js`.

**Password reset** (`server/routes/api/password-reset.js`):
`POST /api/auth/forgot-password`, `GET /api/auth/reset-password/validate`,
`POST /api/auth/reset-password` (token expiry 1 h, min password length 8),
`POST /api/auth/change-password`.

**SSO/OIDC** (`server/routes/api/sso.js`): `GET /api/auth/oidc/login` builds the
PKCE authorization URL; `GET /api/auth/oidc/callback` verifies state/nonce,
exchanges the code, JIT-provisions via `server/storage/sso.js`, and mints the
same `sb_session` cookie. Protocol details in [`sso-oidc.md`](sso-oidc.md).

## Rate limiting

`server/utils/rate-limit.js` is a token-bucket limiter (Redis-first with an
in-memory fallback, `rate-limit-redis.js`):

- **Login**: `allowLoginAttempt({ip, email})` with `LOGIN_LIMITS` — IP bucket
  ~6/min, email bucket similar; a `429` (`rateLimited()`) is returned before the
  password is ever checked. (`security-posture.md` attributes this to the auth
  route, but the limiter is defined here and merely _called_ from the route.)
- **Magic-link** and **password-reset** enforce their own DB-count limits in
  their storage modules (magic-link: 5/h per email, 15/h per IP; reset: 3/h per
  email, 10/h per IP).

## Config & flags

Core (`server/auth/auth.js`):

- `AUTH_SECRET` — HMAC key; enables auth; ≥32 chars required.
- `AUTH_ADMIN_EMAIL` — email granted the admin role.
- `AUTH_ENABLED=false` — run intentionally without auth (anonymous admin).
- `AUTH_ALLOW_WEAK_SECRET` — boot with a sub-32-char secret (escape hatch).
- `AUTH_DEV_BYPASS` — dev-only passwordless admin (`NODE_ENV=development` only;
  `server/server.js` warns loudly if set in production).
- `SECURE_COOKIES` / `COOKIE_DOMAIN` — cookie `Secure` flag and domain.

SSO (`server/config/sso.js`): `SSO_ENABLED`, `SSO_PROVIDER` (`oidc` only),
`SSO_ENFORCE`, and the `OIDC_*` set (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_ALLOWED_DOMAINS`,
`OIDC_AUTO_PROVISION`, `OIDC_DEFAULT_ROLE`, `OIDC_ADMIN_GROUPS`).

Email delivery for magic-link/reset (`server/integrations/brevo.js`):
`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`.

Expiries are hard-coded constants, not env vars: 14-day session, 15-min
magic-link, 1-hour reset.

## Authz & tenancy

Identity resolution ends at `getUserFromRequestAsync`, which also resolves the
active org membership (`organizationRole`, `organizationIsDesigner`). Everything
downstream — which organization a request may read or write, the R1–R3 isolation
rules, `MULTI_ORG_ENABLED` — is in
[`tenant-isolation.md`](tenant-isolation.md), not repeated here.

## Implementation status (as of 2026-08-21)

All four identity paths are live: password, magic-link, OIDC SSO, and the
dev-only bypass. Sessions are stateless signed cookies with version-based
invalidation; there is no session table to migrate. The security posture
(fatal-on-misconfig boot, dev-bypass guard, login throttle, CSRF origin check)
is summarized in [`security-posture.md`](security-posture.md). Session and token
lifetimes are constants today; if they ever need per-deployment tuning they
would become env vars — nothing promises the current values are permanent.
