/**
 * Email-template storage against real PostgreSQL.
 *
 * The overrides moved off disk into two tables in migration 058: one row per
 * (type, locale) in `email_templates` (the fields as jsonb), and the instance
 * default locale in the singleton `email_template_settings`. This exercises the
 * facade the admin API drives — the write/read round-trip, the
 * (type, locale) conflict upsert, the delete-on-empty semantics, and the
 * settings singleton — on the database that actually stores them.
 *
 * Both tables are instance-global (no organization foreign key), so no parent
 * rows need seeding; each test just truncates and works from empty.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import { closeTestDb, openTestDb, pgDescribe, truncate } from './helpers/harness.js';
import {
  getEmailTemplates,
  getEmailTemplateOverride,
  getEmailDefaultLocale,
  writeEmailTemplate,
  deleteEmailTemplate,
  updateDefaultLocale,
} from '../../server/storage/email-templates.js';

pgDescribe('email-templates storage (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'email_templates', 'email_template_settings');
  });

  it('reads code defaults from empty tables', async () => {
    const config = await getEmailTemplates();
    assert.deepEqual(config, { defaultLocale: 'en', templates: {} });
    assert.equal(await getEmailDefaultLocale(), 'en');
    assert.equal(await getEmailTemplateOverride(null, 'userInvitation', 'en'), null);
  });

  it('round-trips an override through write and read', async () => {
    await writeEmailTemplate(null, 'userInvitation', 'nl', {
      subject: 'Welkom',
      body: 'Doe mee',
      // whitespace-only and non-string values are dropped by normalization
      greeting: '   ',
      footer: 42,
    });

    const override = await getEmailTemplateOverride(null, 'userInvitation', 'nl');
    assert.deepEqual(override, { subject: 'Welkom', body: 'Doe mee' });

    const config = await getEmailTemplates();
    assert.deepEqual(config.templates, {
      userInvitation: { nl: { subject: 'Welkom', body: 'Doe mee' } },
    });
  });

  it('upserts on the (type, locale) conflict rather than duplicating', async () => {
    await writeEmailTemplate(null, 'userInvitation', 'en', { subject: 'First' });
    await writeEmailTemplate(null, 'userInvitation', 'en', { subject: 'Second', body: 'More' });

    const override = await getEmailTemplateOverride(null, 'userInvitation', 'en');
    assert.deepEqual(override, { subject: 'Second', body: 'More' });

    const count = await db
      .selectFrom('email_templates')
      .select(db.fn.countAll().as('n'))
      .where('type', '=', 'userInvitation')
      .where('locale', '=', 'en')
      .executeTakeFirst();
    assert.equal(Number(count.n), 1);
  });

  it('deletes the row when an override normalizes to no fields', async () => {
    await writeEmailTemplate(null, 'userInvitation', 'en', { subject: 'Set' });
    assert.notEqual(await getEmailTemplateOverride(null, 'userInvitation', 'en'), null);

    // Re-writing with only blanks removes the override (old file semantics).
    await writeEmailTemplate(null, 'userInvitation', 'en', { subject: '  ' });
    assert.equal(await getEmailTemplateOverride(null, 'userInvitation', 'en'), null);
  });

  it('deleteEmailTemplate resets a locale to code defaults', async () => {
    await writeEmailTemplate(null, 'userInvitation', 'en', { subject: 'Set' });
    const config = await deleteEmailTemplate(null, 'userInvitation', 'en');

    assert.equal(await getEmailTemplateOverride(null, 'userInvitation', 'en'), null);
    assert.deepEqual(config.templates, {});
  });

  it('persists the instance default locale as a singleton', async () => {
    await updateDefaultLocale(null, 'de');
    assert.equal(await getEmailDefaultLocale(), 'de');

    // A second update overwrites the same row, not a second one.
    await updateDefaultLocale(null, 'fr');
    assert.equal(await getEmailDefaultLocale(), 'fr');

    const count = await db
      .selectFrom('email_template_settings')
      .select(db.fn.countAll().as('n'))
      .executeTakeFirst();
    assert.equal(Number(count.n), 1);

    const config = await getEmailTemplates();
    assert.equal(config.defaultLocale, 'fr');
  });

  it('rejects an unknown type or locale before touching the database', async () => {
    await assert.rejects(
      () => writeEmailTemplate(null, 'nopeType', 'en', { subject: 'x' }),
      /Invalid template type/
    );
    await assert.rejects(
      () => writeEmailTemplate(null, 'userInvitation', 'xx', { subject: 'x' }),
      /Invalid locale/
    );
    await assert.rejects(() => updateDefaultLocale(null, 'xx'), /Invalid locale/);
  });
});
