/**
 * The analytics cluster switch (`ANALYTICS_ENABLED=false`) reaches every
 * analytics surface on the server (B523, D258, D260, D261).
 *
 * With the cluster off, the installation answers as if it never had analytics:
 *
 *  - the three mounts (`/api/track/*` and the public report in front of the
 *    login gate, `/api/analytics/*` + `/api/presentations/:id/analytics*`
 *    behind it) are skipped by `dispatchMounts`, so `handleApi` reaches its
 *    404;
 *  - a published page carries no tracking script;
 *  - the app shell is not served for `/insights`, `/analytics/:id` and
 *    `/reports/:token`;
 *  - the weekly digest is not scheduled, while the retention cleanup is
 *    (it only lets data expire) and the boot line counts what is still held.
 *
 * With it on, nothing changes: the existing analytics tests run with the
 * default. The client half (no entry, `tracking` in the audience payloads) is
 * in `tests/feature-entries-follow-flags.test.js`.
 *
 * Run with: node --test tests/analytics-kill-switch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'analytics-killswitch']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
delete process.env.ANALYTICS_ENABLED;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { dispatchMounts } = await import('../server/utils/router.js');
const { PUBLIC_MOUNTS, MOUNTS } = await import('../server/routes/api/index.js');
const { getFeatureFlags } = await import('../server/config/flags-snapshot.js');
const { handlePublished } =
  await import('../server/routes/static/published.js');
const { handleAppRoutes } =
  await import('../server/routes/static/app-shell.js');

test.afterEach(() => {
  delete process.env.ANALYTICS_ENABLED;
});

/** A response double capturing status/headers/body. */
function makeRes() {
  return {
    statusCode: null,
    headers: {},
    rawBody: null,
    headersSent: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      this.headersSent = true;
      return this;
    },
    write() {
      return true;
    },
    end(payload) {
      if (this.statusCode === null) this.statusCode = 200;
      this.rawBody = payload ?? null;
      return this;
    },
  };
}

function ctx(method, pathname) {
  return {
    req: { method, headers: {}, on() {}, once() {} },
    res: makeRes(),
    url: new URL(`http://localhost${pathname}`),
    authedUser: { id: 'u-1', email: 'owner@example.com', role: 'admin' },
    storageScope: null,
    repoRoot: process.cwd(),
  };
}

test('the snapshot carries enableAnalytics, default on', () => {
  assert.equal(getFeatureFlags().enableAnalytics, true);
  process.env.ANALYTICS_ENABLED = 'false';
  assert.equal(getFeatureFlags().enableAnalytics, false);
});

const P = '123e4567-e89b-42d3-a456-426614174000';
const PATHS = [
  ['PUBLIC_MOUNTS', 'POST', '/api/track/session/start'],
  ['PUBLIC_MOUNTS', 'POST', '/api/track/my-data/erase'],
  ['PUBLIC_MOUNTS', 'GET', '/api/analytics/reports/tok-1'],
  ['MOUNTS', 'GET', '/api/analytics/dashboard'],
  ['MOUNTS', 'GET', `/api/presentations/${P}/analytics`],
  ['MOUNTS', 'GET', `/api/presentations/${P}/analytics/realtime`],
];

for (const [table, method, path] of PATHS) {
  test(`${method} ${path}: no mount takes it with ANALYTICS_ENABLED=false`, async () => {
    process.env.ANALYTICS_ENABLED = 'false';
    const mounts = table === 'PUBLIC_MOUNTS' ? PUBLIC_MOUNTS : MOUNTS;
    const c = ctx(method, path);
    assert.equal(await dispatchMounts(mounts, c), false);
    assert.equal(c.res.statusCode, null, 'nothing was written');
  });
}

test('the three analytics mounts, and only they, carry the feature', () => {
  const names = [...PUBLIC_MOUNTS, ...MOUNTS]
    .filter((m) => m.feature === 'analytics')
    .map((m) => m.handle.name || 'handler');
  assert.equal(names.length, 3);
});

test('the app shell is not served for the analytics pages with the cluster off', async () => {
  for (const path of ['/insights', `/analytics/${P}`, '/reports/tok-1']) {
    process.env.ANALYTICS_ENABLED = 'false';
    const c = ctx('GET', path);
    assert.equal(await handleAppRoutes(c), false, `${path} not served`);
  }
});

test('published page: a tracking script only with the cluster on', async (t) => {
  const brandSeed = await brandSeedRow();
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      themes: [brandSeed],
      presentations: [
        {
          id: 'deck-pub',
          organization_id: ORG,
          title: 'Published deck',
          owner_email: 'owner@example.com',
          created_by: 'owner@example.com',
          updated_by: 'owner@example.com',
          visibility: 'organization',
          theme: 'default',
          lang: 'nl',
          revision: 1,
          is_view_only: false,
          slides: [{ id: 's1', type: 'content-slide', content: {} }],
          i18n: null,
          settings: {},
          created_at: '2026-02-01T00:00:00.000Z',
          modified_at: '2026-02-01T00:00:00.000Z',
          trashed_at: null,
        },
      ],
      published_presentations: [
        {
          id: 'abcd1234',
          organization_id: ORG,
          presentation_id: 'deck-pub',
          title: 'Published deck',
          slug: 'my-deck',
          og_image_url: null,
          created_at: '2026-02-01T00:00:00.000Z',
          modified_at: '2026-02-01T00:00:00.000Z',
        },
      ],
      app_settings: [{ id: 'singleton', settings: {} }],
    }),
  );
  await initializeStorage();
  t.after(() => {
    __resetStorageForTests();
    __setTestDb(null);
  });

  const page = async () => {
    const res = makeRes();
    const handled = await handlePublished({
      repoRoot: process.cwd(),
      req: { method: 'GET', headers: { host: 'decks.example.test' } },
      res,
      url: new URL('http://decks.example.test/p/abcd1234-my-deck'),
    });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    return String(res.rawBody || '');
  };

  assert.match(await page(), /\/api\/track\/session\/start/);
  process.env.ANALYTICS_ENABLED = 'false';
  assert.doesNotMatch(await page(), /\/api\/track\//);
});

test('boot: the digest is scheduled only with the cluster on; the cleanup always (D261)', () => {
  const src = readFileSync(new URL('../server/server.js', import.meta.url), {
    encoding: 'utf8',
  });
  assert.match(
    src,
    /isFeatureEnabled\('analytics'\)\s*\?\s*\[scheduleDigestEmailJob\(/,
  );
  assert.match(src, /^\s*scheduleAnalyticsCleanup\(\),/m);
  assert.match(
    src,
    /if \(!isFeatureEnabled\('analytics'\)\) await warnAnalyticsRowsWhileOff\(\)/,
  );
});
