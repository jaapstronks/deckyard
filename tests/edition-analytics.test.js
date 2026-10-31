import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import { recordEditionVisit } from '../server/services/edition-analytics.js';
import {
  listViewSessions,
  getActiveViewerCount,
} from '../server/storage/analytics/index.js';

const org = '00000000-0000-0000-0000-0000000000aa';
const otherOrg = '00000000-0000-0000-0000-0000000000bb';
const deck = '11111111-1111-4111-8111-111111111111';
const publicationId = '22222222-2222-4222-8222-222222222222';
const scope = { repoRoot: process.cwd(), organizationId: org };
const edition = { publicationId, version: 1 };

function seed({
  enabled = true,
  deckEnabled = true,
  source = deck,
  deckOrg = org,
} = {}) {
  const db = createFakeDb({
    app_settings: [{ id: 1, settings: { analytics: { enabled } } }],
    publications: [
      { id: publicationId, organization_id: org, presentation_id: source },
    ],
    presentations: [
      {
        id: deck,
        organization_id: deckOrg,
        title: 'Source',
        slides: [],
        settings: { analyticsEnabled: deckEnabled },
        revision: 1,
      },
    ],
    view_sessions: [],
  });
  __setTestDb(db);
  return db;
}

test.afterEach(() => {
  __setTestDb(null);
  delete process.env.ANALYTICS_ENABLED;
});

test('records anonymous completed visits in the existing session list, with edition identity', async () => {
  const db = seed();
  await recordEditionVisit(scope.repoRoot, edition);
  await recordEditionVisit(
    scope.repoRoot,
    { ...edition, version: 2 },
    { embedded: true },
  );
  assert.equal(db.__tables.view_sessions.length, 2);
  const { items } = await listViewSessions(scope, deck, { limit: 10 });
  assert.deepEqual(items.map((s) => s.sourceId).sort(), [
    `${publicationId}/1`,
    `${publicationId}/2`,
  ]);
  assert.deepEqual(items.map((s) => s.sourceType).sort(), [
    'embed',
    'published',
  ]);
  for (const session of items) {
    assert.equal(session.presentationId, deck);
    assert.equal(session.viewerType, 'anonymous');
    assert.equal(session.endedAt, session.startedAt);
    assert.equal(session.durationSeconds, 0);
    for (const key of ['deviceId', 'viewerEmail', 'ipAddress', 'userAgent'])
      assert.equal(session[key], null);
    assert.equal(session.attributionAllowed, false);
  }
  assert.equal(await getActiveViewerCount(scope, deck), 0);
  assert.deepEqual(
    (
      await listViewSessions({ ...scope, organizationId: otherOrg }, deck, {
        limit: 10,
      })
    ).items,
    [],
  );
});

for (const [name, options] of [
  ['instance analytics off', { enabled: false }],
  ['deck analytics off', { deckEnabled: false }],
  ['source permanently deleted', { source: null }],
  ['source moved to another organization', { deckOrg: otherOrg }],
  [
    'source reference missing',
    { source: '33333333-3333-4333-8333-333333333333' },
  ],
]) {
  test(`does not record with ${name}`, async () => {
    const db = seed(options);
    await recordEditionVisit(scope.repoRoot, edition);
    assert.equal(db.__tables.view_sessions.length, 0);
  });
}

test('the installation kill switch prevents all analytics storage reads', async () => {
  process.env.ANALYTICS_ENABLED = 'false';
  __setTestDb(null);
  await recordEditionVisit(scope.repoRoot, edition);
});
