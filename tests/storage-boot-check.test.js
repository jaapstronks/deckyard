import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { __setTestDb } from '../server/db/client.js';
import {
  pendingMigrationsError,
  strandedFileDataError,
} from '../server/storage/boot-check.js';
import { listMigrationFiles } from '../server/db/migrate.js';

/**
 * Boot guard for the Postgres default: an install that predates the flip has
 * its decks as JSON on disk. Booting Postgres mode against an empty database
 * would show an empty organization, which reads as data loss. The guard must stop
 * that boot, and must stay quiet in every other combination — a false positive
 * would refuse to start a perfectly healthy install.
 */

/** Minimal Kysely-shaped double: `selectFrom(t).select(c).limit(n).executeTakeFirst()`. */
function dbWithPresentations(rows) {
  return {
    selectFrom() {
      const builder = {
        select: () => builder,
        limit: () => builder,
        executeTakeFirst: async () => rows[0],
      };
      return builder;
    },
  };
}

/** A database that rejects (unmigrated schema, unreachable server). */
function failingDb() {
  return {
    selectFrom() {
      const builder = {
        select: () => builder,
        limit: () => builder,
        executeTakeFirst: async () => {
          throw new Error('relation "presentations" does not exist');
        },
      };
      return builder;
    },
  };
}

async function makeDataDir({ decks }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-boot-check-'));
  const dir = path.join(root, 'server', 'data', 'presentations');
  await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < decks; i++) {
    await fs.writeFile(path.join(dir, `deck-${i}.json`), '{"id":"x"}');
  }
  return root;
}

const cleanup = [];
afterEach(async () => {
  __setTestDb(null);
  delete process.env.STORAGE_MODE;
  while (cleanup.length)
    await fs.rm(cleanup.pop(), { recursive: true, force: true });
});

test('empty database plus decks on disk refuses the boot, naming no importer', async () => {
  const root = await makeDataDir({ decks: 2 });
  cleanup.push(root);
  process.env.STORAGE_MODE = 'postgres';
  __setTestDb(dbWithPresentations([]));

  const err = await strandedFileDataError(root);
  assert.ok(err, 'expected the boot to be refused');
  assert.match(err, /2 decks/);
  assert.doesNotMatch(
    err,
    /db:import/,
    'the one-time file import was retired (B385): a refusal may not send the ' +
      'operator to a command that no longer exists',
  );
  assert.match(
    err,
    /removed in 1\.x/,
    'must say the file backend is gone, not an option',
  );
  assert.match(err, /not been touched/, 'must say the file data is left alone');
  assert.match(
    err,
    /move it aside|DATA_DIR/,
    'must name the one way forward that is left',
  );
});

test('a database that already holds decks boots normally', async () => {
  const root = await makeDataDir({ decks: 2 });
  cleanup.push(root);
  process.env.STORAGE_MODE = 'postgres';
  __setTestDb(dbWithPresentations([{ id: 'deck-1' }]));

  assert.equal(await strandedFileDataError(root), null);
});

test('a fresh install (empty database, no data directory) boots normally', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-boot-check-'));
  cleanup.push(root);
  process.env.STORAGE_MODE = 'postgres';
  __setTestDb(dbWithPresentations([]));

  assert.equal(await strandedFileDataError(root), null);
});

test('an empty presentations directory is not stranded data', async () => {
  const root = await makeDataDir({ decks: 0 });
  cleanup.push(root);
  process.env.STORAGE_MODE = 'postgres';
  __setTestDb(dbWithPresentations([]));

  assert.equal(await strandedFileDataError(root), null);
});

test('a database that cannot answer is left to the storage layer', async () => {
  const root = await makeDataDir({ decks: 2 });
  cleanup.push(root);
  process.env.STORAGE_MODE = 'postgres';
  __setTestDb(failingDb());

  assert.equal(await strandedFileDataError(root), null);
});

test("no database connection at all is not this guard's business", async () => {
  const root = await makeDataDir({ decks: 2 });
  cleanup.push(root);
  process.env.STORAGE_MODE = 'postgres';
  __setTestDb(null);

  assert.equal(await strandedFileDataError(root), null);
});

test('the DATA_DIR override is where the guard looks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-boot-check-'));
  cleanup.push(root);
  const custom = path.join(root, 'elsewhere');
  await fs.mkdir(path.join(custom, 'presentations'), { recursive: true });
  await fs.writeFile(path.join(custom, 'presentations', 'a.json'), '{}');

  process.env.STORAGE_MODE = 'postgres';
  process.env.DATA_DIR = custom;
  __setTestDb(dbWithPresentations([]));
  try {
    const err = await strandedFileDataError(root);
    assert.ok(err);
    assert.match(err, /1 deck\b/);
  } finally {
    delete process.env.DATA_DIR;
  }
});

/**
 * The second boot guard in this module: a reachable database whose migrations
 * never ran. Before it existed, that install started, announced its URL and
 * answered every request with a 500 `relation "app_settings" does not exist` —
 * the state `scripts/install.sh` left a Node-path install in, since only the
 * Docker entrypoint migrated. The comparison is the migration runner's own, so
 * these run against the real migrations directory.
 */

/** Minimal Kysely-shaped double for `listAppliedMigrations`. */
function dbWithMigrations(names) {
  return {
    selectFrom() {
      const builder = {
        select: () => builder,
        orderBy: () => builder,
        execute: async () => names.map((name) => ({ name })),
      };
      return builder;
    },
  };
}

/** A database with no `_migrations` table: the read itself throws (42P01). */
function dbWithoutMigrationsTable() {
  return {
    selectFrom() {
      const builder = {
        select: () => builder,
        orderBy: () => builder,
        execute: async () => {
          const err = new Error('relation "_migrations" does not exist');
          err.code = '42P01';
          throw err;
        },
      };
      return builder;
    },
  };
}

test('a database with no schema at all refuses the boot, naming db:migrate', async () => {
  __setTestDb(dbWithoutMigrationsTable());

  const err = await pendingMigrationsError();
  const all = await listMigrationFiles();
  assert.ok(err, 'expected the boot to be refused');
  assert.match(err, /has no Deckyard schema/);
  assert.match(
    err,
    new RegExp(`${all.length} of ${all.length} migrations`),
    'must count every migration as pending, from the real directory',
  );
  assert.match(err, /First pending: 001_/);
  assert.match(err, /npm run db:migrate/);
  // The symptom it prevents, so the reader recognizes what they were about to
  // debug for themselves.
  assert.match(err, /relation "…" does not exist/);
});

test('a schema behind the migrations on disk refuses the boot and says how far', async () => {
  const all = await listMigrationFiles();
  __setTestDb(dbWithMigrations(all.slice(0, -1)));

  const err = await pendingMigrationsError();
  assert.ok(err, 'expected the boot to be refused');
  assert.match(err, /is behind/, 'a partial schema is behind, not absent');
  assert.match(err, new RegExp(`1 of ${all.length} migrations has not`));
  assert.match(err, new RegExp(`First pending: ${all[all.length - 1]}`));
});

test('a current schema boots', async () => {
  __setTestDb(dbWithMigrations(await listMigrationFiles()));

  assert.equal(await pendingMigrationsError(), null);
});

test('extra rows in _migrations (a rolled-back file) do not refuse the boot', async () => {
  const all = await listMigrationFiles();
  __setTestDb(dbWithMigrations([...all, '999_from_a_newer_deckyard.js']));

  assert.equal(await pendingMigrationsError(), null);
});

test("no database connection at all is not the schema guard's business either", async () => {
  __setTestDb(null);

  assert.equal(await pendingMigrationsError(), null);
});
