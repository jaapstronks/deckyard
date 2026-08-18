/**
 * `setYDocState` / `getYDocState` against real PostgreSQL, through the facade.
 *
 * The collab Y.Doc binary lives in `presentation_ydocs.state` (`bytea`) and is
 * upserted with ON CONFLICT (presentation_id) DO UPDATE
 * (server/storage/presentations/ydocs.js). Two things the in-memory
 * double cannot prove:
 *  - the `bytea` round-trip: bytes go in as a `Uint8Array`, are stored via
 *    `Buffer.from(state)`, and must come back byte-for-byte as a `Uint8Array`
 *    — a real driver, not a hand-rolled JS value that never left the process;
 *  - the conflict target is the `presentation_id` PRIMARY KEY (migration 040),
 *    so a second write to the same deck replaces the blob in place.
 *
 * It runs through the public facade (server/storage/presentations/ydocs.js) in
 * `STORAGE_MODE=postgres`, the same path the collab server uses.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  deleteYDocState,
  getYDocState,
  setYDocState,
} from '../../server/storage/presentations/ydocs.js';

const storageScope = testScope();

pgDescribe('presentation Y.Doc state (real PostgreSQL, via facade)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let pid;

  const countRows = async () => {
    const row = await db
      .selectFrom('presentation_ydocs')
      .select(db.fn.countAll().as('n'))
      .where('presentation_id', '=', pid)
      .executeTakeFirst();
    return Number(row.n);
  };

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    pid = await seedPresentation(db);
  });

  it('returns null before any state is stored', async () => {
    assert.equal(await getYDocState(storageScope, pid), null);
  });

  it('round-trips the bytea payload byte-for-byte', async () => {
    const state = new Uint8Array([0, 1, 2, 253, 254, 255]);
    assert.equal(await setYDocState(storageScope, pid, state), true);

    const read = await getYDocState(storageScope, pid);
    assert.ok(read instanceof Uint8Array, 'reads back as a Uint8Array');
    assert.deepEqual([...read], [...state]);
  });

  it('replaces the blob in place on the presentation_id conflict', async () => {
    await setYDocState(storageScope, pid, new Uint8Array([1, 1, 1]));
    await setYDocState(storageScope, pid, new Uint8Array([9, 8, 7, 6]));

    const read = await getYDocState(storageScope, pid);
    assert.deepEqual([...read], [9, 8, 7, 6], 'the second write wins');
    assert.equal(await countRows(), 1, 'exactly one row per deck');
  });

  it('deletes the stored state', async () => {
    await setYDocState(storageScope, pid, new Uint8Array([1, 2, 3]));
    assert.equal(await deleteYDocState(storageScope, pid), true);

    assert.equal(await getYDocState(storageScope, pid), null);
    assert.equal(await countRows(), 0);
  });
});
