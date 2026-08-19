/**
 * The one-time settings import (059) is idempotent and non-destructive: running
 * it twice imports the instance settings and each user's settings exactly once
 * and never overwrites an existing row. It reads the pre-Postgres file layout
 * (data/settings.json + data/user-settings/<email-slug>.json) and keeps doing
 * so after the file backend's removal — it is part of the import path for old
 * data directories.
 *
 * The user-settings filename is an irreversible slug of the e-mail, and the
 * file body never stored the e-mail, so the import recovers each real e-mail by
 * slugging every known `users.email` and looking for its file. This test drives
 * the two importers directly (not `up`) against a temp `DATA_DIR` and a fake db
 * that records inserts and honours `ON CONFLICT DO NOTHING`.
 *
 * Run with: node --test tests/settings-import-migration.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * A minimal fake covering the calls the import makes:
 * insertInto(...).values(...).onConflict(...).execute(), plus a canned
 * selectFrom('users').select(['email']).execute() so the user-settings importer
 * can slug real e-mails. DO NOTHING is modelled by skipping when the key exists.
 */
function makeFakeDb(users = []) {
  const app = new Map(); // 'singleton' -> settings object
  const userRows = new Map(); // email -> settings object
  let insertCount = 0;

  function insertInto(table) {
    let pending = null;
    const builder = {
      values(row) {
        pending = row;
        return builder;
      },
      onConflict() {
        return builder;
      },
      async execute() {
        if (table === 'app_settings') {
          if (!app.has('singleton')) {
            app.set('singleton', JSON.parse(pending.settings));
            insertCount += 1;
          }
        } else if (table === 'user_settings') {
          if (!userRows.has(pending.email)) {
            userRows.set(pending.email, JSON.parse(pending.settings));
            insertCount += 1;
          }
        }
      },
    };
    return builder;
  }

  function selectFrom(table) {
    return {
      select() {
        return {
          async execute() {
            return table === 'users' ? users.map((email) => ({ email })) : [];
          },
        };
      },
    };
  }

  return {
    db: { insertInto, selectFrom },
    app,
    userRows,
    get insertCount() {
      return insertCount;
    },
  };
}

describe('059 settings import migration', () => {
  const tmpDataDir = path.join(
    os.tmpdir(),
    `deckyard-settings-migrate-${crypto.randomUUID()}`,
  );
  let migration;

  before(async () => {
    process.env.DATA_DIR = tmpDataDir;
    await fs.mkdir(path.join(tmpDataDir, 'user-settings'), { recursive: true });

    await fs.writeFile(
      path.join(tmpDataDir, 'settings.json'),
      JSON.stringify({
        sessionDurationDays: 45,
        webhooks: { commentCreatedUrl: 'https://x.test/h' },
      }),
    );

    // jaap@ciiic.nl -> 'jaap at ciiic dot nl' -> safeSlug -> 'jaap-at-ciiic-dot-nl'
    await fs.writeFile(
      path.join(tmpDataDir, 'user-settings', 'jaap-at-ciiic-dot-nl.json'),
      JSON.stringify({ uiLocale: 'nl', profile: { name: 'Jaap' } }),
    );
    // A file whose user is NOT in the users table -> must be skipped (orphan).
    await fs.writeFile(
      path.join(tmpDataDir, 'user-settings', 'ghost-at-nowhere-dot-test.json'),
      JSON.stringify({ uiLocale: 'de' }),
    );

    migration =
      await import('../server/db/migrations/059_settings_to_tables.js');
  });

  after(async () => {
    await fs.rm(tmpDataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('imports the instance settings once, idempotently', async () => {
    const fake = makeFakeDb();

    const first = await migration.importAppSettingsFromDisk(fake.db);
    assert.strictEqual(first.app, true);
    assert.deepStrictEqual(fake.app.get('singleton'), {
      sessionDurationDays: 45,
      webhooks: { commentCreatedUrl: 'https://x.test/h' },
    });

    const after = fake.insertCount;
    await migration.importAppSettingsFromDisk(fake.db);
    assert.strictEqual(
      fake.insertCount,
      after,
      'second run imported no new rows',
    );
  });

  it('recovers each real e-mail via the users table, skipping orphan files', async () => {
    // Mixed-case + whitespace e-mail proves the importer normalizes before slugging.
    const fake = makeFakeDb(['  Jaap@Ciiic.nl ']);

    const result = await migration.importUserSettingsFromDisk(fake.db);
    assert.strictEqual(result.users, 1, 'one matching user imported');
    assert.strictEqual(fake.userRows.size, 1);
    assert.deepStrictEqual(fake.userRows.get('jaap@ciiic.nl'), {
      uiLocale: 'nl',
      profile: { name: 'Jaap' },
    });
    // The orphan file (no matching user) was never read.
    assert.ok(!fake.userRows.has('ghost@nowhere.test'));

    // Idempotent second run.
    const before = fake.insertCount;
    await migration.importUserSettingsFromDisk(fake.db);
    assert.strictEqual(
      fake.insertCount,
      before,
      'second run imported no new rows',
    );
  });

  it('is a no-op when the data files are absent', async () => {
    const missingDir = path.join(
      os.tmpdir(),
      `deckyard-settings-missing-${crypto.randomUUID()}`,
    );
    process.env.DATA_DIR = missingDir;
    const fake = makeFakeDb(['jaap@ciiic.nl']);

    const app = await migration.importAppSettingsFromDisk(fake.db); // must not throw
    const users = await migration.importUserSettingsFromDisk(fake.db);
    assert.strictEqual(app.app, false);
    assert.strictEqual(users.users, 0);
    assert.strictEqual(fake.insertCount, 0);

    process.env.DATA_DIR = tmpDataDir;
  });
});
