import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { __setTestDb } from '../server/db/client.js';
import { strandedFileDataError } from '../server/storage/boot-check.js';

/**
 * Boot guard for the Postgres default: an install that predates the flip has
 * its decks as JSON on disk. Booting Postgres mode against an empty database
 * would show an empty workspace, which reads as data loss. The guard must stop
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
  while (cleanup.length) await fs.rm(cleanup.pop(), { recursive: true, force: true });
});

test('file mode is never blocked, whatever is on disk', async () => {
  const root = await makeDataDir({ decks: 3 });
  cleanup.push(root);
  process.env.STORAGE_MODE = 'file';
  __setTestDb(dbWithPresentations([]));

  assert.equal(await strandedFileDataError(root), null);
});

test('empty database plus decks on disk refuses the boot with both fixes', async () => {
  const root = await makeDataDir({ decks: 2 });
  cleanup.push(root);
  process.env.STORAGE_MODE = 'postgres';
  __setTestDb(dbWithPresentations([]));

  const err = await strandedFileDataError(root);
  assert.ok(err, 'expected the boot to be refused');
  assert.match(err, /2 decks/);
  assert.match(err, /db:import/, 'must name the import command');
  assert.match(err, /STORAGE_MODE=file/, 'must name the stay-on-disk escape hatch');
  assert.match(err, /not been touched/, 'must say the file data is left alone');
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

test('no database connection at all is not this guard\'s business', async () => {
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
