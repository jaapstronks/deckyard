# SSO via OIDC (self-hosted, single IdP)

Deckyard can delegate login to one OpenID Connect (OIDC) identity provider per
install: Google Organization, Microsoft Entra ID (Azure AD), Okta, Auth0,
Keycloak, and most modern IdPs. This is **Track 1** of the SSO work: one IdP,
configured entirely through environment variables, no multi-tenant machinery.

Password and magic-link login keep working alongside SSO unless you turn on
`SSO_ENFORCE`. **Implementation status (beta):** `SSO_ENFORCE=true` currently
only hides those forms on the login screen — the password, magic-link and
password-reset endpoints still accept requests from users who have them. The
normative target is that `SSO_ENFORCE` refuses them server-side, so that
enforcing SSO also enforces the IdP's MFA and deprovisioning; until that
lands, treat the setting as "SSO-first", not "SSO-only".

> Multi-tenant, per-organization SSO (each org brings its own IdP through an
> admin UI) is a separate, later track and is not planned for this codebase;
> see [`tenant-isolation.md`](tenant-isolation.md) for which isolation shapes
> Deckyard does support.

## How it works

OIDC resolves the same verified email identity as the other login methods.
With an organization claim configured, it also selects the organization for
the session and grants a membership there when provisioning is enabled:

1. `GET /api/auth/oidc/login` builds an OIDC authorization URL (PKCE + `state` +
   `nonce`), stores those in a short-lived signed cookie, and redirects to the
   IdP.
2. The IdP authenticates the user and redirects back to
   `GET /api/auth/oidc/callback`.
3. The callback verifies `state`/`nonce`, exchanges the code, validates the
   ID-token issuer / audience / time claims, and extracts the claims. The ID
   token comes straight from the token endpoint over TLS, so `openid-client`
   does not verify its signature (OIDC Core 3.1.3.7 lets the TLS server check
   stand in for it).
4. The user is provisioned or updated just-in-time (JIT) with
   `auth_source = 'oidc'`, and a normal Deckyard session cookie is minted.
   With `MULTI_ORG_ENABLED=true` a session only resolves through an
   organization membership. Without `OIDC_ORG_CLAIM`, a person who holds none
   is given one in their home organization (`users.organization_id`) when
   `OIDC_AUTO_PROVISION` is on: `owner` when that organization has no members
   yet, so the first login on a fresh instance works without a database edit,
   `member` otherwise. When `OIDC_ORG_CLAIM` is set, its verified ID-token
   value must match a pre-existing `organizations.external_id`. The user gets a
   membership there, and the session opens in that organization even if the
   user belongs to other organizations. The new membership is `admin` for an
   admin identity or `OIDC_DEFAULT_ROLE=admin`, otherwise `member`; an existing
   membership keeps its role. No organization is created at login. A missing
   claim or unknown external ID refuses login before creating a user, with a
   message on the login page. With auto-provisioning off, a known person
   without any membership (or, with a claim, without one in the claimed
   organization) is refused (`?error=sso_no_membership`) rather than
   re-admitted: an invitation always carries a membership, so a row without one
   is someone whose access was removed. Every refusal happens before the user
   row is touched: no name refresh, no admin grant, no session.
5. The browser is redirected to the app (or the original `returnTo` path).

## Configuration

Set these in `.env` (see `.env.example` for the annotated block):

| Variable               | Required | Meaning                                                                                                                                                                                                                                                                         |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SSO_ENABLED`          | yes      | `true` to turn SSO on.                                                                                                                                                                                                                                                          |
| `SSO_PROVIDER`         | yes      | `oidc` (only value supported today).                                                                                                                                                                                                                                            |
| `OIDC_ISSUER_URL`      | yes      | Issuer base URL; discovery uses `/.well-known/openid-configuration`.                                                                                                                                                                                                            |
| `OIDC_CLIENT_ID`       | yes      | Client ID from the IdP app registration.                                                                                                                                                                                                                                        |
| `OIDC_CLIENT_SECRET`   | yes      | Client secret (keep out of version control).                                                                                                                                                                                                                                    |
| `OIDC_REDIRECT_URI`    | yes      | `<APP_URL>/api/auth/oidc/callback`, and registered at the IdP exactly so. Boot warns, with the expected URI in the message, when the path or the origin differs.                                                                                                                |
| `OIDC_ALLOWED_DOMAINS` | no       | Comma-separated email domains allowed to log in (hosted-domain guard).                                                                                                                                                                                                          |
| `OIDC_AUTO_PROVISION`  | no       | JIT-create unknown users on first login. Default `true`. Set `false` to require users be invited first.                                                                                                                                                                         |
| `OIDC_DEFAULT_ROLE`    | no       | Role for newly provisioned users: `user` (default) or `admin`.                                                                                                                                                                                                                  |
| `OIDC_ADMIN_GROUPS`    | no       | Comma-separated IdP group/role claim values that map to the Deckyard `admin` role.                                                                                                                                                                                              |
| `OIDC_GROUPS_CLAIM`    | no       | Comma-separated claims the group/role values are read from; each a claim name or a dot path (`realm_access.roles`). Default `groups,roles`. See [Role mapping](#role-mapping).                                                                                                  |
| `OIDC_ORG_CLAIM`       | no       | Exact ID-token claim name whose string value matches `organizations.external_id`. Set that value on an existing organization through `PATCH /api/organizations/:id` as an instance admin who also administers that organization (D243). Missing or unknown values refuse login. |
| `SSO_ENFORCE`          | no       | `true` hides the password + magic-link forms on the login screen. Default `false`. Does **not** yet refuse those endpoints — see the status note above.                                                                                                                         |
| `SSO_BUTTON_LABEL`     | no       | The words on the SSO button, e.g. `Sign in with Acme ID`. The invite report that tells an inviter how a new member gets in names the same words. Default: the translated "Sign in with SSO".                                                                                    |

The sign-in card can carry the instance logo too: that is `APP_LOGO_URL`,
the same logo the overview topbar shows (see `.env.example`, Branding).

The server **refuses to boot** when `SSO_ENABLED=true` but a required OIDC
setting is missing, an URL is malformed, or an `OIDC_GROUPS_CLAIM` entry has an
empty path segment — a half-configured SSO fails loudly rather than at first
login.

It **warns at boot** when `OIDC_REDIRECT_URI` is not the callback this
instance serves: a path other than `/api/auth/oidc/callback`, or an origin
other than that of `APP_URL` (`DOMAIN`). The warning names the URI to set and
register. It is a warning, not a refusal, because a reverse proxy may rewrite
the callback; if yours does not, the warning is the bug. The check is
`checkOidcRedirectUri()` in `server/config/sso.js`.

## Your first login

On an instance that signs in through SSO only, the first administrator comes
from the IdP too:

1. Set `AUTH_ADMIN_EMAIL` to the address your IdP account carries, and leave
   `OIDC_AUTO_PROVISION` at its default (`true`).
2. Register `<APP_URL>/api/auth/oidc/callback` as the redirect URI at the IdP
   and set the same value in `OIDC_REDIRECT_URI`. Start the server and read the
   boot output: no `CONFIG` warning about the redirect URI means the two agree.
3. With `OIDC_ORG_CLAIM` set, create the organization before anyone logs in,
   carrying the IdP's organization ID:
   `npm run org:create -- --slug acme --name "Acme" --external-id <idp-org-id>`
   (see [`../ops/multi-organization.md`](../ops/multi-organization.md)). Without
   an organization claim, skip this step.
4. Open `/login` and choose the SSO button. The callback creates your user
   just in time; because the address matches `AUTH_ADMIN_EMAIL`, it gets the
   instance `admin` role. Under `MULTI_ORG_ENABLED=true` you also get a
   membership: `owner` of your still-empty home organization without an
   organization claim, `admin` in the claimed organization with one.
5. From here, grant admin through the IdP (`OIDC_ADMIN_GROUPS`) or the
   admin-users UI, and set `OIDC_AUTO_PROVISION=false` if people should only get
   in by invitation.

A refused login returns to `/login?error=sso_<reason>`. The reason names the
gate: `email_unverified` (the IdP does not assert `email_verified`),
`domain_not_allowed` (`OIDC_ALLOWED_DOMAINS`), `org_claim_missing` or
`org_not_found` (`OIDC_ORG_CLAIM`, step 3), `not_provisioned` or
`no_membership` (auto-provisioning is off), `state` (the ten-minute login
cookie expired or was blocked) and `token_exchange_failed` (client secret,
redirect URI or clock; the server log has the IdP's answer).

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

- If `OIDC_ADMIN_GROUPS` is set and the user's group/role values contain a
  listed value, they get the `admin` role. Matching ignores case.
- The values are read from the claims in `OIDC_GROUPS_CLAIM` (default
  `groups,roles`), and only from those. An entry is a claim name or a dot path
  into a nested claim; a claim whose full name is the entry wins, so a
  namespaced claim such as `https://deck.example.com/roles` works as is. A value
  may be an array of strings, a space- or comma-separated string, or an object
  whose keys are the role names (ZITADEL's shape).
- The existing `AUTH_ADMIN_EMAIL` match still grants admin as a fallback.
- An SSO login can **grant** admin but never auto-**demotes** — a transient
  missing group claim must not lock out every admin. Remove admin through the
  admin-users UI.
- Instance `users.role` and organization membership roles are separate. A
  claim-directed login opens the matched organization; it does not change
  existing organization roles or grant ownership.

## Provider notes

- **Google Organization** — `OIDC_ISSUER_URL=https://accounts.google.com`. Use
  `OIDC_ALLOWED_DOMAINS` to restrict to your organization domain.
- **Microsoft Entra ID** — issuer
  `https://login.microsoftonline.com/<tenant-id>/v2.0`. App roles arrive in
  `roles` and security groups in `groups` (as object IDs, unless the app
  registration emits names); both are in the default `OIDC_GROUPS_CLAIM`.
- **Okta** — issuer `https://<org>.okta.com` (or a custom auth-server issuer).
- **Auth0** — issuer `https://<tenant>.<region>.auth0.com/`.
- **Keycloak** — issuer `https://<host>/realms/<realm>`. Realm roles sit in
  `realm_access.roles` and client roles in
  `resource_access.<client-id>.roles`; set `OIDC_GROUPS_CLAIM` to the one you
  map, e.g. `OIDC_GROUPS_CLAIM=realm_access.roles`. A `groups` claim needs a
  group-membership mapper on the client.
- **ZITADEL** — issuer `https://<instance>` (the instance domain, e.g.
  `https://acme.zitadel.cloud`, no path). Project roles arrive in
  `urn:zitadel:iam:org:project:roles` as an object keyed by role name, and only
  in the ID token when the project asserts roles on authentication and the
  application has _User roles inside ID Token_ on:
  `OIDC_GROUPS_CLAIM=urn:zitadel:iam:org:project:roles`. The user's
  organization is `urn:zitadel:iam:user:resourceowner:id`, the value to put in
  `OIDC_ORG_CLAIM` and in the organization's `--external-id`. ZITADEL adds that
  claim only when the reserved scope `urn:zitadel:iam:user:resourceowner` is
  requested, and Deckyard requests `openid email profile` and nothing else yet,
  so a ZITADEL login with `OIDC_ORG_CLAIM` set is refused with
  `org_claim_missing` until Deckyard can request extra scopes (planned; until
  then, a ZITADEL action that sets the claim is the workaround).

## Not included (Track 1)

- SAML (planned as Track 1b, added on concrete demand).
- SCIM / directory sync — JIT provisioning on login is the model; deprovisioning
  is done in the admin-users UI.
- Per-organization / multi-tenant SSO — Track 2, gated behind the cloud go/no-go.
