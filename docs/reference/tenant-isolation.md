# Tenant isolation

How Deckyard keeps one customer's decks away from another's, and which
deployment shapes are supported today. Verified against HEAD on 2026-07-23.

## The supported model: the tenant boundary is the infrastructure

Deckyard's near-term hosting story has three shapes, in order:

1. **Sandbox / playground** (`SANDBOX_MODE`, e.g. `try.deckyard.eu`) —
   anonymous, throwaway, one shared instance. Isolation model below.
2. **Self-hosted** — one operator runs one instance for their own use.
3. **Dedicated customer instance** — a manually provisioned, per-customer
   deploy with its **own process and its own database**. Requested via the
   contact form or as an upgrade path from sandbox/self-host.

In all three, an instance runs in the default **single-organization** mode
(`MULTI_WORKSPACE_ENABLED` unset). The isolation guarantee for paying
customers is therefore **infrastructural**: each customer gets a separate
deploy and a separate database. It is **not** a code-level partition of one
shared backend.

A fully automated, self-serve, shared multi-tenant SaaS
(`deckyard-cloud`) remains parked future work. It is **not** a prerequisite
for shipping the three shapes above, and no agent should treat the large
org-filtering + identity-decoupling rework as a blocker for them.

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

## Out of scope (parked, not a blocker here)

The full **identity-decoupling epic** (moving ownership/ACLs from email to
`users.id`) and **org-filtering on a *shared* backend** belong to the future
shared-multi-tenant SaaS track, not to the sandbox + dedicated-instance route
this document covers. External email leaks were already closed separately
(PR #214). See `deckyard-planning/briefs/identity-decoupling.md` and
`deckyard-planning/briefs/dreamkit-multitenancy-briefing.md`.
