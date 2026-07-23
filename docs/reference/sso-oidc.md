# SSO via OIDC (self-hosted, single IdP)

Deckyard can delegate login to one OpenID Connect (OIDC) identity provider per
install: Google Workspace, Microsoft Entra ID (Azure AD), Okta, Auth0,
Keycloak, and most modern IdPs. This is **Track 1** of the SSO work: one IdP,
configured entirely through environment variables, no multi-tenant machinery.

Password and magic-link login keep working alongside SSO unless you turn on
`SSO_ENFORCE`.

> Multi-tenant, per-organization SSO (each org brings its own IdP through an
> admin UI) is a separate, later track gated behind the cloud go/no-go. See
> `docs/plans/briefs/sso-integration.md`.

## How it works

Authentication is the only thing that changes; **authorization is unchanged**.
Every route resolves identity to `{ email, role, isAdmin, ... }` and keys all
access control on the (verified) email address. An OIDC login simply produces
that same object:

1. `GET /api/auth/oidc/login` builds an OIDC authorization URL (PKCE + `state` +
   `nonce`), stores those in a short-lived signed cookie, and redirects to the
   IdP.
2. The IdP authenticates the user and redirects back to
   `GET /api/auth/oidc/callback`.
3. The callback verifies `state`/`nonce`, exchanges the code, validates the
   ID-token signature / issuer / audience, and extracts the claims.
4. The user is provisioned or updated just-in-time (JIT) with
   `auth_source = 'oidc'`, and a normal Deckyard session cookie is minted.
5. The browser is redirected to the app (or the original `returnTo` path).

## Configuration

Set these in `.env` (see `.env.example` for the annotated block):

| Variable | Required | Meaning |
|----------|----------|---------|
| `SSO_ENABLED` | yes | `true` to turn SSO on. |
| `SSO_PROVIDER` | yes | `oidc` (only value supported today). |
| `OIDC_ISSUER_URL` | yes | Issuer base URL; discovery uses `/.well-known/openid-configuration`. |
| `OIDC_CLIENT_ID` | yes | Client ID from the IdP app registration. |
| `OIDC_CLIENT_SECRET` | yes | Client secret (keep out of version control). |
| `OIDC_REDIRECT_URI` | yes | Must exactly match the redirect URI registered at the IdP, e.g. `https://deck.example.com/api/auth/oidc/callback`. |
| `OIDC_ALLOWED_DOMAINS` | no | Comma-separated email domains allowed to log in (hosted-domain guard). |
| `OIDC_AUTO_PROVISION` | no | JIT-create unknown users on first login. Default `true`. Set `false` to require users be invited first. |
| `OIDC_DEFAULT_ROLE` | no | Role for newly provisioned users: `user` (default) or `admin`. |
| `OIDC_ADMIN_GROUPS` | no | Comma-separated IdP group/role claim values that map to the Deckyard `admin` role. |
| `SSO_ENFORCE` | no | `true` hides password + magic-link login (SSO only). Default `false`. |

The server **refuses to boot** when `SSO_ENABLED=true` but a required OIDC
setting is missing or an URL is malformed — a half-configured SSO fails loudly
rather than at first login.

## Security model

- **PKCE** (S256) on every authorization request.
- **`state` + `nonce`** are generated per request and bound to the browser via a
  signed, HttpOnly, 10-minute cookie (`sb_oidc`) checked at the callback. This
  is the CSRF defense for the OAuth flow.
- **ID-token validation** (signature, `iss`, `aud`, expiry with 60s clock
  tolerance) is handled by the `openid-client` library.
- **`email_verified` is enforced.** Because email is the ACL key, an unverified
  email is rejected — otherwise anyone able to set an arbitrary email at the IdP
  could impersonate a Deckyard account.
- **Secrets stay in env**, never committed. Cookie flags reuse
  `shouldUseSecureCookies` (Secure over HTTPS / when `SECURE_COOKIES=true`).

## Role mapping

- If `OIDC_ADMIN_GROUPS` is set and the user's `groups`/`roles` claim contains a
  listed value, they get the `admin` role.
- The existing `AUTH_ADMIN_EMAIL` match still grants admin as a fallback.
- An SSO login can **grant** admin but never auto-**demotes** — a transient
  missing group claim must not lock out every admin. Remove admin through the
  admin-users UI.

## Provider notes

- **Google Workspace** — `OIDC_ISSUER_URL=https://accounts.google.com`. Use
  `OIDC_ALLOWED_DOMAINS` to restrict to your workspace domain.
- **Microsoft Entra ID** — issuer
  `https://login.microsoftonline.com/<tenant-id>/v2.0`.
- **Okta** — issuer `https://<org>.okta.com` (or a custom auth-server issuer).
- **Auth0** — issuer `https://<tenant>.<region>.auth0.com/`.
- **Keycloak** — issuer `https://<host>/realms/<realm>`.

## Not included (Track 1)

- SAML (planned as Track 1b, added on concrete demand).
- SCIM / directory sync — JIT provisioning on login is the model; deprovisioning
  is done in the admin-users UI.
- Per-organization / multi-tenant SSO — Track 2, gated behind the cloud go/no-go.
