/**
 * Instance + per-user settings storage against real PostgreSQL.
 *
 * The settings moved off disk into two tables in migration 059: the whole
 * instance settings object as one jsonb bag in the singleton `app_settings`
 * row, and each user's preferences as one jsonb bag in `user_settings`, keyed
 * on the e-mail in its own column. This exercises the facade the settings and
 * profile APIs drive — the write/read round-trip, the singleton upsert, the
 * per-e-mail upsert, and partial-write merge semantics — on the database that
 * actually stores them.
 *
 * Both tables are instance-global (no organization foreign key), so no parent
 * rows need seeding; each test truncates and works from empty. An empty table
 * must read back as the code defaults, exactly as an absent file did.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import { closeTestDb, openTestDb, pgDescribe, truncate } from './helpers/harness.js';
import {
  getAppSettings,
  writeAppSettings,
  getUserSettings,
  writeUserSettings,
  getDefaultThemeId,
  defaultAppSettings,
  defaultUserSettings,
} from '../../server/storage/settings.js';
import { DEFAULT_THEME_ID } from '../../shared/constants/themes.js';

pgDescribe('settings storage (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'app_settings', 'user_settings');
  });

  it('reads code defaults from an empty app_settings', async () => {
    assert.deepEqual(await getAppSettings(), defaultAppSettings());
  });

  it('round-trips app settings and persists as a single row', async () => {
    await writeAppSettings(null, { sessionDurationDays: 45 });
    assert.equal((await getAppSettings()).sessionDurationDays, 45);

    // A second write overwrites the same singleton row, not a second one.
    await writeAppSettings(null, { sessionDurationDays: 60 });
    assert.equal((await getAppSettings()).sessionDurationDays, 60);

    const count = await db
      .selectFrom('app_settings')
      .select(db.fn.countAll().as('n'))
      .executeTakeFirst();
    assert.equal(Number(count.n), 1);
  });

  it('merges a partial app-settings write onto the stored value', async () => {
    await writeAppSettings(null, { sessionDurationDays: 45 });
    await writeAppSettings(null, {
      webhooks: { commentCreatedUrl: 'https://example.com/hook' },
    });

    const settings = await getAppSettings();
    // The webhook landed...
    assert.equal(settings.webhooks.commentCreatedUrl, 'https://example.com/hook');
    // ...and the earlier field survived the partial write.
    assert.equal(settings.sessionDurationDays, 45);
  });

  it('round-trips the organization theme and normalizes an invalid id to empty', async () => {
    await writeAppSettings(null, {
      defaultThemeId: 'clicknl',
      enabledThemes: ['deckyard', 'clicknl'],
    });
    let s = await getAppSettings();
    assert.equal(s.defaultThemeId, 'clicknl');
    assert.deepEqual(s.enabledThemes, ['deckyard', 'clicknl']);

    // getDefaultThemeId prefers the stored setting over env/built-in.
    delete process.env.DEFAULT_THEME;
    assert.equal(await getDefaultThemeId(), 'clicknl');

    // An invalid id normalizes to empty, then falls back to the built-in default.
    await writeAppSettings(null, { defaultThemeId: 'bad id!!' });
    s = await getAppSettings();
    assert.equal(s.defaultThemeId, '');
    assert.equal(await getDefaultThemeId(), DEFAULT_THEME_ID);
  });

  it('keeps a stock-media source a partial write does not mention', async () => {
    assert.equal((await getAppSettings()).stockMedia.bundled.enabled, false);

    await writeAppSettings(null, {
      stockMedia: { bundled: { enabled: true }, unsplash: { enabled: true } },
    });
    // A client that only knows about Giphy must not switch the other two off.
    const after = await writeAppSettings(null, {
      stockMedia: { giphy: { enabled: true } },
    });
    assert.equal(after.stockMedia.bundled.enabled, true);
    assert.equal(after.stockMedia.unsplash.enabled, true);
    assert.equal(after.stockMedia.giphy.enabled, true);
    // And the merge is durable, not just in the return value.
    assert.equal((await getAppSettings()).stockMedia.bundled.enabled, true);
  });

  // The dead internal/external analytics chain was removed. A settings bag that
  // still carries its keys (team-policy, external-viewer toggle, digest team
  // stat) must read back clean and, on the next write, not be persisted again —
  // store-raw / normalize-on-read, "ignored, not migrated". See
  // docs/plans/done/decisions.md § analytics-privacy-naden.
  it('ignores legacy internal/external analytics keys and does not write them back', async () => {
    // Seed the raw jsonb directly, bypassing the write path's normalization so
    // the legacy keys really are stored.
    await db
      .insertInto('app_settings')
      .values({
        id: true,
        settings: JSON.stringify({
          analytics: {
            enabled: true,
            teamAnalytics: { policy: 'opt-in-detailed', allowDetailedOptIn: false },
            externalAnalytics: { enabled: false },
            retention: { sessionDataDays: 90, ipAnonymizationDays: 7 },
          },
        }),
      })
      .execute();

    // Read back: the legacy sub-objects are gone, the master switch survives.
    const read = await getAppSettings();
    assert.equal(read.analytics.enabled, true);
    assert.equal('teamAnalytics' in read.analytics, false);
    assert.equal('externalAnalytics' in read.analytics, false);

    // A later write must not resurrect them in the stored bag.
    await writeAppSettings(null, { sessionDurationDays: 45 });
    const row = await db
      .selectFrom('app_settings')
      .select('settings')
      .executeTakeFirst();
    const stored = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
    assert.equal('teamAnalytics' in stored.analytics, false);
    assert.equal('externalAnalytics' in stored.analytics, false);
  });

  it('ignores a legacy digest.includeTeamAnalytics on a user settings bag', async () => {
    await db
      .insertInto('user_settings')
      .values({
        email: 'legacy@example.com',
        settings: JSON.stringify({
          digest: { enabled: true, dayOfWeek: 3, includeTeamAnalytics: false },
        }),
      })
      .execute();

    const read = await getUserSettings(null, 'legacy@example.com');
    assert.equal(read.digest.enabled, true);
    assert.equal(read.digest.dayOfWeek, 3);
    assert.equal('includeTeamAnalytics' in read.digest, false);

    // A later write does not persist the dropped key.
    await writeUserSettings(null, 'legacy@example.com', { uiLocale: 'nl' });
    const row = await db
      .selectFrom('user_settings')
      .select('settings')
      .where('email', '=', 'legacy@example.com')
      .executeTakeFirst();
    const stored = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
    assert.equal('includeTeamAnalytics' in stored.digest, false);
  });

  it('reads code defaults from an empty user_settings', async () => {
    assert.deepEqual(await getUserSettings(null, 'jaap@ciiic.nl'), defaultUserSettings());
  });

  it('round-trips user settings keyed on the e-mail, case-insensitively', async () => {
    await writeUserSettings(null, 'Jaap@Ciiic.nl', {
      uiLocale: 'nl',
      profile: { name: 'Jaap' },
    });

    // Looked up by a differently-cased spelling of the same address.
    const read = await getUserSettings(null, 'jaap@ciiic.nl');
    assert.equal(read.uiLocale, 'nl');
    assert.equal(read.profile.name, 'Jaap');

    // Stored under the normalized (lowercased) e-mail, one row.
    const row = await db
      .selectFrom('user_settings')
      .select('email')
      .executeTakeFirst();
    assert.equal(row.email, 'jaap@ciiic.nl');

    const count = await db
      .selectFrom('user_settings')
      .select(db.fn.countAll().as('n'))
      .executeTakeFirst();
    assert.equal(Number(count.n), 1);
  });

  it('keeps different users in separate rows', async () => {
    await writeUserSettings(null, 'a@x.test', { uiLocale: 'nl' });
    await writeUserSettings(null, 'b@x.test', { uiLocale: 'en' });

    assert.equal((await getUserSettings(null, 'a@x.test')).uiLocale, 'nl');
    assert.equal((await getUserSettings(null, 'b@x.test')).uiLocale, 'en');

    const count = await db
      .selectFrom('user_settings')
      .select(db.fn.countAll().as('n'))
      .executeTakeFirst();
    assert.equal(Number(count.n), 2);
  });

  it('merges a partial user-settings write onto the stored value', async () => {
    await writeUserSettings(null, 'jaap@ciiic.nl', {
      profile: { name: 'Jaap' },
      highlighter: { color: '#00ff00' },
    });
    // Update only the locale; name and highlighter must survive.
    await writeUserSettings(null, 'jaap@ciiic.nl', { uiLocale: 'nl' });

    const read = await getUserSettings(null, 'jaap@ciiic.nl');
    assert.equal(read.uiLocale, 'nl');
    assert.equal(read.profile.name, 'Jaap');
    assert.equal(read.highlighter.color, '#00ff00');
  });

  // A partial write (an API consumer PUTting one preference) must not reset the
  // other stored opt-outs — per-key for emailByType, and the channel booleans.
  it('a partial emailByType write keeps other stored opt-outs', async () => {
    await writeUserSettings(null, 'merge@example.com', {
      notifications: { emailByType: { comment_reply: false } },
    });
    await writeUserSettings(null, 'merge@example.com', {
      notifications: { emailByType: { comment_created: false } },
    });

    const s = await getUserSettings(null, 'merge@example.com');
    assert.equal(s.notifications.emailByType.comment_created, false);
    assert.equal(s.notifications.emailByType.comment_reply, false);
    assert.equal(s.notifications.emailByType.comment_mention, true);
  });

  it('a partial notifications write keeps channel opt-outs and defaultLevel', async () => {
    await writeUserSettings(null, 'merge@example.com', {
      notifications: { emailEnabled: false, defaultLevel: 'watching' },
    });
    await writeUserSettings(null, 'merge@example.com', {
      notifications: { slackEnabled: false },
    });

    const s = await getUserSettings(null, 'merge@example.com');
    assert.equal(s.notifications.emailEnabled, false);
    assert.equal(s.notifications.slackEnabled, false);
    assert.equal(s.notifications.defaultLevel, 'watching');
  });
});
