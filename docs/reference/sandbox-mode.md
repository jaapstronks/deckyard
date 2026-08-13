# Sandbox mode

## Purpose & scope

Sandbox mode turns an otherwise-normal Deckyard build into a **public,
anonymous, self-cleaning "try it" playground** — one runtime flag
(`SANDBOX_MODE`), not a separate codebase. A first-time visitor gets an
ephemeral guest identity with no login, can open a seed deck and edit, and
whatever they create is quota-bounded and hard-deleted after a TTL. This is the
surface intended for a public demo deployment.

This document describes what changes when the flag is on, the guest-identity
model, the lifecycle/cleanup of ephemeral data, and the config that tunes it.
Deployment specifics live in [`self-hosting.md`](../ops/self-hosting.md); the
isolation model in [`tenant-isolation.md`](tenant-isolation.md).

## Module map

- `server/config/sandbox.js` — the flag and every tunable (`sandboxEnabled`,
  `sandboxTtlMs`, `sandboxDefaultThemeId`, `sandboxCookieMaxAgeDays`,
  `sandboxWatermarkText`).
- `server/auth/sandbox.js` — the throwaway guest identity (`ensureSandboxUser`,
  `getSandboxUserFromRequest`); cookie `sb_sandbox`, synthetic
  `guest-<uuid>@sandbox.local` emails.
- `server/routes/api/sandbox.js` — the sandbox-only API surface
  (`GET /api/sandbox/examples`; 404 outside sandbox).
- `server/sandbox/examples.js` — loads the seed demo decks (`listSandboxExamples`).
- `server/sandbox/media.js` — curated built-in sample images/logos surfaced in
  the image library because direct uploads are off (`listSandboxMedia`).
- `server/sandbox-examples/*.json` — the seed decks (`meet-deckyard`,
  `acme-quarterly`, `ice-cream-cart`).
- `server/storage/presentations/sandbox.js` — `attachSandboxMeta()` /
  `isSandboxEphemeralPresentation()`; stamps `sandbox.expires` on ephemeral decks.
- `server/storage/presentations/sandbox-quota.js` — per-guest deck/byte quota;
  `SandboxQuotaError` (HTTP 429).
- `server/jobs/sandbox-cleanup.js` — the TTL sweep loop.
- `server/utils/sandbox-watermark.js` — export watermark markup.
- `server/utils/sandbox-seo.js`, `server/utils/sandbox-og-image.js`,
  `server/routes/static/sandbox-og.js` — SEO/OG head tags and the
  `/og/sandbox.png` social preview.
- `server/config/storage-paths.js` — redirects data/uploads dirs to sandbox
  variants when enabled.
- `server/config/feature-flags.js` — forces `disableAi` and `disableUploads` on
  in sandbox.

## What changes when sandbox mode is on

Versus a normal instance:

- **No login.** Every first HTML/API hit auto-provisions an ephemeral guest via
  an unguessable `sb_sandbox` cookie. Isolation between guests is per-cookie.
- **AI off.** `disableAi` is forced true (open-ended LLM cost on a public URL).
- **Direct uploads off.** `disableUploads` is forced true; guests instead pick
  from the curated `listSandboxMedia()` samples.
- **Ephemeral decks.** Decks a guest creates get a TTL (default 24 h) and are
  hard-deleted after it. Curated `organization`-scope seed decks are exempt.
- **Watermarked exports.** Exports carry `SANDBOX_WATERMARK` text.
- **Quotas.** Per-guest deck-count and stored-byte caps, a lower request-body
  cap, secure cookies, and proxy-trust for rate limiting.
- **Publishing off, neutral theme, SEO tuned.** Publish disabled; a neutral
  default theme; the root landing is indexable with the sandbox OG image, while
  internal SPA routes are `noindex`.

## Data model & lifecycle

Sandbox has **no separate database or schema**. It runs on the same Postgres,
single organization (`getDefaultOrganizationId()`); guest decks live in the
shared `presentations` table keyed by the guest's synthetic `owner_email`.
Isolation is per-cookie / per-owner-email within the one org.

- **Ephemeral vs seed** — `server/storage/presentations/sandbox.js`: a deck is
  ephemeral unless its `scope === 'organization'`. `attachSandboxMeta()` stamps
  `pres.sandbox.enabled` and `pres.sandbox.expires = created + TTL`.
- **TTL sweep** — `server/jobs/sandbox-cleanup.js`: `scheduleSandboxCleanup()`
  (started from `server/server.js`) runs every ~10 min, no-op outside sandbox.
  `sweepExpiredSandboxDecks()` bulk-deletes non-`organization` decks older than the
  TTL; FKs cascade (version snapshots, published entry, cold Y.Doc state). It
  also emits a **non-destructive** warning against `SANDBOX_MAX_TOTAL_BYTES` —
  it never evicts live decks.
- **Per-guest quota** — `server/storage/presentations/sandbox-quota.js`:
  `assertSandboxQuotaForCreate()` throws `SandboxQuotaError` (HTTP 429, code
  `sandbox_quota_exceeded`) when a guest exceeds the deck-count or stored-byte
  cap (bytes measured via `pg_column_size`).
- **Seed decks** — the openable examples come from `server/sandbox-examples/*.json`
  via `GET /api/sandbox/examples`; a throwaway Postgres volume needs them loaded
  as a deploy step.

## Guest identity

`server/auth/sandbox.js` provides an **auto-login, throwaway, per-visitor**
identity — not a shared account:

- Cookie `sb_sandbox` = a `crypto.randomUUID()`; email domain `sandbox.local`.
- `getSandboxUserFromRequest(req)` returns a guest object
  `{ email: guest-<token>@sandbox.local, role: 'user', name: 'Guest',
  isAdmin: false, isSandboxGuest: true, sandboxId: token }` when the cookie is
  present and valid.
- `ensureSandboxUser(req, res)` returns the existing guest or mints a new token
  and sets the cookie (`Path=/; SameSite=Lax; Max-Age` from
  `SANDBOX_COOKIE_DAYS`; `Secure` when `shouldUseSecureCookies`).
- Wired in `server/routes/api/index.js` (auto-provision + treat as
  authenticated), `server/routes/api/auth.js` (`/api/auth/me` returns the guest),
  and `server/routes/static/app-shell.js` (assign the cookie on first HTML load).

No password, no session store, no real account. Each browser is its own
isolated guest; clearing the cookie yields a brand-new guest.

## Config & flags

Central config: `server/config/sandbox.js` (all env-driven).

| Env var | Controls | Default |
|---|---|---|
| `SANDBOX_MODE` | Master on/off — turns sandbox on | off |
| `SANDBOX_TTL_HOURS` | Ephemeral-deck lifetime | 24 |
| `SANDBOX_DEFAULT_THEME` | Neutral default theme id | `editorial` (compose sets `deckyard`) |
| `SANDBOX_COOKIE_DAYS` | Guest cookie Max-Age (capped 365) | 30 |
| `SANDBOX_WATERMARK` | Export watermark text | `Sandbox export • Created by an anonymous user` |
| `SANDBOX_DATA_DIR` / `SANDBOX_UPLOADS_DIR` | Data/uploads dir overrides | `server/data-sandbox` / a sibling `uploads-sandbox` (created at runtime) |
| `SANDBOX_MAX_DECKS_PER_GUEST` | Per-guest deck-count cap | 25 |
| `SANDBOX_MAX_BYTES_PER_GUEST` | Per-guest stored-byte cap | 50 MB |
| `SANDBOX_MAX_TOTAL_BYTES` | Global soft ceiling (warn only) | off |

Setting `SANDBOX_MODE` also forces `disableAi` and `disableUploads` on
(`server/config/feature-flags.js`), independent of `DISABLE_AI` / `DISABLE_UPLOADS`.
Not to be confused with `PUPPETEER_SANDBOX` — that is the Chromium OS sandbox for
export rendering, unrelated to this feature.

**Turning it on:** set `SANDBOX_MODE=1`. In practice, deploy with
`docker-compose.sandbox.yml` at the repo root, which sets it plus the
guardrails — bundled `postgres:16`, `SECURE_COOKIES=1`, `TRUST_PROXY=1`,
`MAX_REQUEST_BODY_BYTES`, the quota vars, and a Caddy TLS/reverse-proxy service
(default `DOMAIN=sandbox.deckyard.eu`). The app listens on 4177.

## Authz & tenancy

Guests are non-admin users in the single default organization; there is no
cross-guest access because each guest's decks are keyed by its own synthetic
owner email. The general isolation rules are in
[`tenant-isolation.md`](tenant-isolation.md); the public-instance security
guardrails (secure cookies, CSRF, request-body caps) are summarized in
[`security-posture.md`](security-posture.md).

## Implementation status

Sandbox mode is implemented and shipped: guest identity, ephemeral decks with
TTL sweep, per-guest quotas, watermarked exports, curated media, seed examples,
and the dedicated compose file all exist. The data footprint reuses the normal
Postgres schema — isolation is per-cookie within one org, not a separate tenant
boundary — so the guarantee is "throwaway and quota-bounded", not "hardened
multi-tenant". Whether a given public deployment is exposed is a deployment
decision (the informal "gate" before opening the public sandbox), not a code
switch; nothing in the tree references that gate.
