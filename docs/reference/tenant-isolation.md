# Tenant isolation

How Deckyard keeps one customer's decks away from another's, and which
deployment shapes are supported. Verified against HEAD on 2026-07-23; hosting
shapes and roadmap updated 2026-07-25.

## The supported model: the tenant boundary is the infrastructure

Deckyard's hosting story has four shapes:

1. **Sandbox / playground** (`SANDBOX_MODE`, e.g. `try.deckyard.eu`) —
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
  in multi-workspace mode the org is resolved per request from the
  subdomain / custom domain (`server/utils/context.js`). A cross-org read
  returns nothing.
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

## Sandbox isolation (`try.deckyard.eu`)

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

Two pieces are being built so one managed instance can serve several
organizations:

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
- **The request-to-organization binding.** The session already carries the active
  organization and the switch endpoint already verifies membership, but
  `createRouteContext` discards it, so every request currently runs against the
  default organization.

Neither affects shapes 1-3, and neither is a prerequisite for them: a dedicated
instance stays safe because its tenant boundary is the deploy itself. External
email leaks were closed separately (PR #214).
