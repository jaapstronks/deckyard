# Running several organizations on one instance

An operator runbook: what to do, in order, to serve more than one organization
from one Deckyard instance, and what the organizations then share. The _why_
behind the isolation (the R1/R2/R3 rules, the supported shapes, what is still
in development) is in [`../reference/tenant-isolation.md`](../reference/tenant-isolation.md);
this page only translates it into settings and steps.

> **Status.** Multi-organization mode (shape 4 in `tenant-isolation.md`) is _in
> development_: isolation is enforced in code, but ownership still keys on email
> addresses. Use it for organizations that trust one operator, not for
> unrelated customers who must never be able to reach each other's data by a
> bug. Single-organization instances need nothing on this page.

## 1. Turn it on

In `.env`:

```sh
MULTI_ORG_ENABLED=true
# Recommended for a pre-provisioned instance: only instance admins create organizations.
MULTI_ORG_USER_CREATE_ENABLED=false
```

Restart the server. `MULTI_ORG_USER_CREATE_ENABLED` defaults to `true`, which
lets every signed-in user create an organization through
`POST /api/organizations` (there is no button for it in the UI). On an instance
where you create each organization yourself, turn it off: anyone who is not an
instance admin then gets a 403.

An **instance admin** is a user with the admin role: `AUTH_ADMIN_EMAIL`, a
member of one of `OIDC_ADMIN_GROUPS`, or someone given the role under
Admin → Users. The instance role does not reach into an organization on its
own; see step 5.

## 2. Name the default organization

Every instance has a default organization (`DEFAULT_ORGANIZATION_ID`, seeded as
`00000000-0000-0000-0000-000000000001`). In multi-organization mode it is the
fallback: a new SSO user without an organization claim (step 6) gets their
account and first membership there, and the first person in it becomes its
owner.

Sign in once, as the operator, before anyone else. You become owner of the
default organization; rename it under the organization profile to something
neutral (the instance name, "Operator"). Keep customers out of it: it is the
organization that cannot be deleted, and whoever lands there by accident sees
everyone else who landed there.

## 3. Create the organizations

```sh
npm run org:create -- --slug acme --name "Acme" [--external-id <idp-org-id>] [--owner owner@acme.example]
```

(`scripts/org-create.js`; reads the same `.env` as the server, so run it on the
host or in the container that runs Deckyard.)

- `--slug`: 2-63 characters, lowercase letters, digits and inner hyphens.
- `--external-id`: the organization's ID in your identity provider, when SSO
  routes logins by organization (step 6). Must be unique on the instance.
- `--owner`: the organization's first member, as owner. A person without an
  account gets one, homed in this organization. **No invitation mail is sent**:
  they sign in with SSO or a magic link, or you resend the invitation from
  Admin → Users.

The command is idempotent on the slug: run it again and it reports
`Already there` and changes nothing. It refuses a rerun that disagrees with
what is stored (another name, another external ID, an owner who is not the
owner, an owner for an organization that already has members); rename and
rebind an existing organization in its profile or with
`PATCH /api/organizations/:id`.

Two organizations with one member each:

```sh
npm run org:create -- --slug acme  --name "Acme"  --owner anna@acme.example
npm run org:create -- --slug beta  --name "Beta"  --owner bram@beta.example
```

## 4. Add members

Everyone after the first comes in by invitation: the organization's Users tab
(settings), or `POST /api/organizations/:id/members`. An owner invites with any
role, an admin only as `member`. An invitation to someone without an account
creates it and mails a setup link (step 7 lists the mail settings it uses); to
someone who already has an account elsewhere on the instance, it adds a
membership to that same account.

| Role     | May                                                                    |
| -------- | ---------------------------------------------------------------------- |
| `member` | Work in the organization; leave it.                                    |
| `admin`  | Also: invite members, edit the profile, change `member` roles.         |
| `owner`  | Also: invite admins and owners, hand the organization over, delete it. |

One person can hold memberships in several organizations; the user menu then
lists them and switches between them (a switch reloads the page in full).

## 5. Themes and organization settings

Each organization has its own theme settings: its default theme and the themes
its members may pick (`organizations.settings.defaultThemeId` /
`enabledThemes`), plus the other organization settings (designer rules,
disabled slide types, RSS metadata). Themes themselves are content and belong
to one organization.

Writing the organization's admin settings takes **both** roles: instance admin,
_and_ admin or owner of that organization. The instance role alone is not
enough; there is no impersonation. To set up a customer's theme, the operator
therefore needs a membership there: either create the organization with
yourself as `--owner` and invite the customer as owner afterwards, or let the
customer's owner invite you as admin. That membership is visible to the
organization's members, which is the point.

### What is shared and what is not

| Instance-global (one value for every organization)                                          | Per organization                                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Everything in `.env`: auth, SSO, mail transport, AI provider, feature flags                 | Presentations, slides, slide library, collections, tags, comments      |
| App settings: supported languages, AI assistant, notifications, webhooks                    | Themes, and the default and enabled themes                             |
| Email templates and their settings: the operator sends the mail                             | Organization settings: designers, disabled slide types, RSS metadata   |
| Instance admins (`AUTH_ADMIN_EMAIL`, `OIDC_ADMIN_GROUPS`, the admin role)                   | Members and their roles                                                |
| Per-person preferences (`user_settings`): one set however many organizations a person joins | API keys; live sessions and analytics, through the deck they belong to |
| Share-link expiry sweep, follow codes (short-lived public tokens)                           |                                                                        |

In `tenant-isolation.md` terms: the left column is R3, the right column R1
(content) and R2 (what hangs off content).

## 6. Sign-in and where people land

- **SSO without an organization claim**: a first login creates the account in
  the default organization (`OIDC_AUTO_PROVISION=true`, the default). Someone
  created with `org:create --owner` or invited already has an account and a
  membership, and lands in that organization.
- **SSO with `OIDC_ORG_CLAIM`**: the named ID-token claim picks the
  organization whose external ID matches, and a first login there gets a
  membership in it. A missing or unknown claim refuses the login; nothing is
  created. Give each organization its external ID with `org:create
--external-id` (or `PATCH /api/organizations/:id` as an instance admin who is
  also admin there).
- **Magic link and password**: only for accounts that already exist. The login
  gives someone without a membership one in their home organization.

Full SSO configuration: [`../reference/sso-oidc.md`](../reference/sso-oidc.md).

## 7. What changes when it is on

- **The RSS/Atom/JSON feed is off** (404, no autodiscovery links): it has no
  organization to serve under one instance-wide URL.
- **"Shared with me" crosses organizations**: it is scoped by person, so a deck
  someone shared with you shows up whichever organization you are in.
- **Mail**: invitations, setup links and notifications use the instance's one
  mail transport and templates, whichever organization sends them.
- **`AUTH_DEV_BYPASS` does not work with it**: the bypass pins the default
  organization, so test organization flows with a real login.

## 8. Check the result

1. `npm run org:create` again with the same arguments prints `Already there`
   for each organization.
2. Each owner signs in and lands in their own organization; the organization
   profile shows its name, the Users tab shows one member.
3. A deck made in `acme` is not visible from `beta`: sign in as the `beta`
   owner and open the home screen and the slide library.
4. As operator, switch into an organization you are a member of (user menu)
   and check its theme in a new deck.
5. `GET /feed/rss.xml` (and `atom.xml`, `feed.json`) answers 404.
