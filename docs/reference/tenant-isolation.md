# Tenant isolation

How Deckyard keeps one customer's decks away from another's, and which
deployment shapes are supported. Verified against HEAD on 2026-07-23; hosting
shapes and roadmap updated 2026-07-25; the request-to-organization binding
updated 2026-07-25.

## The supported model: the tenant boundary is the infrastructure

Deckyard's hosting story has four shapes:

1. **Sandbox / playground** (`SANDBOX_MODE`, e.g. `sandbox.deckyard.eu`) —
   anonymous, throwaway, one shared instance. Isolation model below.
2. **Self-hosted** — one operator runs one instance for their own use.
3. **Dedicated customer instance** — a manually provisioned, per-customer
   deploy with its **own process and its own database**. Requested via the
   contact form or as an upgrade path from sandbox/self-host. Available as
   managed hosting: you run it, or we run it for you.
4. **Multiple organizations on one instance** (`MULTI_WORKSPACE_ENABLED`) —
   **in development**, see below. Isolation is enforced in code (every query is
   scoped by `organization_id`) rather than by infrastructure, which is why it
   is gated on the Postgres backend and refuses to boot on the file backend.

Shapes 1-3 run in the default **single-organization** mode
(`MULTI_WORKSPACE_ENABLED` unset). Their isolation guarantee is
**infrastructural**: each customer gets a separate deploy and a separate
database, not a code-level partition of one shared backend. That remains the
strongest isolation Deckyard offers, and it is the default recommendation.

### There is no shared multi-tenant SaaS, and none is planned

A fully automated, self-serve, **shared multi-tenant SaaS with billing** is
**not** on the roadmap — this is a decision (2026-07-25), not a deferral. There
are no subscriptions, no payment integration and no self-serve signup in this
codebase, and none are planned; that layer lives outside Deckyard. Do not
reintroduce it, and do not treat its absence as an unfinished gap.

Shape 4 is easy to confuse with that, so to be explicit: **multi-organization
support is a structuring feature, not a commercial one.** It exists so one
managed instance can serve several distinct organizations that each need their
own themes, members and decks. It carries no notion of plans, seats or payment.

### Why single-org is safe today

In single-org mode there is exactly one organization per instance
(`getDefaultOrganizationId()`, `00000000-0000-0000-0000-000000000001`). Every
authenticated user belongs to that one org, so there is no second tenant for a
deck to leak to. The known cross-org gaps (a workspace-scoped read that does
not check org, a flat file directory with no org dimension) only bite when a
single backend serves **more than one** organization — which single-org mode,
by definition, never does.

Concretely, on a dedicated instance:

- All decks live under one org. `canReadPresentation` granting every
  authenticated user read access to `scope: 'workspace'` decks
  (`server/utils/presentation-authz/presentations.js`) is intended workspace
  sharing, not a leak — the workspace *is* the single tenant.
- Private decks stay owner-scoped (email-keyed ownership check in the same
  file), so users on the instance still can't read each other's private decks.

## The footgun, and the boot guard that closes it

The one way to accidentally leak across tenants on the current code is to put
**two customers on one shared backend** by turning on multi-workspace without a
storage layer that enforces org isolation:

- **Postgres backend** *does* enforce it. Every presentation query is scoped by
  `organization_id` (`server/storage/adapters/postgres/presentations.js`), and
  in multi-workspace mode the org is resolved per request from the session,
  verified against membership (`server/utils/context.js`, see below). A
  cross-org read returns nothing. The session is the *only* resolution path:
  the hostname says nothing about which organization a request acts in (see
  "Why not the hostname" below).
- **File backend** (the OSS default, `STORAGE_MODE` unset) does **not**. Decks
  live flat in one directory (`server/storage/presentations/paths.js`) and
  `listPresentations()` never consults the org
  (`server/storage/presentations/list.js`). Two tenants sharing one file
  backend with `MULTI_WORKSPACE_ENABLED=true` would see each other's workspace
  decks.

To make that impossible by accident, the server **fails closed at boot**:
`multiWorkspaceStorageError()` (`server/config/features.js`) returns a fatal
error, and `server/server.js` calls `process.exit(1)`, when
`MULTI_WORKSPACE_ENABLED=true` while the storage backend cannot enforce org
isolation (i.e. the file backend). The fix is either `STORAGE_MODE=postgres`
or — the supported path — one dedicated instance per customer with
multi-workspace unset. Guard behavior is pinned by
`tests/multi-workspace-storage-guard.test.js`.

Sandbox mode is exempt from the guard: it is single-org by construction (see
below), so there is no second tenant even if the flag is combined with it.

## Sandbox isolation (`sandbox.deckyard.eu`)

Sandbox mode is safe to expose publicly. Its isolation rests on four things:

- **Separate storage roots.** Data and uploads live under `SANDBOX_DATA_DIR` /
  `SANDBOX_UPLOADS_DIR` when set (`server/config/storage-paths.js`), keeping
  sandbox content off any real install's disk.
- **Per-guest unguessable identity.** Each visitor gets a random UUID in the
  `sb_sandbox` cookie, mapped to a synthetic email
  `guest-<uuid>@sandbox.local` (`server/auth/sandbox.js`). A guest's private
  decks are owned by that email, and the private-scope authz check is
  email-keyed, so one guest cannot read another's private decks without knowing
  their random UUID.
- **Workspace decks are intentionally shared, read-only seed content.** In
  sandbox mode `canWritePresentation` returns `false` for workspace scope and
  `canChangePresentationScope` blocks guest-to-guest sharing
  (`server/utils/presentation-authz/presentations.js`), so the shared surface
  is the curated demo decks only, and guests cannot mutate them or promote
  their own decks into the shared space.
- **TTL cleanup.** Non-workspace (guest) decks are ephemeral and expire after
  `SANDBOX_TTL_HOURS` (`server/storage/presentations/sandbox.js`), so a guest's
  content does not accumulate or persist indefinitely.

No persistent cross-session leak was found: private decks are isolated by an
unguessable per-guest identity, and the only shared decks are the
read-only curated seed set.

## In development: shape 4 (multiple organizations on one instance)

*(This section replaced an "out of scope, parked" note on 2026-07-25. That note
said the identity and org-filtering work belonged to a future SaaS track. That is
no longer true: the work is active, and it is not for a SaaS.)*

Two pieces had to be built before one managed instance could serve several
organizations. Both are in place; what is still missing is listed under
*What is not done yet* below.

- **Organisation-independent identity — done.** Authentication resolves a person
  by their globally unique `users.email`, with no organization filter, through
  `getUserByEmailGlobal()` in `server/storage/identity.js`. Which workspace a
  session may act in is a separate question, answered by
  `resolveActiveOrganization()`: configuration only in single-organization mode
  (no database access), and membership-verified against `user_organizations` in
  multi-workspace mode. A session whose organization membership was revoked
  falls back to the person's oldest remaining membership; someone with no
  membership at all is refused. `users.organization_id` survives as the *home*
  organization — where a person lands without a session workspace, and where
  newly created rows go — not as the authority on where they may work.

  Lookups that ask "who is this?" are organization-independent; lookups that ask
  "who is in this organization?" (`server/storage/users.js`, the member lists,
  `created_by` resolution) keep their organization filter.
- **The request-to-organization binding — done.** `createRouteContext()`
  (`server/utils/context.js`) puts the session's resolved organization on the
  context, and every storage query that is given that context scopes on it via
  `getOrgId(ctx)`. So a request acts in the workspace the person switched to:
  their own decks are visible, another organization's are not, and new decks
  are created where they are working. The exception is the presentations
  facade, which builds its own context and is listed under *What is not done
  yet*.

  What may reach a query is only ever a membership-verified organization. The
  value comes from `getUserFromRequestAsync`, i.e. from
  `resolveActiveOrganization()`, not from the raw `orgId` claim in the cookie.
  The synchronous `getUserFromRequest` skips that verification by design and
  flags itself `_needsDbValidation`; such a user's organization is ignored when
  the context is built. Precedence is: explicit `options.organizationId` (used
  by the few callers that name an organization themselves) → the session's
  resolved organization → the default organization (for contexts built before
  or without authentication, such as password reset, magic link and SSO).

  Single-organization installations are unaffected in behaviour and in cost:
  there `resolveActiveOrganization()` answers from configuration without
  touching the database, so the session's organization *is* the default one.
  Pinned by `tests/request-organization-binding.test.js` (single-organization,
  including query-log assertions that no extra lookup is issued) and
  `tests/request-organization-binding-multi-org.test.js` (two organizations on
  one instance, walking session cookie → context → Postgres adapter).

- **The organization-aware authorization layer — done.**
  `server/utils/presentation-authz/presentations.js` used to return `true` for
  `scope: 'workspace'` unconditionally, so as far as authorization was
  concerned every authenticated person was a member of every workspace. The
  four workspace grants (read, write, comment, effective permission) now pass
  through `isSameOrganization(user, pres)`: the session's membership-verified
  organization compared against the organization on the presentation, which
  `mapPresentationRow` carries off the row being read anyway.

  This is defense in depth, not a leak that was open: it narrows only the grant
  that rested on "we are in the same workspace". Grants that rest on a relation
  to the deck itself — ownership, authorship, a collaborator row — fall through
  untouched, and the unrestricted operator of an auth-disabled install is
  unaffected. In multi-workspace mode an organization that cannot be read on
  either side is refused rather than waved through.

  Single-organization installations are unaffected in behaviour and in cost:
  there is one organization, so `isSameOrganization()` answers `true` from the
  feature flag without reading anything, and the organization arrives on a row
  the query already fetched. Pinned by `tests/authz-organization-scope.test.js`
  (single-organization, including query-log assertions) and
  `tests/authz-organization-scope-multi-org.test.js` (two organizations; six of
  its assertions fail without the check).

  Machine-client surfaces (public API, MCP) know their actor by email only and
  take the organization from the presentation, so they keep the behaviour they
  had — see the open item on API keys below.

#### Why not the hostname

Resolving the organization from the request hostname was half-built and is now
**removed rather than finished** (subdomain extraction, the lookups by subdomain
and custom domain, a second context builder, and the `subdomain` /
`custom_domain` columns on `organizations`).

The reason is a modelling one. A hostname identifies an **instance**; an
organization is a dimension **within** an instance. Shapes 1-3 give a customer
their own hostname by giving them their own deploy — DNS, a reverse proxy and
`BASE_URL`, none of which the application needs to know about. Shape 4 puts
several organizations behind one hostname, where a host header cannot
distinguish them at all. So the hostname is either redundant or insufficient,
and using it as a claim about ownership would conflate two things that are free
to differ.

Sessions carry the answer instead, re-verified against membership on every
request. `organizations.slug` remains the stable human-readable identifier.
Pinned by `tests/organization-host-independence.test.js`, which also fails if a
write path for the removed columns comes back.

None of these affects shapes 1-3, and none is a prerequisite for them: a
dedicated instance stays safe because its tenant boundary is the deploy itself.
External email leaks were closed separately (PR #214).

### What is not done yet

- **The presentations facade still reads the default organization.**
  `getPresentation(repoRoot, id)` in `server/storage/presentations.js` builds
  its own context (`getStorageContext()`, which hardcodes
  `getDefaultOrganizationId()`) instead of taking the request's. Every route
  that loads a deck before authorizing it goes through this function, so in
  multi-workspace mode those reads land in the default organization rather than
  the one the session is acting in. The binding above is correct for every
  storage call that is *given* a context; this facade is the path that never
  asks for one. Closing it means threading a context through the facade's
  callers, which is a piece of work in its own right.
- **The public API resolves keys against the default organization.**
  `server/routes/public-api/v1/resources.js` builds its context from the API
  key's owner email only, so an `api_keys` row belonging to another
  organization still reads the default one. This is a separate context source
  from the session path fixed here.
- **There is no organization UI.** The switch endpoint exists, but no
  organization switcher, no member management screen and no per-organization
  invite flow.

Until those are closed, shape 4 stays *in development*: usable to build
against, not something to point two unrelated customers at.
