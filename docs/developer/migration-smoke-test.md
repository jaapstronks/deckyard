# Migration smoke test

`scripts/migration-smoke-test.js` runs every migration in `server/db/migrations/`
up, all the way back down, and up again against an empty PostgreSQL. It is the
only thing in CI that touches a real database.

It exists because none of them ran anywhere in CI. One migration was exercised
individually against the in-memory double (`tests/helpers/fake-db.js`); the rest
ran for the first time on staging or production, which made a deploy the first
place a broken migration could be found. That is not a theoretical worry — the
first run of this script found migration 020's `down()` filtering
`slide_library` on a column named `type`, which has never existed on that table
(it is `slide_type`). The rollback had been broken since the day it was written
and nothing anywhere would have said so.

## What it asserts

| Phase | Check |
| --- | --- |
| precondition | the target database has no tables — the script is destructive and refuses to guess |
| up | every migration applies, and the count matches the files on disk |
| down | every migration rolls back, and `_migrations` ends empty |
| up again | every migration re-applies from the rolled-back state |
| round trip | the set of tables after the second `up` equals the set after the first |

The round trip is the real assertion. A `down()` that quietly drops something
its `up()` no longer recreates fails on the second pass, and a `down()` that
does nothing at all fails when the second `up()` hits an object that is still
there.

Table names are compared, not columns. A column-level comparison would mean
writing the expected schema into this file, and that copy would rot the moment a
migration landed — the failure mode the double already has.

## What it deliberately does not assert

It says nothing about whether the resulting schema is *correct*, or whether any
query the storage layer writes works against it. Conflict targets, `jsonb`
round-trips, transaction isolation — the classes where the in-memory double can
disagree with PostgreSQL — are all untouched here. That coverage needs a test
suite running against `DATABASE_URL`, which is a larger piece of work; see
`docs/plans/briefs/postgres-test-infra.md` (option A). This script is option D:
the smallest thing that moves "a broken migration" out of production and into
CI.

It also does not run in `npm test`. The suite has no database, deliberately —
see [dev-setup.md](dev-setup.md) § Testing storage behaviour without PostgreSQL.
This is a separate CI job with a service container.

## Running it locally

The database must exist and be empty. Point `DATABASE_NAME` at a scratch
database, never at your dev one:

```sh
createdb deckyard_migration_smoke
DATABASE_NAME=deckyard_migration_smoke node scripts/migration-smoke-test.js
```

Everything else comes from the usual `DATABASE_*` variables
(`server/config/database.js`), so a local `.env` covers host, user and password.

## How it gets a database in CI

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

## The runner is importable

`server/db/migrate.js` exports `createMigrationDb`, `runUp`, `runDown`,
`listMigrationFiles` and `listAppliedMigrations`; its CLI half is guarded so
importing the module has no side effects. That is what lets this script roll the
whole stack back and forward over one connection instead of spawning the CLI 115
times, and it is the prerequisite for the fuller PostgreSQL test job later.
