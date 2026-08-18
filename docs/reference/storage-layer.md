# Storage layer

## Purpose & scope

The storage layer is everything under `server/storage/` — the seam between
route/business code and the database. It owns two jobs: **tenancy** (no query
runs without an explicit organization scope) and the **query contract** (one
Postgres-only backend reached by every facade through direct Kysely on
`getDb()` — there is no adapter class; B79/D34 stripped it). Route handlers
never touch SQL directly; they call a per-domain facade
(`server/storage/presentations/`, `server/storage/themes.js`, …) with a *scope*
as the first argument, and the facade runs its own Kysely queries.

This document maps the layer: the module inventory, the query seam, the
config (there is only one backend choice), how a facade signals failure, and
how the scope threads org-isolation through every call. It does not re-document the deck data format
([`deck-format.md`](deck-format.md)) or the isolation rules
([`tenant-isolation.md`](tenant-isolation.md)); it points at them.

## Module map

`server/storage/` holds **80 `.js` files** — 31 top-level facades/helpers and
the rest under 13 subdirectories. Rather than list all 80, this is the shape;
each path resolves.

**The seam (read these first):**

- `server/storage/scope.js` — defines and validates storage *scopes*, and
  reduces a caller scope to a `StorageContext` via `toStorageContext()`; the
  tenancy gate (see *Authz & tenancy*). Every facade calls this once, then
  passes the context down to its queries.
- `server/storage/lifecycle.js` — the storage lifecycle
  (`initializeStorage` / `closeStorage`), thin wrappers over `db/client.js`'s
  idempotent `initializeDatabase()` / `closeDatabase()`.
- `server/db/client.js` — the single Kysely handle. Every facade reaches
  PostgreSQL through `getDb()` directly (there is no adapter class; B79/D34
  stripped it), which throws before init so a premature query fails loud.
- `server/storage/boot-check.js` — refuses to start on an empty DB while legacy
  on-disk data still exists.

**Domain subdirectories** (each takes a scope as first arg):

- `server/storage/presentations/` — the deck facade + `crud/`, `slides.js`,
  `ownership.js`, `i18n.js`, `slide-notes.js`, `sandbox.js`, `sandbox-quota.js`.
- `server/storage/published/` — published-deck facade; `getPublishedById` is the
  one deliberately cross-org read.
- `server/storage/share-links/` — token share links (`crud.js`, `guests.js`,
  `access-log.js`).
- `server/storage/live-sessions/` — live present/follow sessions (`sessions.js`,
  `sse.js`, `control.js`, `state.js`, `close.js`, `db.js`). See
  [`live-sessions.md`](live-sessions.md).
- `server/storage/slide-library/`, `server/storage/slide-library-usage/`,
  `server/storage/collections/` — the reusable-slide shelf and its usage/id sets.
- `server/storage/image-library/` — per-org images + per-user favorites.
- `server/storage/tags/` — per-organization tags.
- `server/storage/user-organizations/` — memberships/roles (`memberships.js`) and
  organization CRUD (`organizations.js`).
- `server/storage/analytics/` — dashboard/aggregation/report/view-session
  storage (incl. the GDPR view-session path).
- `server/storage/cache/` — `permission-cache.js`.
- `server/storage/utils/` — `db-guard.js` (`withDbGuard`), `helpers.js`.
- `server/storage/identity-resolver.js` /
  `server/storage/identity-verification.js` — map an external identifier to a
  stable `users.id`, and check that every dual key still agrees (see
  *Identity dual keys* below).

**Top-level facades** cover the remaining domains: auth/account
(`users.js`, `sso.js`, `magic-link.js`, `password-reset.js`, `api-keys.js`,
`api-usage.js`, `access-attempts.js`), presentation-adjacent
(`presentation-comments.js`, `presentation-locks-db.js`,
`presentation-subscriptions.js`, `presentation-ydocs.js`, `slide-locks.js`),
collaboration/live (`collaborators.js`, `notifications.js`,
`activity-events.js`, `feedback.js`, `leads.js`, `questions.js`,
`interactions.js`, `follow-codes.js`), and content
(`themes.js`, `font-families.js`, `custom-slide-types.js`, `settings.js`,
`email-templates.js`, `uploads.js`). Each facade maps its own snake_case rows
into camelCase API objects inline (there is no shared `mappers.js` module).

## Data model

Schema lives in `server/db/migrations/` (**68 numbered migrations**,
`001_initial_schema.js` … `068_strip_identity_from_snapshots.js`).
`001_initial_schema.js` creates the core: `organizations`, `users`,
`presentations` (the deck table), `presentation_versions`,
`published_presentations`, plus `follow_codes`, `present_sessions`,
`interactions`, `interaction_votes`, `feedback`. Later migrations add domain
tables — share links, collaborators, tags, themes, `custom_slide_types`,
`user_organizations`, `slide_collections`, analytics `view_sessions`, and the
2026-08 org-threading migrations (`062`–`065`) that carry `organization_id`
onto collaborators/owners. Roughly 45 distinct tables in total; each domain's
columns live with its facade and migration, not duplicated here.

### Identity dual keys

Ownership and ACLs used to key on an **e-mail string**. Migrations `062`
(collaborators), `063` (presentation owner/creator/editor) and `067`
(`user_settings`) put a nullable `users.id` column beside each of those e-mail
columns and backfilled it. Five pairs exist today:

| Table                        | id column             | e-mail column |
| ---------------------------- | --------------------- | ------------- |
| `presentations`              | `owner_user_id`       | `owner_email` |
| `presentations`              | `created_by_user_id`  | `created_by`  |
| `presentations`              | `updated_by_user_id`  | `updated_by`  |
| `presentation_collaborators` | `user_id`             | `user_email`  |
| `user_settings`              | `user_id`             | `email`       |

The **id leads and the e-mail is the fallback**, under one invariant: *id
present ⇒ the e-mail column equals that user's current address*. Facades that
write by id re-stamp the e-mail so the two never drift. A NULL id is a defined
state, not a defect — external collaborators, the shared `anonymous` settings
bucket and rows imported off disk stay NULL forever.

`verifyIdentityConsistency()` (`server/storage/identity-verification.js`) is the
per-row check of that invariant; it sorts every row into **linked**,
**external**, **unlinked** (id NULL while a `users` row exists — repairable by
re-running the migrations) or **mismatched** (id and e-mail name two different
people — the only hard defect). It is read-only, so re-running it is a no-op.
Two entry points, one implementation:

```sh
node scripts/verify-identity-migration.js           # after deploying 062/063/067
node scripts/verify-identity-migration.js --strict  # also fail on repairable rows
```

and `tests/pg/identity-verification.pgtest.js` in CI.

Identity deliberately does **not** live in `presentation_versions.
presentation_data`: `stripIdentityForSnapshot()` keeps it out of new snapshots
and migration `068` erased it from the old ones, so a deck's history cannot
stamp a person's address into every row or name a previous owner after a
transfer. `presentation_versions.created_by` is still a bare e-mail column —
that one has no id beside it yet.

## Flows

- **A scoped read/write.** Route handler builds a scope (org + actor) →
  facade validates it through `toStorageContext` (`scope.js`, wrapping
  `resolveScope`), which hands the adapter a `StorageContext` → the Postgres
  mixin runs a query filtered by `organization_id`. No org on the scope and no
  declared cross-org reason → `TypeError` before any SQL.
- **A deliberate cross-org read.** Published decks, share tokens and follow
  codes are authorized by the *token*, not the org. These go through
  `crossOrganizationScope(repoRoot, reason, …)` — the mandatory `reason` string
  makes `grep -r crossOrganization` a complete census of every unscoped path.
- **A list read.** The list facades (`listPresentations`,
  `listTrashedPresentations`, `listPresentationVersions`, `listTeamLibrary`/
  `listPersonalLibrary`, `getPublishedIndex`, `listImageLibrary`) return the
  **full organization-scoped set**, ordered but unpaginated. Pagination is the
  caller's concern: the public-api v1 routes slice `{limit, offset}` over the
  full list in-memory and report a truthful `total`, and bulk-export/search/MCP
  consume the whole set. There is deliberately no row cap — B79 had inherited
  `applyPagination()`'s old default 100 as a literal `.limit(100)`, which
  silently dropped the tail for any org past 100 items (corrupting API totals,
  truncating backups, and — sharpest — making the team-library trash/delete
  authz guard resolve through the capped list and return a false `not_found` for
  an item outside the newest page). B85 removed the cap and moved the guard to
  resolve its target directly by id. Pushing `limit`/`offset` into SQL is a
  future deliberate feature, not an accidental default; when it lands it is one
  canonical shape across all six facades, not a per-site parameter.
- **Storage boot.** `initializeStorage()` (server/storage/lifecycle.js) opens
  the shared Kysely pool via `initializeDatabase()`; it is idempotent, and
  `getDb()` throws `"Database not initialized"` before it has run.
- **Boot safety.** `boot-check.js` aborts startup if the DB is empty but legacy
  file data still sits on disk, so an accidental empty-DB boot cannot silently
  shadow real data.

## Config & flags

Storage selection lives in `server/config/database.js`:

- `STORAGE_MODE` — accepts exactly `postgres` (the default when unset).
  `storageModeError()` rejects anything else, with targeted messages for the
  removed `file` mode (→ run `npm run db:import`) and the misspelling
  `postgresql` (→ `postgres`).
- Connection: `DATABASE_URL` **or** the discrete `DATABASE_HOST/PORT/NAME/USER/
  PASSWORD` set (`DATABASE_URL` wins when both are present), plus
  `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, `DATABASE_POOL_MIN/MAX`.
- `DEFAULT_ORGANIZATION_ID` — single-organization default org
  (`00000000-0000-0000-0000-000000000001`), used only where a scope is legitimately
  org-less (see below).

## Failure signalling

A storage facade answers in exactly one of three shapes, decided by what the
call *is* — not by what it happens to have returned since it was written.

**Reads** — an export that answers a question about stored state (`get*`,
`find*`, `list*`, `count*`, `search*`, `aggregate*`) returns the value it was
asked for, `null` when there is no such thing, and `[]` for an empty
collection. Absence is not a failure; it is an answer, and the caller branches
on the value itself.

**Mutations** — an export that changes stored state returns
`{ ok: true, … }` on success and `{ ok: false, reason }` for **every**
non-throwing failure branch, including the trivial ones (a blank id, a missing
row, a lost race). It never signals failure with `null`, `undefined` or a bare
`false`. The success payload rides along on the same object
(`{ ok: true, question }`, `{ ok: true, controlEnabled }`), so a caller reads
one field to branch and one to use.

`reason` is a short snake_case token, drawn from the layer-wide vocabulary
before a domain-specific one is minted:

| `reason` | Means |
| --- | --- |
| `not_found` | The target row does not exist (or is not visible in this scope). |
| `invalid` | The caller's input is malformed — blank id, unparseable field. |
| `forbidden` | The row exists but this scope may not change it. |
| `conflict` | Another writer got there first, or a uniqueness rule bites. |
| `unavailable` | The database is not reachable; the `withDbGuard` fallback. |

Domain-specific reasons are fine where they carry information a route or UI
acts on (`slug_exists`, `last_owner`, `limit_exceeded`, `expired`). What is not
fine is a second spelling for a meaning that already has one.

**Throws** — programmer errors (a missing scope, an impossible argument) and
infrastructure failures raise. `toStorageContext()` throwing on an absent scope
is the canonical case. A caller is not expected to catch these; they are bugs
or outages, not outcomes. The one softened edge is `withDbGuard(fallback, fn)`
(`server/storage/utils/db-guard.js`), which returns `fallback` instead of
throwing when the pool is down — pass `null`/`[]` from a read and
`{ ok: false, reason: 'unavailable' }` from a mutation, so the guard hands back
that call kind's own failure shape.

### Implementation status: failure shapes

The convention above is the target, and it is where the layer already mostly
sits. Measured on 2026-08-18: 386 `return { ok …` statements against 106
`return null` statements, and nearly all of the latter are in reads, where
`null` is correct.

**Fourteen mutation exports still signal failure with `null`.** Five do so
in their own body — the interaction/feedback surface (`interaction-slides.js`,
`feedback.js`; the live-session surface was swept to `{ ok, reason }` on the
same day) — and
nine more do so by handing their answer straight to a module-private helper
that returns `null`: the poll and likert exports in `interactions.js`,
`updateImageLibraryItem` (`image-library/index.js`), and `restorePresentation`
/ `duplicatePresentation` (`presentations/index.js`). They are carried in
[`tests/storage-call-convention-burndown.json`](../../tests/storage-call-convention-burndown.json),
a shrink-only allowlist; `tests/storage-call-convention.test.js` fails on a
fifteenth. The list may only get shorter.

The gate is a syntax check with stated edges, not a proof. It follows
delegation exactly one level and only in return position (`return helper(…)`
to a same-module private function), so a `null` reached through an imported
helper or stored in a variable first reads as clean. It only looks at exports
whose name starts with a mutation verb from its whitelist, so a new
state-changing verb must be added there before the gate sees it. And it
cannot judge `return false`, because a boolean is as often the payload as the
verdict (`toggleImageFavorite` returns the *new* favourite state, not "it
worked"); `removePublishedEntry` is a real boolean-shaped failure the gate will
not catch. All of that is drift the burndown does not cover, not drift that is
allowed.

## Authz & tenancy

`server/storage/scope.js` is the enforcement point. Its rule: *a storage call
may not invent an organization the caller did not give it — there is no
fallback.* The entry points:

- `resolveScope(storageScope, operation, { allowCrossOrganization })` — validates the
  scope object and reduces it to `{organizationId, actorEmail, crossOrganization}`;
  throws on a bare-string/objectless scope or a missing org with no cross-org
  reason. Writes may never run cross-org.
- `crossOrganizationScope(repoRoot, reason, …)` — the only sanctioned unscoped
  read path (token-authorized).
- `singleOrganizationScope(repoRoot, entryPoint, …)` — org-less entry points (CLI,
  stdio MCP, maintenance) resolve to `DEFAULT_ORGANIZATION_ID` **only** when
  `isMultiOrgEnabled()` is false; otherwise it throws.
- `jobScope(jobData, operation)` — background jobs carry `organizationId` in the
  payload, else fall back to `singleOrganizationScope`.

The full isolation model (hosting shapes, `MULTI_ORG_ENABLED`, rules
R1–R3) is in [`tenant-isolation.md`](tenant-isolation.md); it is not repeated
here.

## Implementation status

Postgres is the **only** backend today. The file/JSON backend was removed during
1.x, and B79/D34 then removed the adapter class that had abstracted over the two:
every facade now reaches PostgreSQL through direct Kysely on `getDb()`, and
`STORAGE_MODE` accepts only `postgres`. This is the beta stance — one canonical
backend, one canonical way to reach it, no compatibility shim for the old
on-disk store and no abstract base kept alive for a second backend that does not
exist. If one is ever reintroduced it would grow its own seam then; nothing in
the tree carries that weight today.
