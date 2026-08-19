/**
 * The one-time email-template import (058) is idempotent and non-destructive:
 * running it twice imports each on-disk override exactly once and never
 * overwrites an existing row. It reads the pre-Postgres file layout
 * (data/email-templates.json) and keeps doing so after the file backend's
 * removal — it is part of the import path for old data directories.
 *
 * This drives {@link importEmailTemplatesFromDisk} directly (not `up`) so the
 * test need not model the schema DDL: a minimal fake db that records inserts
 * and honours `ON CONFLICT DO NOTHING` is enough to observe the semantics.
 *
 * Run with: node --test tests/email-templates-import-migration.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * A minimal fake of the Kysely insert builder covering exactly the calls the
 * import makes: insertInto(...).values(...).onConflict(...).execute(). Keeps
 * template rows keyed by (type, locale) and the settings singleton, applying
 * DO NOTHING so idempotency (skip-if-exists) is observable. jsonb fields are
 * inserted as a JSON string, exactly as the driver receives them.
 */
function makeFakeDb() {
  const templates = new Map(); // `${type}\u0000${locale}` -> parsed fields
  const settings = new Map(); // 'singleton' -> default_locale
  let insertCount = 0;

  function insertInto(table) {
    let pending = null;
    const builder = {
      values(row) {
        pending = row;
        return builder;
      },
      onConflict() {
        // Every conflict target in this migration is DO NOTHING; the execute()
        // below models that by skipping when the key already exists.
        return builder;
      },
      async execute() {
        if (table === 'email_templates') {
          const key = `${pending.type}\u0000${pending.locale}`;
          if (!templates.has(key)) {
            templates.set(key, JSON.parse(pending.fields));
            insertCount += 1;
          }
        } else if (table === 'email_template_settings') {
          if (!settings.has('singleton')) {
            settings.set('singleton', pending.default_locale);
            insertCount += 1;
          }
        }
      },
    };
    return builder;
  }

  return {
    db: { insertInto },
    templates,
    settings,
    get insertCount() {
      return insertCount;
    },
  };
}

describe('058 email-templates import migration', () => {
  const tmpDataDir = path.join(
    os.tmpdir(),
    `deckyard-email-migrate-${crypto.randomUUID()}`,
  );
  let migration;

  before(async () => {
    process.env.DATA_DIR = tmpDataDir;
    await fs.mkdir(tmpDataDir, { recursive: true });

    const config = {
      defaultLocale: 'nl',
      templates: {
        userInvitation: {
          en: { subject: 'Welcome', body: 'Join us' },
          nl: { subject: 'Welkom' },
        },
        // Empty override -> must be skipped, not imported as an empty row.
        magicLink: {
          en: { subject: '   ' },
        },
      },
    };
    await fs.writeFile(
      path.join(tmpDataDir, 'email-templates.json'),
      JSON.stringify(config, null, 2),
    );

    migration =
      await import('../server/db/migrations/058_email_templates_to_table.js');
  });

  after(async () => {
    await fs.rm(tmpDataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('imports each non-empty override once and the default locale, idempotently', async () => {
    const fake = makeFakeDb();

    const first = await migration.importEmailTemplatesFromDisk(fake.db);
    assert.strictEqual(first.templates, 2, 'two non-empty overrides imported');
    assert.strictEqual(first.defaultLocale, true);
    assert.strictEqual(fake.templates.size, 2);
    assert.deepStrictEqual(fake.templates.get('userInvitation\u0000en'), {
      subject: 'Welcome',
      body: 'Join us',
    });
    assert.deepStrictEqual(fake.templates.get('userInvitation\u0000nl'), {
      subject: 'Welkom',
    });
    // The whitespace-only magicLink override normalizes to nothing -> no row.
    assert.ok(
      !fake.templates.has('magicLink\u0000en'),
      'empty override skipped',
    );
    assert.strictEqual(fake.settings.get('singleton'), 'nl');

    const insertsAfterFirst = fake.insertCount;

    // Second run imports nothing new and never overwrites.
    await migration.importEmailTemplatesFromDisk(fake.db);
    assert.strictEqual(
      fake.insertCount,
      insertsAfterFirst,
      'second run imported no new rows',
    );
    assert.strictEqual(fake.templates.size, 2);
    assert.strictEqual(fake.settings.get('singleton'), 'nl');
  });

  it('is a no-op when email-templates.json is absent', async () => {
    const missingDir = path.join(
      os.tmpdir(),
      `deckyard-email-missing-${crypto.randomUUID()}`,
    );
    process.env.DATA_DIR = missingDir;
    const fake = makeFakeDb();

    const result = await migration.importEmailTemplatesFromDisk(fake.db); // must not throw
    assert.strictEqual(result.templates, 0);
    assert.strictEqual(result.defaultLocale, false);
    assert.strictEqual(fake.insertCount, 0);

    process.env.DATA_DIR = tmpDataDir;
  });
});
