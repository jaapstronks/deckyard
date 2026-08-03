# The real-PostgreSQL test suite

`tests/pg/**/*.pgtest.js` is the only part of the suite that talks to a real
database. Every other test runs against `tests/helpers/fake-db.js`, an in-memory
double that implements *only the query shapes the storage layer uses*, not
Kysely or PostgreSQL as a whole. That double is deliberately incomplete, and the
places it diverges from PostgreSQL are the ones production finds first — see
`docs/plans/briefs/postgres-test-infra.md` for the full risk classes. This suite
is option A from that brief, the follow-up to the migration jobs #548/#551.

## What it runs against

A live PostgreSQL, with the schema built by the migrations. The suite reads that
schema; it does not create it. In CI the `test-postgres` job in
`.github/workflows/ci.yml` runs `npm run db:migrate` against a `postgres:16`
service container first, then `npm run test:pg`.

## Why it is a separate suite and a separate job

- **Not in `npm test`.** The files are named `*.pgtest.js`; the default runner
  glob (`tests/**/*.test.js`) matches `*.test.js` only, so a local `npm test`
  with no database still runs the pure suite unchanged.
- **A separate CI job**, like `migrations` and `test-fork`, so it costs ~0
  wall-clock on the critical path (GitHub runs it beside `test`) and a red mark
  reads as "a real-DB query broke" without opening the run.

## The seam

The storage layer reaches the database exclusively through `getDb()` behind
`isDatabaseAvailable()` (`server/storage/utils/db-guard.js`). `tests/pg/helpers/
harness.js` opens a real Kysely via `createMigrationDb()` and installs it with
`__setTestDb()` (`server/db/client.js`) — the *same* seam the in-memory double
uses. Once installed, every storage module transparently hits the live
connection. `openTestDb()` also guards against an unmigrated database, so a
missing-schema run fails loud instead of erroring on the first missing table.

Each test file opens one connection in `before`, closes it in `after`, and
`truncate`s its own tables in `beforeEach`. Files touch disjoint tables, so the
runner may run them concurrently without cross-talk.

## What it covers today

The highest-value `onConflict` paths — the ones the double can only imitate:

| Path | What real PostgreSQL proves |
| --- | --- |
| `acquireSlideLock` (`slide-locks.js`) | the #423 case: a `DO UPDATE ... WHERE` that is false returns **no row**, which is what `{ ok: false, reason: 'held' }` is built on; and the conflict target `(presentation_id, slide_id)` is enforced by the constraint, not a hand model |
| `incrementUsage` (`api-usage.js`) | the `COALESCE(<col>, 0) + n` upsert on `(api_key_id, date)` — a shape the double approximates as `<col> ± n` — accumulates correctly across insert and conflict paths |

## Adding a test

Import the storage module and `openTestDb`/`closeTestDb`/`truncate` from
`./helpers/harness.js`, then follow the shape of the existing files: `before`
opens the handle, `beforeEach` truncates the tables you touch, `after` closes.
Seed any foreign-key parents in `beforeEach` (see `api-usage.pgtest.js`, which
inserts an `api_keys` row before exercising `api_usage_daily`).

The remaining `onConflict` sites from the brief — `activity-events`,
`presentation-subscriptions`, `presentation-comments`, and the adapter-backed
`presentations`/`image-favorites`/`slide-library-usage` — are the natural next
additions; the first three carry heavier foreign-key chains, and the adapter
sites additionally need `initializeStorage()` in postgres mode.

## Running it locally

Point the `DATABASE_*` vars at a **scratch** database (the suite truncates
tables), migrate it, then run the suite:

```sh
createdb deckyard_pg_tests
DATABASE_NAME=deckyard_pg_tests npm run db:migrate
DATABASE_NAME=deckyard_pg_tests npm run test:pg
```

If you run the compose stack, `docker-compose.local.yml` publishes its Postgres
on host port 5433 (`POSTGRES_HOST_PORT` to change it). Point the suite at a
**scratch database on that server**, never at the compose stack's own
`deckyard` database - that is your dev data and this suite truncates tables:

```sh
createdb -h localhost -p 5433 -U deckyard deckyard_pg_tests   # once
DATABASE_PORT=5433 DATABASE_NAME=deckyard_pg_tests npm run test:pg
```

`.env` values do not override variables already set in the shell
(`server/config/env.js`), so the `DATABASE_NAME=` prefix wins over a `.env` that
points at your dev database.
