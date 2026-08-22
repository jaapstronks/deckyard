# Storage layer

## Purpose & scope

The storage layer is everything under `server/storage/` — the seam between
route/business code and the database. It owns two jobs: **tenancy** (no query
runs without an explicit organization scope) and the **query contract** (one
Postgres-only backend reached by every facade through direct Kysely on
`getDb()` — there is no adapter class; B79/D34 stripped it). Route handlers
never touch SQL directly; they call a per-domain facade
(`server/storage/presentations/`, `server/storage/themes.js`, …) with a _scope_
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

- `server/storage/scope.js` — defines and validates storage _scopes_, and
  reduces a caller scope to a `StorageContext` via `toStorageContext()`; the
  tenancy gate (see _Authz & tenancy_). Every facade calls this once, then
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
  `ownership.js`, `i18n.js`, `slide-notes.js`, `sandbox.js`, `sandbox-quota.js`,
  `cache.js`, `comments.js`, `subscriptions.js`, `ydocs.js`,
  `snapshot-identity.js`.
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
  _Identity dual keys_ below).

**Top-level facades** cover the remaining domains: auth/account
(`users.js`, `sso.js`, `magic-link.js`, `password-reset.js`, `api-keys.js`,
`api-usage.js`, `access-attempts.js`), presentation-adjacent
(`slide-locks.js`), collaboration/live (`collaborators.js`, `notifications.js`,
`activity-events.js`, `feedback.js`, `leads.js`, `questions.js`,
`interactions.js`, `follow-codes.js`), and content
(`themes.js`, `font-families.js`, `custom-slide-types.js`, `settings.js`,
`email-templates.js`, `uploads.js`). Each facade maps its own snake_case rows
into camelCase API objects inline (there is no shared `mappers.js` module).

## Data model

Schema lives in `server/db/migrations/` (**79 numbered migrations**,
`001_initial_schema.js` … `079_comment_author_identity.js`).
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

| Table                        | id column            | e-mail column |
| ---------------------------- | -------------------- | ------------- |
| `presentations`              | `owner_user_id`      | `owner_email` |
| `presentations`              | `created_by_user_id` | `created_by`  |
| `presentations`              | `updated_by_user_id` | `updated_by`  |
| `presentation_collaborators` | `user_id`            | `user_email`  |
| `user_settings`              | `user_id`            | `email`       |

The **id leads and the e-mail is the fallback**, under one invariant: _id
present ⇒ the e-mail column equals that user's current address_. Facades that
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
  codes are authorized by the _token_, not the org. These go through
  `crossOrganizationScope(repoRoot, reason, …)` — the mandatory `reason` string
  makes `grep -r crossOrganization` a complete census of every unscoped path.
- **A list read.** The list facades (`listPresentations`,
  `listTrashedPresentations`, `listPresentationVersions`, `listOrganizationLibrary`/
  `listPersonalLibrary`, `getPublishedIndex`, `listImageLibrary`) return the
  **full organization-scoped set**, ordered but unpaginated. Pagination is the
  caller's concern: the public-api v1 routes slice `{limit, offset}` over the
  full list in-memory and report a truthful `total`, and bulk-export/search/MCP
  consume the whole set. There is deliberately no row cap — B79 had inherited
  `applyPagination()`'s old default 100 as a literal `.limit(100)`, which
  silently dropped the tail for any org past 100 items (corrupting API totals,
  truncating backups, and — sharpest — making the organization-shelf
  trash/delete authz guard resolve through the capped list and return a false `not_found` for
  an item outside the newest page). B85 removed the cap and moved the guard to
  resolve its target directly by id. Pushing `limit`/`offset` into SQL is a
  future deliberate feature, not an accidental default; when it lands it is one
  canonical shape across all six facades, not a per-site parameter.
  **Decided 2026-08-19 (parked with a trigger):** DB-level pagination is
  built when either a list read on a production instance returns more than
  ~1 000 rows for one organization, or the single-service-layer work (A7.4)
  starts — whichever comes first — and then as a keyset cursor inside that
  service layer, never as a per-endpoint parameter. Until then the twelve
  in-memory slicers over `parsePaginationParams` are the intended shape.
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
call _is_ — not by what it happens to have returned since it was written.

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

| `reason`      | Means                                                            |
| ------------- | ---------------------------------------------------------------- |
| `not_found`   | The target row does not exist (or is not visible in this scope). |
| `invalid`     | The caller's input is malformed — blank id, unparseable field.   |
| `forbidden`   | The row exists but this scope may not change it.                 |
| `conflict`    | Another writer got there first, or a uniqueness rule bites.      |
| `unavailable` | The database is not reachable; the `withDbGuard` fallback.       |

Domain-specific reasons are fine where they carry information a route or UI
acts on (`slug_exists`, `last_owner`, `limit_exceeded`, `expired`). What is not
fine is a second spelling for a meaning that already has one.

### The register: one place a reason is minted

[`server/storage/reasons.js`](../../server/storage/reasons.js) holds `REASONS`,
the closed vocabulary. Every code the layer can answer is listed there with two
fields:

- **`status`** — the HTTP status it answers with. One reason, one status, on
  every route; a handler never picks its own.
- **`kind`** — `'caller'` (4xx, the request is at fault) or `'ours'` (5xx, the
  server is). `unavailable`, `database_error`, `create_failed`, `update_failed`
  and `write_failed` are the `'ours'` codes.

`getErrorStatus(reason)` in `server/utils/http.js` is the only reader, and it
takes **no default status**. A reason the register does not know is a hole in
our own vocabulary, not a malformed request: it throws outside production (so a
test, a dev run or CI fails on it) and answers `500` in production. Adding a
code means adding a register entry — there is nowhere else to mint one.

`tests/storage-reason-vocabulary.test.js` is the gate. It parses every
`{ ok: false, reason: '<literal>' }` under `server/storage/**` and
`server/routes/api/**` and asserts membership, **with an empty allowlist**; it
also refuses a code that is not a `snake_case` token, a `kind`/`status` pair
that disagrees, a register entry nobody mints, and any `getErrorStatus(reason,
<default>)` call.

**Throws** — programmer errors (a missing scope, an impossible argument) and
infrastructure failures raise. `toStorageContext()` throwing on an absent scope
is the canonical case. A caller is not expected to catch these; they are bugs
or outages, not outcomes. The one softened edge is `withDbGuard(fallback, fn)`
(`server/storage/utils/db-guard.js`), which returns `fallback` instead of
throwing when the pool is down — pass `null`/`[]` from a read and
`{ ok: false, reason: 'unavailable' }` from a mutation, so the guard hands back
that call kind's own failure shape.

### Implementation status: the vocabulary (as of 2026-08-22)

**The register is in place and the gate is green with an empty allowlist**
(B104 PR 1). Before it, `ERROR_STATUS_MAP` in `server/utils/http.js` covered 23
of the 89 codes the layer mints and the other 66 fell through to a `400`
default — so `createSlideCollection` answering `create_failed` because its
insert returned nothing reached the client as _"your request was malformed"_,
and never showed up on a dashboard watching 5xx. Two shape defects went with the
default: three `reason`s were English sentences (`'No device id provided'`),
which the envelope puts on the wire as the machine code clients branch on, and
five were `camelCase` (`bad_slideIndex`, `missing_questionId`). All eight are
now tokens from the register.

Two things the register deliberately did **not** do in that cut, both tracked
under B104: the 25 `badRequest(res, <reason>)` sites and 51 hand-written
`reason === '…'` branches in `server/routes/**` still bypass `getErrorStatus`
(PR 2), and the surviving synonym sets — `slug_exists`/`slug_taken`/
`variant_exists`, `key_id_required`/`api_key_id_required`, and the five
`invalid_*` spellings D48 names (`invalid`, `invalid_id`, `invalid_params`,
`invalid_fields`, `invalid_name`) — are still separate codes (PR 3, D48).

### Implementation status: failure shapes (as of 2026-08-21)

**No mutation export signals failure with `null` any more.**
[`tests/storage-call-convention-burndown.json`](../../tests/storage-call-convention-burndown.json)
is `[]`, and `tests/storage-call-convention.test.js` stays on as a regression
guard: it fails on the first export that reintroduces the shape, and the list
is shrink-only, so a violation cannot be waved through by appending to it.

The sweep ran in three steps: the live-session surface (#825), the
interaction/feedback cluster, and the presentation trash/duplicate,
image-library and publishing exports. The two boolean-shaped verdicts the gate
could not see went with them — `deleteImageLibraryItem` and
`removePublishedEntry` now answer `{ ok: true }` / `{ ok: false, reason }`
rather than `true`/`false`. A boolean that is a _payload_ is untouched and
stays correct: `toggleImageFavorite` returns the new favourite state, not "it
worked".

Behaviour is pinned against a real database, both directions per export, in
`tests/pg/live-sessions.pgtest.js`, `tests/pg/live-interactions.pgtest.js` and
`tests/pg/storage-mutation-shapes.pgtest.js` — a static gate cannot tell which
branch PostgreSQL actually takes.

The gate is a syntax check with stated edges, not a proof, so drift it cannot
see is still drift rather than something the convention permits. It follows
delegation exactly one level and only in return position (`return helper(…)`
to a same-module private function), so a `null` reached through an imported
helper or stored in a variable first reads as clean. It only looks at exports
whose name starts with a mutation verb from its whitelist, so a new
state-changing verb must be added there before the gate sees it. And it cannot
judge `return false` at all, which is why the two boolean verdicts above needed
finding by hand.

The vocabulary followed the shape. The audience-facing interaction exports
(`voteInteraction`, `submitFeedback`) used to answer `bad_request` / `no_session`
/ `empty` — three spellings for meanings the table above already names (B93).
They now answer `invalid` for a blank slide or device id and for empty feedback
text, and they hand back whatever `ensureInteractionSlide` answered instead of
flattening it, so a session that is gone reads `not_found` and a pool that is
down reads `unavailable`. The follow routes map those through
`getErrorStatus()`, which is where the change is visible: a vanished session is
now a 404 rather than a 400, and a database outage a 503 rather than a 400. Both
are only reachable on a race — the handlers pre-check live-ness and the current
slide — and both are the honest status for what happened.
Those three spellings cannot come back: they are not in the `REASONS` register,
so the vocabulary gate refuses them (it superseded the flat blocklist that used
to live in `tests/storage-call-convention.test.js`).

One known gap sits outside the shape itself: several facades let a malformed
caller id reach PostgreSQL, which raises `22P02` on a `uuid` column instead of
the facade answering `invalid` — a throw where the convention wants a
non-throwing failure branch.

## Authz & tenancy

`server/storage/scope.js` is the enforcement point. Its rule: _a storage call
may not invent an organization the caller did not give it — there is no
fallback._ The entry points:

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

## Implementation status (as of 2026-08-21)

Postgres is the **only** backend today. The file/JSON backend was removed during
1.x, and B79/D34 then removed the adapter class that had abstracted over the two:
every facade now reaches PostgreSQL through direct Kysely on `getDb()`, and
`STORAGE_MODE` accepts only `postgres`. This is the beta stance — one canonical
backend, one canonical way to reach it, no compatibility shim for the old
on-disk store and no abstract base kept alive for a second backend that does not
exist. If one is ever reintroduced it would grow its own seam then; nothing in
the tree carries that weight today.
