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

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import {
  getAppSettings,
  writeAppSettings,
  getUserSettings,
  writeUserSettings,
  getDefaultThemeId,
  getEnabledThemeIds,
  defaultAppSettings,
  defaultUserSettings,
} from '../../server/storage/settings.js';
import { DEFAULT_THEME_ID } from '../../shared/constants/themes.js';
import { testScope } from '../helpers/storage-scope.js';

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
    assert.deepEqual(await getAppSettings(testScope()), defaultAppSettings());
  });

  it('round-trips app settings and persists as a single row', async () => {
    await writeAppSettings(testScope(), { sessionDurationDays: 45 });
    assert.equal((await getAppSettings(testScope())).sessionDurationDays, 45);

    // A second write overwrites the same singleton row, not a second one.
    await writeAppSettings(testScope(), { sessionDurationDays: 60 });
    assert.equal((await getAppSettings(testScope())).sessionDurationDays, 60);

    const count = await db
      .selectFrom('app_settings')
      .select(db.fn.countAll().as('n'))
      .executeTakeFirst();
    assert.equal(Number(count.n), 1);
  });

  it('merges a partial app-settings write onto the stored value', async () => {
    await writeAppSettings(testScope(), { sessionDurationDays: 45 });
    await writeAppSettings(testScope(), {
      webhooks: { commentCreatedUrl: 'https://example.com/hook' },
    });

    const settings = await getAppSettings(testScope());
    // The webhook landed...
    assert.equal(
      settings.webhooks.commentCreatedUrl,
      'https://example.com/hook',
    );
    // ...and the earlier field survived the partial write.
    assert.equal(settings.sessionDurationDays, 45);
  });

  it('round-trips the organization theme and normalizes an invalid id to empty', async () => {
    await writeAppSettings(testScope(), {
      defaultThemeId: 'clicknl',
      enabledThemes: ['amethyst', 'clicknl'],
    });
    let s = await getAppSettings(testScope());
    assert.equal(s.defaultThemeId, 'clicknl');
    assert.deepEqual(s.enabledThemes, ['amethyst', 'clicknl']);

    // getDefaultThemeId prefers the stored setting over env/built-in.
    delete process.env.DEFAULT_THEME;
    assert.equal(await getDefaultThemeId(testScope()), 'clicknl');

    // An invalid id normalizes to empty, then falls back to the built-in default.
    await writeAppSettings(testScope(), { defaultThemeId: 'bad id!!' });
    s = await getAppSettings(testScope());
    assert.equal(s.defaultThemeId, '');
    assert.equal(await getDefaultThemeId(testScope()), DEFAULT_THEME_ID);
  });

  it('prefers a stored theme allowlist over the ENABLED_THEMES env seam', async () => {
    // Same precedence as defaultThemeId/DEFAULT_THEME: what an admin clicked
    // wins over what the fork shipped as configuration, and an empty stored
    // list means "not configured here", so the env seam applies again.
    process.env.ENABLED_THEMES = 'midnight';
    try {
      await writeAppSettings(testScope(), {
        enabledThemes: ['amethyst', 'clicknl'],
      });
      assert.deepEqual(await getEnabledThemeIds(testScope()), [
        'amethyst',
        'clicknl',
      ]);

      await writeAppSettings(testScope(), { enabledThemes: [] });
      assert.deepEqual(await getEnabledThemeIds(testScope()), ['midnight']);
    } finally {
      delete process.env.ENABLED_THEMES;
    }
  });

  it('drops a third-party analytics id that is not spelled like an id', async () => {
    // These land in the <head> of every published deck and embed, part of it
    // inside <script> — so the write path validates the charset instead of
    // escaping it, and an id that fails stores as '' (B101).
    const after = await writeAppSettings(testScope(), {
      analytics: {
        externalProviders: {
          matomo: {
            enabled: true,
            url: 'https://matomo.example.com',
            siteId: "7',alert(1),'",
          },
          plausible: { enabled: true, domain: 'a.example.com"><script>' },
          umami: { enabled: true, websiteId: 'id</script>' },
          googleAnalytics: { enabled: true, measurementId: "G-1',alert(1),'" },
        },
      },
    });
    const p = after.analytics.externalProviders;
    assert.equal(p.matomo.siteId, '');
    assert.equal(p.plausible.domain, '');
    assert.equal(p.umami.websiteId, '');
    assert.equal(p.googleAnalytics.measurementId, '');
    // The legitimate neighbour in the same block survives untouched.
    assert.equal(p.matomo.url, 'https://matomo.example.com');

    // And the drop is durable, not just in the return value.
    const stored = (await getAppSettings(testScope())).analytics
      .externalProviders;
    assert.equal(stored.matomo.siteId, '');
    assert.equal(stored.googleAnalytics.measurementId, '');

    // A well-formed id round-trips.
    const ok = await writeAppSettings(testScope(), {
      analytics: {
        externalProviders: {
          matomo: {
            enabled: true,
            url: 'https://matomo.example.com',
            siteId: '7',
          },
        },
      },
    });
    assert.equal(ok.analytics.externalProviders.matomo.siteId, '7');
  });

  it('keeps a stock-media source a partial write does not mention', async () => {
    assert.equal(
      (await getAppSettings(testScope())).stockMedia.bundled.enabled,
      false,
    );

    await writeAppSettings(testScope(), {
      stockMedia: { bundled: { enabled: true }, unsplash: { enabled: true } },
    });
    // A client that only knows about Giphy must not switch the other two off.
    const after = await writeAppSettings(testScope(), {
      stockMedia: { giphy: { enabled: true } },
    });
    assert.equal(after.stockMedia.bundled.enabled, true);
    assert.equal(after.stockMedia.unsplash.enabled, true);
    assert.equal(after.stockMedia.giphy.enabled, true);
    // And the merge is durable, not just in the return value.
    assert.equal(
      (await getAppSettings(testScope())).stockMedia.bundled.enabled,
      true,
    );
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
            teamAnalytics: {
              policy: 'opt-in-detailed',
              allowDetailedOptIn: false,
            },
            externalAnalytics: { enabled: false },
            retention: { sessionDataDays: 90, ipAnonymizationDays: 7 },
          },
        }),
      })
      .execute();

    // Read back: the legacy sub-objects are gone, the master switch survives.
    const read = await getAppSettings(testScope());
    assert.equal(read.analytics.enabled, true);
    assert.equal('teamAnalytics' in read.analytics, false);
    assert.equal('externalAnalytics' in read.analytics, false);

    // A later write must not resurrect them in the stored bag.
    await writeAppSettings(testScope(), { sessionDurationDays: 45 });
    const row = await db
      .selectFrom('app_settings')
      .select('settings')
      .executeTakeFirst();
    const stored =
      typeof row.settings === 'string'
        ? JSON.parse(row.settings)
        : row.settings;
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

    const read = await getUserSettings(testScope(), 'legacy@example.com');
    assert.equal(read.digest.enabled, true);
    assert.equal(read.digest.dayOfWeek, 3);
    assert.equal('includeTeamAnalytics' in read.digest, false);

    // A later write does not persist the dropped key.
    await writeUserSettings(testScope(), 'legacy@example.com', {
      uiLocale: 'nl',
    });
    const row = await db
      .selectFrom('user_settings')
      .select('settings')
      .where('email', '=', 'legacy@example.com')
      .executeTakeFirst();
    const stored =
      typeof row.settings === 'string'
        ? JSON.parse(row.settings)
        : row.settings;
    assert.equal('includeTeamAnalytics' in stored.digest, false);
  });

  it('reads code defaults from an empty user_settings', async () => {
    assert.deepEqual(
      await getUserSettings(testScope(), 'jaap@ciiic.nl'),
      defaultUserSettings(),
    );
  });

  it('round-trips user settings keyed on the e-mail, case-insensitively', async () => {
    await writeUserSettings(testScope(), 'Jaap@Ciiic.nl', {
      uiLocale: 'nl',
      profile: { name: 'Jaap' },
    });

    // Looked up by a differently-cased spelling of the same address.
    const read = await getUserSettings(testScope(), 'jaap@ciiic.nl');
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
    await writeUserSettings(testScope(), 'a@x.test', { uiLocale: 'nl' });
    await writeUserSettings(testScope(), 'b@x.test', { uiLocale: 'en' });

    assert.equal(
      (await getUserSettings(testScope(), 'a@x.test')).uiLocale,
      'nl',
    );
    assert.equal(
      (await getUserSettings(testScope(), 'b@x.test')).uiLocale,
      'en',
    );

    const count = await db
      .selectFrom('user_settings')
      .select(db.fn.countAll().as('n'))
      .executeTakeFirst();
    assert.equal(Number(count.n), 2);
  });

  it('merges a partial user-settings write onto the stored value', async () => {
    await writeUserSettings(testScope(), 'jaap@ciiic.nl', {
      profile: { name: 'Jaap' },
      highlighter: { color: '#00ff00' },
    });
    // Update only the locale; name and highlighter must survive.
    await writeUserSettings(testScope(), 'jaap@ciiic.nl', { uiLocale: 'nl' });

    const read = await getUserSettings(testScope(), 'jaap@ciiic.nl');
    assert.equal(read.uiLocale, 'nl');
    assert.equal(read.profile.name, 'Jaap');
    assert.equal(read.highlighter.color, '#00ff00');
  });

  // A partial write (an API consumer PUTting one preference) must not reset the
  // other stored opt-outs — per-key for emailByType, and the channel booleans.
  it('a partial emailByType write keeps other stored opt-outs', async () => {
    await writeUserSettings(testScope(), 'merge@example.com', {
      notifications: { emailByType: { comment_reply: false } },
    });
    await writeUserSettings(testScope(), 'merge@example.com', {
      notifications: { emailByType: { comment_created: false } },
    });

    const s = await getUserSettings(testScope(), 'merge@example.com');
    assert.equal(s.notifications.emailByType.comment_created, false);
    assert.equal(s.notifications.emailByType.comment_reply, false);
    assert.equal(s.notifications.emailByType.comment_mention, true);
  });

  it('a partial notifications write keeps channel opt-outs and defaultLevel', async () => {
    await writeUserSettings(testScope(), 'merge@example.com', {
      notifications: { emailEnabled: false, defaultLevel: 'watching' },
    });
    await writeUserSettings(testScope(), 'merge@example.com', {
      notifications: { slackEnabled: false },
    });

    const s = await getUserSettings(testScope(), 'merge@example.com');
    assert.equal(s.notifications.emailEnabled, false);
    assert.equal(s.notifications.slackEnabled, false);
    assert.equal(s.notifications.defaultLevel, 'watching');
  });
});
