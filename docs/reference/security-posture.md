# Security posture

The server-side controls that harden a Deckyard instance, why each one exists,
where it lives, and what it deliberately does **not** cover. This is a reference
for what is enforced today — not a task list and not an audit report. Verified
against HEAD on 2026-07-31.

Several of these controls carry a one-line pointer back to the relevant section
here from the source, so a reader auditing the code can find the rationale
without leaving the repo.

## Deployment and threat model

Deckyard's documented deployment model is **self-hosted, single-organization,
behind an authenticating reverse proxy** (see
[`tenant-isolation.md`](tenant-isolation.md)). The controls below assume that
shape. Two consequences worth stating up front:

- In the default single-organization install every user shares one organization,
  so "org-scoped" checks collapse to "any logged-in user". The hardening below is
  about what an _authenticated_ user (or an unauthenticated visitor of a public
  surface) can reach, not about a cross-tenant boundary that a single-org install
  does not have.
- Some controls are conditional on operator configuration (`TRUST_PROXY`, the
  headless-browser sandbox, sandbox/demo mode). Those conditions are called out
  per control.

The controls fall into three groups: what the **headless browser** and
**server-side fetches** can reach (sandbox posture, SSRF guard), what a
**misconfigured or brute-forced auth setup** can do (startup floor, dev-bypass
gating, login throttle), and what **untrusted request or upload content** can do
(inert uploads, body cap, path-traversal containment, CSRF).

## Headless-browser sandbox posture

**Where:** `server/utils/puppeteer-browser.js`.

PDF and image export render slides in headless Chromium. The container image runs
Chromium as a **non-root** user, so a renderer escape no longer means root in the
container. Chromium's own in-browser sandbox stays **off by default**, because its
namespace sandbox needs syscalls (`CLONE_NEWPID`/`CLONE_NEWNET`) that Docker's
default seccomp profile blocks — with the stock profile a sandboxed launch fails
outright and export breaks.

**Deliberately not covered:** defense-in-depth from the in-browser sandbox on a
stock runtime. Operators who harden the runtime (e.g. `--cap-add=SYS_ADMIN` or a
Chromium seccomp profile) can re-enable it by setting `PUPPETEER_SANDBOX=true`.
Export always renders through `setContent` (an `about:blank` document, no file
access), so a `file://` reference in slide content will not load regardless.

## SSRF guard on server-side image fetches

**Where:** `server/utils/ssrf-guard.js`; applied on the export/render path via the
`embedRemote` option of `server/utils/html-utils.js` and from
`server/export/pdf-slides.js`.

A slide can carry a user-controlled image URL. On export/render the server (or
headless Chrome, via inlined images) may fetch that URL, so an unguarded fetch is
a server-side request forgery vector into cloud metadata (169.254.169.254),
loopback, and other internal services. The guard resolves the hostname and
**classifies every returned address**, blocking loopback, private, link-local,
unique-local and other non-public ranges (covering encoded IPv4, IPv6 and
IPv4-mapped forms). Remote `http(s)` images referenced as field values, in
`<img src>`, and in CSS `url()` backgrounds are each inlined through this guard or
stripped, so no user-supplied URL reaches headless Chrome at `setContent` time.
Fetches are also size- and time-capped as a memory-DoS bound.

**Deliberately not covered:** full DNS-rebinding protection. The guard validates
resolved addresses and then fetches by hostname, which re-resolves — an attacker
controlling an authoritative DNS server could in principle return a public address
to the check and a private one to the fetch (a TOCTOU). Closing that fully means
pinning the connection to the validated IP; the guard blocks the straightforward
metadata/internal-host SSRF, which is the documented threat, and the size/time
caps bound the residual. This limitation is recorded in the source.

## Auth misconfiguration is fatal at startup

**Where:** `server/auth/auth.js` (`authConfigError`).

Two auth misconfigurations must stop the process rather than boot an insecure
instance:

- **A missing admin/auth configuration** that would silently open an admin
  surface is only acceptable when the operator explicitly opted out
  (`AUTH_ENABLED=false`) or is running a sandbox/demo instance.
- **A weak `AUTH_SECRET`** (shorter than the minimum length) makes the
  session-signing HMAC brute-forceable, so session tokens could be forged. Boot
  is refused below the floor.

**Deliberately not covered / escape hatches:** an operator who accepts the risk
can set `AUTH_ALLOW_WEAK_SECRET` (an explicit, documented escape hatch that still
warns), and sandbox/demo mode and `AUTH_ENABLED=false` are exempt by design.

## Dev auth bypass is development-only

**Where:** `server/auth/auth.js` (`devAuthBypassEnabled`) and
`server/auth/dev-bypass.js`, with a belt-and-braces check at startup in
`server/server.js`.

`AUTH_DEV_BYPASS` grants a passwordless admin session — a development convenience
only. It is refused unless `NODE_ENV` is explicitly `development`, so a leftover
`AUTH_DEV_BYPASS=1` in a staging/production/unset-`NODE_ENV` environment can never
silently grant anonymous admin.

The bypass session carries a real `users.id`: `dev-bypass.js` resolves
`dev@local.test` once per process and **creates that row on first use**, because
ownership is keyed on the id and on nothing else
(`shared/identity-match.js`). The row is an ordinary admin user with no password
— it is only ever reached through the bypass, which cannot be on outside
development. Nothing is written when the bypass is off.

## Login brute-force throttle

**Where:** `server/routes/api/auth.js` (`allowLoginAttempt`).

The login route throttles per-IP **and** per-email _before_ the expensive
password verification runs, so credentials cannot be hammered and a single
attacker cannot burn CPU by forcing repeated hashes. (When `TRUST_PROXY` is set,
the client IP is read from the trusted-proxy hop rather than a spoofable
client-supplied header.)

## User-uploaded content is served inert

**Where:** `server/utils/http.js` (`serveFile`, the `userUpload` option).

Uploaded files can be of a risky type — an SVG can carry an inline `<script>`.
When a response serves user-uploaded content, risky types are served **inert**: a
CSP sandbox plus `Content-Disposition: attachment`, so a stored script cannot
execute in the app origin if the file is navigated to directly. Upload intake
already whitelists MIME types; this is the serve-side half of the same defense.

## Request-body size cap

**Where:** `server/utils/http.js` (`maxRequestBodyBytes`).

Every request body is bounded so an authenticated client cannot exhaust server
memory with an unbounded upload. The default (25 MB) is generous enough for large
decks with inline data-URL images; operators can override it with
`MAX_REQUEST_BODY_BYTES`.

## Upload path-traversal containment

**Where:** `server/media/local.js` (upload key resolution in `confirmUpload`).

An upload key is resolved and **confined** under the uploads directory before any
filesystem access. A traversal key such as `../auth/auth.js` cannot be used as an
existence/size oracle for arbitrary files on disk — a key that escapes the uploads
directory resolves to "not found" rather than touching the target.

## CSRF: origin/referer check on cookie-authenticated writes

**Where:** `server/utils/csrf.js`, applied in `server/routes/api/index.js`.

The session cookie is `HttpOnly` and `SameSite=Lax`, which already keeps it off
most cross-site requests. As defense-in-depth for the residual gaps — `Lax` still
allows top-level GET navigations and is per-site, not per-origin, so a sibling
subdomain could otherwise forge requests — state-changing requests get an
Origin/Referer allowlist check.

**Scope:** enforced **only** when a browser session cookie is present (the login
cookie `sb_session` or the sandbox-guest cookie `sb_sandbox`) — the exact case a
victim's browser would attach automatically. Requests authenticated another way
(API key on `/api/v1`, MCP bearer token) or not at all (public audience
endpoints) cannot be abused through a victim's browser cookie, so they are exempt
and need no client changes. A "missing Origin" is allowed, which is safe here
because the check only runs when a `SameSite=Lax` cookie is already present.
