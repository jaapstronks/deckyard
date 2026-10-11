/**
 * The weekly digest is opt-in (B662, decision D330).
 *
 * `normalizeDigestPreference()` in server/storage/settings.js read a stored
 * `digest` as "on unless explicitly switched off", and the user-settings
 * defaults said `enabled: true`. While the weekly summary threw on a missing
 * column nobody noticed; repairing that would have mailed every account. Now
 * only an explicit `enabled: true` sends: no settings row, no `digest` key, an
 * empty object or a truthy non-boolean all read as off, through the defaults,
 * the settings read, the settings write and `listDigestRecipients()` alike.
 *
 * This file pins the defaults, the read and the write without a database,
 * through the in-memory Kysely double. Recipient selection is pinned in
 * tests/pg/digest-recipients.pgtest.js: its join (id first, e-mail fallback,
 * `lower(users.email)`) is a callback-form `leftJoin` the double does not
 * model.
 *
 * Run with: node --test tests/digest-opt-in.test.js
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { getDefaultOrganizationId } =
  await import('../server/config/database.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { defaultUserSettings, getUserSettings, writeUserSettings } =
  await import('../server/storage/settings.js');

const ORG = getDefaultOrganizationId();
const MONDAY = 1;

/** One user per case, keyed by the stored `digest` value it carries. */
const CASES = [
  { id: 'u-none', email: 'none@example.com', settings: null },
  { id: 'u-nokey', email: 'nokey@example.com', settings: { privacy: {} } },
  { id: 'u-empty', email: 'empty@example.com', settings: { digest: {} } },
  {
    id: 'u-yes',
    email: 'yes@example.com',
    settings: { digest: { enabled: 'yes', dayOfWeek: MONDAY } },
  },
  {
    id: 'u-on',
    email: 'on@example.com',
    settings: { digest: { enabled: true, dayOfWeek: MONDAY } },
  },
];

function seed() {
  return createFakeDb({
    users: CASES.map((c) => ({
      id: c.id,
      organization_id: ORG,
      email: c.email,
      name: c.id,
      role: 'user',
    })),
    user_settings: CASES.filter((c) => c.settings).map((c) => ({
      user_id: c.id,
      email: c.email,
      settings: c.settings,
    })),
  });
}

afterEach(() => {
  __setTestDb(null);
});

describe('the weekly digest is opt-in (B662, D330)', () => {
  it('the user-settings default is off, on Monday', () => {
    assert.deepEqual(defaultUserSettings().digest, {
      enabled: false,
      dayOfWeek: MONDAY,
    });
  });

  it('reading settings: no digest key, {} and a non-boolean read as off', async () => {
    __setTestDb(seed());
    for (const c of CASES) {
      const { digest } = await getUserSettings(testScope(), c.email);
      assert.equal(
        digest.enabled,
        c.id === 'u-on',
        `${c.email} reads enabled=${digest.enabled}`,
      );
    }
  });

  it('a write without enabled: true does not opt the user in', async () => {
    __setTestDb(seed());
    await writeUserSettings(testScope(), 'none@example.com', {
      digest: { dayOfWeek: 4 },
    });
    const { digest } = await getUserSettings(testScope(), 'none@example.com');
    assert.deepEqual(digest, { enabled: false, dayOfWeek: 4 });
  });

  it('a partial write keeps an opted-in user opted in', async () => {
    __setTestDb(seed());
    await writeUserSettings(testScope(), 'on@example.com', {
      digest: { dayOfWeek: 4 },
    });
    const { digest } = await getUserSettings(testScope(), 'on@example.com');
    assert.deepEqual(digest, { enabled: true, dayOfWeek: 4 });
  });
});
