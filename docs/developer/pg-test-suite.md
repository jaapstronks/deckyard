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

## The DATABASE_URL gate

The suite `TRUNCATE`s tables, so it must never touch a real organization database.
It therefore runs **only** when `DATABASE_URL` names a throwaway Postgres —
a signal a normal dev `.env` does not carry, because the standard dev config
uses the discrete `DATABASE_HOST`/`DATABASE_NAME` vars. (`db:migrate` and the
app *do* honor `DATABASE_URL` when it is set — that is B43's fix, so the migrate
step and the suite agree on the scratch DB — but a dev `.env` leaves it unset.)
With `DATABASE_URL` unset, `pgDescribe()` skips every block with a clear reason
and a bare `npm run test:pg` is inert. In CI the `test-postgres` job sets `DATABASE_URL` at
its dedicated scratch database.

Because the facade tests share tables (organizations, presentations,
slide_library, …), the runner is pinned to one file at a time
(`--test-concurrency=1` in the `test:pg` script); each file `TRUNCATE`s and
reseeds in `before`, so order never matters.

## The seams

The storage layer reaches the database exclusively through `getDb()` behind
`isDatabaseAvailable()` (`server/storage/utils/db-guard.js`). `tests/pg/helpers/
harness.js` opens a real Kysely against `DATABASE_URL` and installs it with
`__setTestDb()` (`server/db/client.js`) — the *same* seam the in-memory double
uses. Once installed, every storage module transparently hits the live
connection. `openTestDb()` also guards against an unmigrated database, so a
missing-schema run fails loud instead of erroring on the first missing table.

There are two shapes of test:

- **Storage-module tests** (`api-usage`, `slide-locks`) import a storage
  function directly and only need the handle installed. `before` calls
  `openTestDb()`, `after` calls `closeTestDb()`.
- **Facade tests** (`tags`, `slide-collections`, `slide-library-usage`,
  `slide-library-i18n`, `home-aggregation-route`, `version-history`) drive the
  public storage facade (`server/storage/<domain>/index.js`), which dispatches
  to whichever adapter `getStorage()` returns. `installFacadeStorage()` sets
  `STORAGE_MODE=postgres` and calls `initializeStorage()`, wiring the facade to
  the already-open handle (the adapter's `initialize()` reuses the injected
  handle instead of opening a second pool). `uninstallFacadeStorage()` drops the
  adapter singleton in `after` without closing the handle the test owns.

Foreign-key parents are seeded from `tests/pg/helpers/seed.js`
(`seedDefaultOrganization`, `seedPresentation`, `seedSlideLibraryItem`): unlike
the disk-JSON store, PostgreSQL enforces that a tag belongs to a real organization
and a `presentation_tags` link points at a real `presentations.id` uuid — so a
facade test seeds real rows rather than the `'p1'`/`'s1'` string literals the
file suite tolerated.

## What it covers today

The facade suite is the coverage that must survive the file adapter's removal
(PR G in `docs/plans/briefs/storage-path-consolidation.md`): the storage
round-trips the file suite used to cover are now exercised on PostgreSQL through
the same public facade the server uses in `STORAGE_MODE=postgres`.

| Path | What real PostgreSQL proves |
| --- | --- |
| `acquireSlideLock` (`slide-locks.js`) | the #423 case: a `DO UPDATE ... WHERE` that is false returns **no row**, which is what `{ ok: false, reason: 'held' }` is built on; and the conflict target `(presentation_id, slide_id)` is enforced by the constraint, not a hand model |
| `incrementUsage` (`api-usage.js`) | the `COALESCE(<col>, 0) + n` upsert on `(api_key_id, date)` accumulates correctly across insert and conflict paths |
| tags facade | set/get/list/search/delete round-trip with real `organizations` + `presentations` foreign keys |
| slide-collections facade | personal/team CRUD, ordered + deduped membership, and the FK guard that drops membership ids with no `slide_library` row |
| slide-library-usage facade | the `use_count = use_count + 1` conflict upsert and `firstUsedAt` stability |
| slide-library-i18n facade | the `i18n` jsonb write path (migration 049) survives create/read-back/update |
| home-aggregation route | `handleHome` assembles team slides, team collections and usage into the Home shape |
| version-history facade | version create/list/get/prune through the presentations adapter |
| sandbox TTL sweep + quota | the bulk `DELETE` of expired ephemeral decks cascades to versions/published; per-guest deck-count and byte caps count against `presentations` and refuse a mint with a typed 429 |
| `updateUserEventRead` (`activity-events.js`) | the read-marker upsert on the `(organization_id, user_email)` unique index, and the `last_read_event_id` FK that is set to null (not orphaned) when its `activity_events` row is deleted |
| `setSubscription` (`presentation-subscriptions.js`) | the per-deck override upsert on the `(presentation_id, user_email)` primary key, with `presentation_id` FK-bound to a real deck |
| `markThreadsRead` (`presentation-comments.js`) | the heaviest FK chain: a `comment_thread_reads` marker upserts on `(user_email, comment_id)` and cascades out when its `presentation_comments` row is deleted (org → deck → comment → marker) |
| `setYDocState` (postgres `presentations`) | the collab `bytea` round-trip: a `Uint8Array` stored via `Buffer.from` reads back byte-for-byte, upserting on the `presentation_id` primary key |
| image favorites (facade) | `toggleImageFavorite` round-trips on the composite PK (migration 033), keeps favorites per user, and the `image_id` FK cascades favorites out when the image is deleted. Since B79/D34 stripped the adapter, the `ON CONFLICT DO NOTHING` inside the now-private `addFavorite` is a concurrency guard that is not serially reachable through the public surface, so a direct double-add is no longer exercised (documented in the test header) |
| image library usage facade | the `jsonb_path_exists` search over `slides` and `i18n` that replaced the old directory scan — whole-value, content-scoped, org- and trash-filtered — a query shape the in-memory double does not model at all |
| settings facade | the singleton `app_settings` upsert (one jsonb bag, one row) and the per-e-mail `user_settings` upsert (migration 059) — store-raw / normalize-on-read round-trips plus the partial-write merges the disk-JSON store used to prove on disk |
| follow codes | that a five-character code fits the column at all: the 001 schema declared `char(4)`, which the double (any string is any string) could never have caught, and migration 060 widened |
| present sessions | the substrate swap: a session survives a cold process, a stale row loses to a fresher in-memory copy and a newer row wins, the `presentation_id` cascade removes sessions with their deck, and the TTL sweep spares live ones |
| live interactions (questions, polls/likerts, feedback) | the constraints that replaced per-process Maps: `voters @> ARRAY[…]` makes a second upvote a no-op, `interaction_votes`' composite primary key makes a re-vote a replacement, `feedback`'s `(session, slide, device)` unique makes a resubmit an edit — and the `session_id` cascade that lets one sweep collect all four domains |

## Adding a test

For a **storage-module test**, import the storage function and
`openTestDb`/`closeTestDb`/`truncate`/`pgDescribe` from `./helpers/harness.js`;
`before` opens the handle, `after` closes it. Seed foreign-key parents in
`before`/`beforeEach` (see `api-usage.pgtest.js`, which inserts an `api_keys`
row before exercising `api_usage_daily`).

For a **facade test**, also call `installFacadeStorage()` in `before` and
`uninstallFacadeStorage()` in `after`, wrap the block in `pgDescribe(...)`, and
seed parents from `./helpers/seed.js`. `tags-storage.pgtest.js` is the smallest
end-to-end example.

All eight `onConflict` sites from `docs/plans/briefs/postgres-test-infra.md`
now have coverage: `slide-locks` and `api-usage` (the first suite), plus
`activity-events`, `presentation-subscriptions`, `presentation-comments`, the
adapter-backed `presentations` (Y.Doc state), `image-favorites` (via the
facade toggle since B79/D34 — see the table note), and `slide-library-usage`.

## Running it locally

Point `DATABASE_URL` at a **scratch** database (the suite truncates tables),
migrate it, then run the suite:

```sh
createdb deckyard_pg_tests
export DATABASE_URL=postgres://USER:PASS@localhost:5432/deckyard_pg_tests
npm run db:migrate   # honors DATABASE_URL — migrates the scratch DB, not your dev DB
npm run test:pg
```

`db:migrate` honors a set `DATABASE_URL` above the `DATABASE_*` vars (they share
`getDatabaseConfig()`), so `DATABASE_URL=… npm run db:migrate` migrates the
scratch database the suite reads — you no longer need to restate it as
`DATABASE_NAME=…` for the migrate step, and a bare `DATABASE_URL=…` run can no
longer migrate your dev database by accident. Whichever way you set it, it must
name a **scratch** database — never the compose stack's own `deckyard`, which is
your dev data and which this suite truncates.

If you run the compose stack, `docker-compose.local.yml` publishes its Postgres
on host port 5433 (`POSTGRES_HOST_PORT` to change it):

```sh
createdb -h localhost -p 5433 -U deckyard deckyard_pg_tests   # once
export DATABASE_URL=postgres://deckyard:PASS@localhost:5433/deckyard_pg_tests
npm run db:migrate   # the URL carries host+port+name, so both steps agree
npm run test:pg
```

`.env` values do not override variables already set in the shell
(`server/config/env.js`), so the inline prefixes win over a `.env` that points
at your dev database — and without `DATABASE_URL` the suite simply skips, so it
can never run against that dev database by accident.
