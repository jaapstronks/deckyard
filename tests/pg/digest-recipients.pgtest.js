/**
 * The digest job reads the preference Settings > Preferences writes (B407).
 *
 * The job used to read `users.settings`, a column nothing writes a `digest`
 * into since migration 059 moved preferences to `user_settings`. So switching
 * the digest off, or picking a day, did nothing: every account got the
 * default, on and on Monday. `listDigestRecipients()` now reads the same row
 * `getUserSettings()` reads, through the same dual key (id first, e-mail as
 * fallback), and this file pins that on a real join.
 *
 * Sunday is day 0, which a `|| 1` in the preferences form used to turn into
 * Monday; the round-trip case pins that 0 survives the write and selects the
 * account on a Sunday.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import {
  listDigestRecipients,
  writeUserSettings,
} from '../../server/storage/settings.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';
import { testScope } from '../helpers/storage-scope.js';

const ORG = getDefaultOrganizationId();

const ALICE_ID = '11111111-1111-1111-1111-111111111111';
const ALICE_EMAIL = 'alice@example.com';
const BOB_ID = '22222222-2222-2222-2222-222222222222';
const BOB_EMAIL = 'bob@example.com';

const SUNDAY = 0;
const MONDAY = 1;
const THURSDAY = 4;

pgDescribe('digest recipients from user_settings (real PostgreSQL)', () => {
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
    await db
      .insertInto('organizations')
      .values({ id: ORG, name: 'Default', slug: 'default' })
      .execute();
    await db
      .insertInto('users')
      .values([
        {
          id: ALICE_ID,
          organization_id: ORG,
          email: ALICE_EMAIL,
          name: 'Alice',
          role: 'user',
        },
        {
          id: BOB_ID,
          organization_id: ORG,
          email: BOB_EMAIL,
          name: 'Bob',
          role: 'admin',
        },
      ])
      .execute();
  });

  /** The e-mails due on `day`, sorted, so a case reads as one assertion. */
  async function dueOn(day) {
    const users = await listDigestRecipients(testScope(), day);
    return users.map((u) => u.email).sort();
  }

  it('an account without a settings row gets the default: on, Monday', async () => {
    assert.deepEqual(await dueOn(MONDAY), [ALICE_EMAIL, BOB_EMAIL]);
    assert.deepEqual(await dueOn(THURSDAY), []);
  });

  it('a digest switched off in Preferences is not sent', async () => {
    await writeUserSettings(testScope(), ALICE_EMAIL, {
      digest: { enabled: false, dayOfWeek: MONDAY },
    });

    assert.deepEqual(await dueOn(MONDAY), [BOB_EMAIL]);
  });

  it('the chosen day moves the digest to that day', async () => {
    await writeUserSettings(testScope(), ALICE_EMAIL, {
      digest: { enabled: true, dayOfWeek: THURSDAY },
    });

    assert.deepEqual(await dueOn(MONDAY), [BOB_EMAIL]);
    assert.deepEqual(await dueOn(THURSDAY), [ALICE_EMAIL]);
  });

  it('Sunday (0) is stored as Sunday and sends on Sunday', async () => {
    await writeUserSettings(testScope(), ALICE_EMAIL, {
      digest: { enabled: true, dayOfWeek: SUNDAY },
    });

    assert.deepEqual(await dueOn(SUNDAY), [ALICE_EMAIL]);
    assert.deepEqual(await dueOn(MONDAY), [BOB_EMAIL]);
  });

  it('carries id, e-mail, organization and role for the job', async () => {
    const [bob] = await listDigestRecipients(testScope(), MONDAY).then((us) =>
      us.filter((u) => u.id === BOB_ID),
    );
    assert.deepEqual(bob, {
      id: BOB_ID,
      email: BOB_EMAIL,
      organizationId: ORG,
      role: 'admin',
    });
  });

  it('a legacy e-mail-keyed row counts, and the id-keyed row wins over it', async () => {
    // A row shaped the way migration 059's disk import left it: no user_id.
    await db
      .insertInto('user_settings')
      .values({
        email: ALICE_EMAIL,
        user_id: null,
        settings: JSON.stringify({ digest: { enabled: false } }),
      })
      .execute();
    assert.deepEqual(await dueOn(MONDAY), [BOB_EMAIL]);

    // Bob has both an id-less orphan and his own id row; one digest, by the id row.
    await db
      .insertInto('user_settings')
      .values([
        {
          email: 'bob.old@example.com',
          user_id: BOB_ID,
          settings: JSON.stringify({ digest: { dayOfWeek: THURSDAY } }),
        },
        {
          email: BOB_EMAIL,
          user_id: null,
          settings: JSON.stringify({ digest: { dayOfWeek: MONDAY } }),
        },
      ])
      .execute();
    assert.deepEqual(await dueOn(MONDAY), []);
    assert.deepEqual(await dueOn(THURSDAY), [BOB_EMAIL]);
  });
});
