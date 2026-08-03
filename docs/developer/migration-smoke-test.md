# The `migrations` CI job

Two checks share one PostgreSQL service container: the migration smoke test
below, and the test-double schema conformance check that runs on the schema it
leaves behind.

## Migration smoke test

`scripts/migration-smoke-test.js` runs every migration in `server/db/migrations/`
up, all the way back down, and up again against an empty PostgreSQL.

It exists because none of them ran anywhere in CI. One migration was exercised
individually against the in-memory double (`tests/helpers/fake-db.js`); the rest
ran for the first time on staging or production, which made a deploy the first
place a broken migration could be found. That is not a theoretical worry — the
first run of this script found migration 020's `down()` filtering
`slide_library` on a column named `type`, which has never existed on that table
(it is `slide_type`). The rollback had been broken since the day it was written
and nothing anywhere would have said so.

### What it asserts

| Phase | Check |
| --- | --- |
| precondition | there is at least one migration on disk, and the target database has no tables — the script is destructive and refuses to guess |
| up | every migration applies, and the count matches the files on disk |
| down | every migration rolls back, `_migrations` ends empty, and the only table left standing is `_migrations` itself |
| up again | every migration re-applies from the rolled-back state |
| round trip | the set of tables after the second `up` equals the set after the first |

Two of those carry the weight. The **down-to-empty** assertion is what catches a
`down()` that forgets to drop something: bookkeeping being empty says only that
the runner *ran* each `down()`, not that any of them did anything, so the
surviving tables are compared against the single expected survivor.

The **round trip** then catches the other direction — a `down()` that drops
something its `up()` no longer recreates comes back short on the second pass.

What the round trip does *not* catch on its own: 32 of the 57 migrations create
with `IF NOT EXISTS`, so a leftover object does not make the second `up()`
fail. For those, the down-to-empty check is the only thing that notices. The
second `up()` failing on a still-present object is real, but only for the
non-idempotent migrations — it is a bonus, not the guarantee.

Table names are compared, not columns. A column-level comparison would mean
writing the expected schema into this file, and that copy would rot the moment a
migration landed — the failure mode the double already has.

### What it deliberately does not assert

It says nothing about whether the resulting schema is *correct*, or whether any
query the storage layer writes works against it. Conflict targets, `jsonb`
round-trips, transaction isolation — the classes where the in-memory double can
disagree with PostgreSQL — are all untouched here. That coverage is option A
from the same brief (`docs/plans/briefs/postgres-test-infra.md`) and it has
shipped: see [pg-test-suite.md](pg-test-suite.md) and the `test-postgres` CI
job. This script is option D: the smallest thing that moves "a broken
migration" out of production and into CI.

It also does not run in `npm test`. The suite has no database, deliberately —
see [dev-setup.md](dev-setup.md) § Testing storage behaviour without PostgreSQL.
This is a separate CI job with a service container.

### Running it locally

The database must exist and be empty. Point `DATABASE_NAME` at a scratch
database, never at your dev one:

```sh
createdb deckyard_migration_smoke
DATABASE_NAME=deckyard_migration_smoke node scripts/migration-smoke-test.js
```

Everything else comes from the usual `DATABASE_*` variables
(`server/config/database.js`), so a local `.env` covers host, user and password.

### How it gets a database in CI

`.github/workflows/ci.yml` runs it as its own `migrations` job with a
`services: postgres` container — the same shape as the Chrome install in the
`test` job, and for the same reason: a real dependency in CI because a double
cannot find this class of bug.

It is a separate job rather than a step in `test`, which costs ~0 wall-clock on
the critical path (GitHub runs jobs in parallel, so it lands beside `test`, not
behind it) and makes a red mark read as "a migration broke" without opening the
run. `test-fork` set that precedent.

The healthcheck on the service is not optional. The runner starts the step as
soon as the container exists, which is earlier than the server accepting
connections, so without `--health-cmd pg_isready` the first migration loses a
race it will never lose twice — the worst kind of flake.

### The runner is importable

`server/db/migrate.js` exports `createMigrationDb`, `runUp`, `runDown`,
`listMigrationFiles` and `listAppliedMigrations`; its CLI half is guarded so
importing the module has no side effects. That is what lets this script roll the
whole stack back and forward over one connection instead of spawning the CLI 171
times, and it is what made the fuller PostgreSQL test job (`test-postgres`,
[pg-test-suite.md](pg-test-suite.md)) possible.

## Test-double schema conformance

`scripts/check-test-double-schema.js` holds `tests/helpers/fake-db.js` against
the schema the migrations just produced. It runs as the second step of the same
job, on the database the smoke test leaves fully migrated behind it.

The double carries two hand-written tables that *claim* to mirror the database —
`UNIQUE_CONSTRAINTS` (what an insert must collide on) and `JSONB_COLUMNS` (what
round-trips through JSON). Nothing checked that claim. #423 is what the gap
costs: `acquireSlideLock` needed an `INSERT … ON CONFLICT DO UPDATE … WHERE`,
and testing it meant first teaching the double what `ON CONFLICT` was and
registering the `slide_locks` unique — in the same PR as the fix. A double you
extend when you need it proves only what you put in.

The failure mode it closes is quiet by construction: a migration changes a
constraint, the double keeps enforcing the old one, and every test exercising
that upsert stays green against a reality that no longer exists.

### What it asserts

| Check | Why |
| --- | --- |
| every table the double models exists | a renamed table leaves a rule that can never fire |
| every declared unique exists, column for column | the #423 shape — right table, wrong columns, and every test agreed |
| every declared jsonb column is jsonb | otherwise the double parses something PostgreSQL never serialized |
| every jsonb column on a modelled table is declared | otherwise the double returns a string where production returns an object |

**Uniques are checked one way, jsonb both ways**, and the asymmetry is
deliberate. A unique the *schema* has and the double does not is fine: the
double models the constraints it needs, not the whole database. A unique the
*double* has and the schema does not is a lie. Jsonb is different — an
undeclared jsonb column is not an omission the double gets away with, it is a
value handed back in the wrong shape.

Primary keys are excluded from the unique comparison: they are unique, but the
double models them as identity rather than as a collision rule, and every
`*_pkey` in the list would drown the constraints that matter.

Partial unique indexes (`UNIQUE … WHERE`) are excluded for the opposite reason:
counting one would *satisfy* a declared unique the schema does not actually
enforce on every row. The double collides unconditionally, so a partial index is
not the constraint it claims to have — accepting it would be a false green of
the #423 kind, which is the thing this check exists to prevent.

It found one drift on its first run: `app_settings.supported_slide_langs` was
listed as jsonb, but it is `TEXT[]`, as declared in
`server/db/migrations/001_initial_schema.js`.

### Why it is not in `npm test`

The brief's option C proposed deriving the schema from the migration *files*, so
the check could live in the database-free suite. That means writing a second
hand-written model of the schema and checking the first against it — and when
the two parsers disagree, neither is the database.

With a real PostgreSQL already in this job (option D, above), asking the
database is both cheaper and the only answer that cannot itself be wrong. The
cost is that the check is a CI job rather than a local `npm test`; run it by
hand the same way:

```sh
DATABASE_NAME=deckyard_migration_smoke node scripts/migration-smoke-test.js
DATABASE_NAME=deckyard_migration_smoke node scripts/check-test-double-schema.js
```
