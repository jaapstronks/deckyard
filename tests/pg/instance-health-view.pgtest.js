/**
 * The admin view of the instance-health counters against real PostgreSQL
 * (A7.3, B516, D245, D249).
 *
 * The census is a `jsonb_path_query` over every deck's slides and every
 * language version's slides, which the in-memory double does not model; so
 * the route's full answer is pinned here, driven through the handler as an
 * instance admin:
 *
 *   - the slide-type census counts decks and slides across organizations,
 *     reads translations (a slide in several versions counts once, a type that
 *     lives only in a translation still counts), and leaves out the trash and
 *     sandbox decks (D248);
 *   - the custom-type census folds the same key across organizations;
 *   - the settings census names the changed keys and never their values;
 *   - usage reads the window only, days active per key; `firstMeasuredAt` is
 *     the first counted day whatever the window, `decisionDueAt` three months on;
 *   - nothing in the answer names a deck, a person or an organization.
 *
 * The gate and the pure pieces are in `tests/instance-health-view.test.js`.
 */

import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

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
import { writeAppSettings } from '../../server/storage/settings.js';
import { handleInstanceHealthRoutes } from '../../server/routes/api/instance-health.js';

const OTHER_ORG = crypto.randomUUID();

/** `YYYY-MM-DD`, `n` days before today (UTC). */
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Collects what the handler wrote. */
function fakeResponse() {
  const chunks = [];
  return {
    statusCode: null,
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      if (payload) chunks.push(payload);
    },
    text() {
      return chunks.join('');
    },
  };
}

/** Ask the route as an instance admin; answer status and body. */
async function ask(search = '') {
  const ctx = {
    repoRoot: process.cwd(),
    storageScope: testScope(),
    req: { method: 'GET', headers: {} },
    res: fakeResponse(),
    url: new URL(`http://localhost/api/instance-health${search}`),
    authedUser: { email: 'admin@example.com', isAdmin: true },
  };
  await handleInstanceHealthRoutes(ctx);
  return { status: ctx.res.statusCode, text: ctx.res.text() };
}

pgDescribe('GET /api/instance-health (PostgreSQL)', () => {
  let db;
  const deckIds = [];

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await truncate(
      db,
      'instance_health',
      'custom_slide_types',
      'app_settings',
      'organizations',
    );
    const orgId = await seedDefaultOrganization(db);
    await db
      .insertInto('organizations')
      .values({ id: OTHER_ORG, name: 'Other Org', slug: 'other-org' })
      .execute();

    // A translated deck: matrix twice, title once, and a quote slide that
    // exists only in the English version.
    deckIds.push(
      await seedPresentation(db, {
        slides: [
          { id: 's1', type: 'title-slide' },
          { id: 's2', type: 'matrix-slide' },
          { id: 's3', type: 'matrix-slide' },
        ],
        i18n: {
          versions: {
            'en-GB': {
              slides: [
                { id: 's1', type: 'title-slide' },
                { id: 's2', type: 'matrix-slide' },
                { id: 's3', type: 'matrix-slide' },
                { id: 's4', type: 'quote-slide' },
              ],
            },
          },
        },
      }),
    );
    // A deck in the other organization.
    deckIds.push(
      await seedPresentation(db, {
        organizationId: OTHER_ORG,
        slides: [{ id: 'm1', type: 'matrix-slide' }],
      }),
    );
    // Trashed and sandbox decks count nowhere.
    deckIds.push(
      await seedPresentation(db, {
        slides: [{ id: 't1', type: 'poll-slide' }],
        trashedAt: new Date().toISOString(),
      }),
    );
    const sandboxDeck = await seedPresentation(db, {
      slides: [{ id: 'x1', type: 'likert-slide' }],
    });
    deckIds.push(sandboxDeck);
    await db
      .updateTable('presentations')
      .set({ sandbox: JSON.stringify({ enabled: true }) })
      .where('id', '=', sandboxDeck)
      .execute();

    await db
      .insertInto('custom_slide_types')
      .values([
        {
          organization_id: orgId,
          slug: 'hero',
          label: 'Hero',
          is_published: true,
        },
        { organization_id: OTHER_ORG, slug: 'hero', label: 'Hero' },
        {
          organization_id: orgId,
          slug: 'band',
          label: 'Band',
          is_published: true,
        },
      ])
      .execute();

    await writeAppSettings(testScope(), {
      sessionDurationDays: 45,
      webhooks: { signingSecret: 'super-secret-value' },
    });

    // The first counted day lies outside the 90-day window.
    await db
      .insertInto('instance_health')
      .values([
        { axis: 'export', key: 'pdf', day: daysAgo(200), count: 7 },
        { axis: 'export', key: 'pdf', day: daysAgo(5), count: 3 },
        { axis: 'export', key: 'pdf', day: daysAgo(1), count: 1 },
        { axis: 'export', key: 'pptx', day: daysAgo(2), count: 9 },
        { axis: 'mcp', key: 'list_presentations', day: daysAgo(1), count: 2 },
      ])
      .execute();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  it('answers the census, the usage in the default window and the decision date', async () => {
    const { status, text } = await ask();
    assert.equal(status, 200);
    const body = JSON.parse(text);

    assert.equal(body.days, 90);
    assert.equal(body.since, daysAgo(89));
    assert.equal(body.firstMeasuredAt, daysAgo(200));
    assert.match(body.decisionDueAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(body.decisionDueAt > body.firstMeasuredAt);

    assert.deepEqual(body.census.slideTypes, [
      { key: 'matrix-slide', decks: 2, slides: 3 },
      { key: 'quote-slide', decks: 1, slides: 1 },
      { key: 'title-slide', decks: 1, slides: 1 },
    ]);
    assert.deepEqual(body.census.customTypes, [
      { key: 'custom-band', definitions: 1, published: 1 },
      { key: 'custom-hero', definitions: 2, published: 1 },
    ]);
    assert.deepEqual(body.census.settings, [
      'sessionDurationDays',
      'webhooks.signingSecret',
    ]);

    assert.deepEqual(body.usage.export, [
      { key: 'pdf', daysActive: 2, lastSeen: daysAgo(1), count: 4 },
      { key: 'pptx', daysActive: 1, lastSeen: daysAgo(2), count: 9 },
    ]);
    assert.deepEqual(body.usage.mcp, [
      {
        key: 'list_presentations',
        daysActive: 1,
        lastSeen: daysAgo(1),
        count: 2,
      },
    ]);
    assert.deepEqual(body.usage.surface, []);
  });

  it('a wider window reaches the older days', async () => {
    const body = JSON.parse((await ask('?days=365')).text);
    assert.equal(body.days, 365);
    assert.equal(body.usage.export[0].key, 'pdf');
    assert.equal(body.usage.export[0].daysActive, 3);
  });

  it('names no deck, person, organization or setting value', async () => {
    const { text } = await ask('?days=365');
    for (const secret of [
      ...deckIds,
      OTHER_ORG,
      'admin@example.com',
      'super-secret-value',
      'Other Org',
    ]) {
      assert.ok(!text.includes(secret), `the answer carries ${secret}`);
    }
  });
});
