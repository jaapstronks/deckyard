/**
 * The `user_settings` re-key onto `users.id` (T10, PR E).
 *
 * Migration 059 keyed this table on the e-mail in its own column *on purpose*,
 * so that the identity epic's re-key would be one UPDATE per row rather than a
 * table rewrite. Migration 067 is that re-key, and
 * `server/storage/settings.js` now reads and writes with the stable id
 * leading and the e-mail as fallback.
 *
 * What this file pins, and why each case needs a real database:
 *
 *   - **a known user's settings carry their `users.id`** — the fake double
 *     enforces no foreign key and would accept a wrong value silently;
 *   - **a renamed user keeps their settings** — the klaar-als for this PR, and
 *     the one behaviour the e-mail key could never give. This is an UPDATE
 *     matched on `user_id` while the row's stored `email` still says something
 *     else, so it exercises exactly the "DO UPDATE that matches no row" class
 *     the pg suite exists for (tests/pg/helpers/harness.js);
 *   - **the external path stays NULL and keeps working** — the anonymous
 *     bucket and an address with no `users` row, which is every row in file
 *     mode;
 *   - **a legacy row picks up its id on the first write** — the self-healing
 *     half of the dual key, on a row shaped the way migration 059's disk
 *     import left it;
 *   - **the unique partial index** — two rows may share a NULL `user_id`, none
 *     may share a real one. The double models no indexes at all.
 *
 * Runs only against a throwaway database named by DATABASE_URL — see
 * tests/pg/helpers/harness.js and docs/developer/pg-test-suite.md.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import { closeTestDb, openTestDb, pgDescribe, truncate } from './helpers/harness.js';
import { getUserSettings, writeUserSettings } from '../../server/storage/settings.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';
import { testScope } from '../helpers/storage-scope.js';

const ORG = getDefaultOrganizationId();

const ALICE_ID = '11111111-1111-1111-1111-111111111111';
const ALICE_EMAIL = 'alice@example.com';
const ALICE_NEW_EMAIL = 'alice.renamed@example.com';
const BOB_ID = '22222222-2222-2222-2222-222222222222';
const BOB_EMAIL = 'bob@example.com';
const EXTERNAL_EMAIL = 'nobody@example.com';

pgDescribe('user_settings on users.id (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'user_settings', 'organizations');
    await db.insertInto('organizations').values({ id: ORG, name: 'Default', slug: 'default' }).execute();
    await db
      .insertInto('users')
      .values([
        { id: ALICE_ID, organization_id: ORG, email: ALICE_EMAIL, name: 'Alice', role: 'user' },
        { id: BOB_ID, organization_id: ORG, email: BOB_EMAIL, name: 'Bob', role: 'user' },
      ])
      .execute();
  });

  /** Every stored row, so a test can assert there is exactly one. */
  async function rows() {
    return db.selectFrom('user_settings').select(['email', 'user_id']).orderBy('email').execute();
  }

  /** Rename a `users` row the way an account e-mail change does. */
  async function renameUser(id, email) {
    await db.updateTable('users').set({ email }).where('id', '=', id).execute();
  }

  it("stamps a known user's stable users.id on write", async () => {
    await writeUserSettings(testScope(), ALICE_EMAIL, { uiLocale: 'nl' });

    assert.deepEqual(await rows(), [{ email: ALICE_EMAIL, user_id: ALICE_ID }]);
    assert.equal((await getUserSettings(testScope(), ALICE_EMAIL)).uiLocale, 'nl');
  });

  it('a renamed user keeps their settings', async () => {
    await writeUserSettings(testScope(), ALICE_EMAIL, {
      uiLocale: 'nl',
      highlighter: { color: '#00ff00', thickness: 7 },
    });

    await renameUser(ALICE_ID, ALICE_NEW_EMAIL);

    // The whole point of the re-key: the address changed, the person did not.
    const after = await getUserSettings(testScope(), ALICE_NEW_EMAIL);
    assert.equal(after.uiLocale, 'nl');
    assert.equal(after.highlighter.color, '#00ff00');
    assert.equal(after.highlighter.thickness, 7);
  });

  it('a write after a rename re-stamps the e-mail on the same row', async () => {
    await writeUserSettings(testScope(), ALICE_EMAIL, { uiLocale: 'nl' });
    await renameUser(ALICE_ID, ALICE_NEW_EMAIL);
    await writeUserSettings(testScope(), ALICE_NEW_EMAIL, { digest: { dayOfWeek: 4 } });

    // One row, not two: matched on user_id, with its e-mail column brought
    // back in step so the id and the address never drift apart.
    assert.deepEqual(await rows(), [{ email: ALICE_NEW_EMAIL, user_id: ALICE_ID }]);

    const merged = await getUserSettings(testScope(), ALICE_NEW_EMAIL);
    assert.equal(merged.uiLocale, 'nl', 'the partial write merged onto the stored value');
    assert.equal(merged.digest.dayOfWeek, 4);
  });

  it('the old address no longer answers after a rename', async () => {
    await writeUserSettings(testScope(), ALICE_EMAIL, { uiLocale: 'nl' });
    await renameUser(ALICE_ID, ALICE_NEW_EMAIL);
    await writeUserSettings(testScope(), ALICE_NEW_EMAIL, { uiLocale: 'nl' });

    // The address is nobody's now, so it reads the code defaults rather than
    // handing a stranger the previous holder's preferences.
    assert.equal((await getUserSettings(testScope(), ALICE_EMAIL)).uiLocale, 'en');
  });

  it('an address with no users row stays external, with a NULL id', async () => {
    await writeUserSettings(testScope(), EXTERNAL_EMAIL, { uiLocale: 'nl' });

    assert.deepEqual(await rows(), [{ email: EXTERNAL_EMAIL, user_id: null }]);
    assert.equal((await getUserSettings(testScope(), EXTERNAL_EMAIL)).uiLocale, 'nl');
  });

  it('the anonymous bucket is not a person and never takes an id', async () => {
    await writeUserSettings(testScope(), '', { uiLocale: 'nl' });

    assert.deepEqual(await rows(), [{ email: 'anonymous', user_id: null }]);
    assert.equal((await getUserSettings(testScope(), null)).uiLocale, 'nl');
  });

  it('a legacy e-mail-keyed row picks up its id on the first write', async () => {
    // The shape migration 059's disk import leaves behind: an e-mail key and
    // no id, written before 067's backfill ever ran.
    await db
      .insertInto('user_settings')
      .values({ email: BOB_EMAIL, user_id: null, settings: JSON.stringify({ uiLocale: 'nl' }) })
      .execute();

    assert.equal((await getUserSettings(testScope(), BOB_EMAIL)).uiLocale, 'nl', 'read still finds it');

    await writeUserSettings(testScope(), BOB_EMAIL, { digest: { dayOfWeek: 3 } });

    assert.deepEqual(await rows(), [{ email: BOB_EMAIL, user_id: BOB_ID }], 'adopted, not duplicated');
    const merged = await getUserSettings(testScope(), BOB_EMAIL);
    assert.equal(merged.uiLocale, 'nl', 'and the legacy value survived the adoption');
    assert.equal(merged.digest.dayOfWeek, 3);
  });

  it('two people never share an id, but any number may share a NULL', async () => {
    await writeUserSettings(testScope(), ALICE_EMAIL, { uiLocale: 'nl' });
    await writeUserSettings(testScope(), BOB_EMAIL, { uiLocale: 'nl' });
    await writeUserSettings(testScope(), EXTERNAL_EMAIL, { uiLocale: 'nl' });
    await writeUserSettings(testScope(), '', { uiLocale: 'nl' });

    assert.deepEqual(await rows(), [
      { email: ALICE_EMAIL, user_id: ALICE_ID },
      { email: 'anonymous', user_id: null },
      { email: BOB_EMAIL, user_id: BOB_ID },
      { email: EXTERNAL_EMAIL, user_id: null },
    ]);

    // The unique partial index from migration 067 is what makes "read this
    // person's settings" unambiguous.
    await assert.rejects(
      db
        .insertInto('user_settings')
        .values({ email: 'clone@example.com', user_id: ALICE_ID, settings: JSON.stringify({}) })
        .execute(),
      /idx_user_settings_user_id|duplicate key/i
    );
  });

  it('deleting the user keeps the settings row, id dropped', async () => {
    await writeUserSettings(testScope(), BOB_EMAIL, { uiLocale: 'nl' });
    await db.deleteFrom('users').where('id', '=', BOB_ID).execute();

    // ON DELETE SET NULL, not CASCADE: losing the account must not silently
    // delete what the person stored.
    assert.deepEqual(await rows(), [{ email: BOB_EMAIL, user_id: null }]);
    assert.equal((await getUserSettings(testScope(), BOB_EMAIL)).uiLocale, 'nl');
  });
});
