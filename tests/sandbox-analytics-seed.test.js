/**
 * B353: opening a sandbox example writes the viewing history it declares, and
 * nothing outside sandbox mode can.
 *
 * The committed examples declare a `sandbox.analytics` profile; the builder
 * turns it into view sessions and slide views (server/sandbox/analytics.js),
 * and the storage writer refuses on its own without `SANDBOX_MODE`. The write
 * through the real route and the dashboard read are pinned against PostgreSQL
 * in tests/pg/sandbox-insights-seed.pgtest.js.
 *
 * Run with: node --test tests/sandbox-analytics-seed.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testScope } from './helpers/storage-scope.js';
import { sessionFor, userRows } from './helpers/identity-fixtures.js';
import { seedRow } from './helpers/theme-seed.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'guest@example.com';
const DECK = '11111111-2222-4333-8444-555555555555';
// The seeds the committed examples name, so the shelf lists them.
const THEMES = await Promise.all(
  ['editorial', 'corporate', 'playful'].map(seedRow),
);

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { buildSeedSessions, normalizeAnalyticsProfile, seedSandboxAnalytics } =
  await import('../server/sandbox/analytics.js');
const { insertSeededViewSessions } =
  await import('../server/storage/analytics/index.js');
const { handleSandbox } = await import('../server/routes/api/sandbox.js');

const EXAMPLES_DIR = path.join(process.cwd(), 'server', 'sandbox-examples');
const SLIDES = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const NOW = Date.parse('2026-10-07T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function withSandbox(value, fn) {
  const saved = process.env.SANDBOX_MODE;
  if (value) process.env.SANDBOX_MODE = '1';
  else delete process.env.SANDBOX_MODE;
  const restore = () => {
    if (saved === undefined) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = saved;
  };
  return Promise.resolve().then(fn).finally(restore);
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
}

function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: THEMES,
    presentations: [
      { id: DECK, organization_id: ORG, owner_email: OWNER, slides: SLIDES },
    ],
    view_sessions: [],
    slide_views: [],
  });
  __setTestDb(db);
  return db;
}

test.after(() => __setTestDb(null));

test('every committed example declares a profile that needs no clamping', async () => {
  const files = (await fs.readdir(EXAMPLES_DIR)).filter((f) =>
    f.endsWith('.json'),
  );
  assert.ok(files.length >= 3);
  for (const file of files) {
    const raw = JSON.parse(
      await fs.readFile(path.join(EXAMPLES_DIR, file), 'utf8'),
    ).sandbox?.analytics;
    assert.ok(raw, `${file} declares sandbox.analytics`);
    const settled = normalizeAnalyticsProfile(raw);
    for (const key of [
      'sessions',
      'days',
      'returningShare',
      'completion',
      'secondsPerSlide',
    ])
      assert.equal(settled[key], raw[key], `${file}: ${key} as declared`);
    assert.deepEqual(
      Object.fromEntries(settled.sources),
      raw.sources,
      `${file}: every source is a known source type`,
    );
  }
});

test('a profile builds a plausible, reproducible history', () => {
  const profile = normalizeAnalyticsProfile({
    sessions: 120,
    days: 30,
    returningShare: 0.25,
    completion: 0.5,
    secondsPerSlide: 20,
    sources: { share_link: 3, embed: 1 },
  });
  const sessions = buildSeedSessions(profile, SLIDES, { now: NOW, seed: 'x' });
  assert.equal(sessions.length, 120);
  assert.deepEqual(
    buildSeedSessions(profile, SLIDES, { now: NOW, seed: 'x' }),
    sessions,
    'same seed, same history',
  );

  const ids = new Set(SLIDES.map((s) => s.id));
  for (const s of sessions) {
    const start = Date.parse(s.startedAt);
    assert.ok(start <= NOW - 60 * 60 * 1000, 'at least an hour ago');
    assert.ok(start >= NOW - 30 * DAY, 'inside the declared window');
    assert.ok(['share_link', 'embed'].includes(s.sourceType));
    assert.ok(s.slideViews.length >= 1);
    assert.equal(s.slideViews[0].slideIndex, 0, 'every visit opens on slide 1');
    for (const v of s.slideViews) assert.ok(ids.has(v.slideId));
    assert.equal(
      s.durationSeconds,
      s.slideViews.reduce((sum, v) => sum + v.durationSeconds, 0),
    );
    assert.equal(s.exitSlideId, s.slideViews.at(-1).slideId);
  }

  const devices = new Set(sessions.map((s) => s.deviceId));
  assert.equal(devices.size, 90, 'a quarter of the visits are returning');
  const completed = sessions.filter((s) =>
    s.slideViews.some((v) => v.slideIndex === SLIDES.length - 1),
  ).length;
  assert.ok(completed > 30 && completed < 90, `completion ~50%: ${completed}`);
});

test('no profile or no slides builds nothing', () => {
  assert.equal(normalizeAnalyticsProfile(undefined), null);
  assert.equal(normalizeAnalyticsProfile([1]), null);
  assert.deepEqual(buildSeedSessions(null, SLIDES), []);
  assert.deepEqual(
    buildSeedSessions(normalizeAnalyticsProfile({}), []),
    [],
    'a deck without slides gets no history',
  );
});

test('a declaration cannot ask for unbounded rows', () => {
  const p = normalizeAnalyticsProfile({ sessions: 1e9, days: 1e9 });
  assert.equal(p.sessions, 500);
  assert.equal(p.days, 365);
});

test('in sandbox mode the writer stores the history on the guest copy', async () => {
  const db = installDb();
  const sessions = buildSeedSessions(
    normalizeAnalyticsProfile({ sessions: 12 }),
    SLIDES,
    { now: NOW, seed: 'w' },
  );
  const result = await withSandbox(true, () =>
    insertSeededViewSessions(testScope(process.cwd()), DECK, sessions),
  );
  assert.deepEqual(result, { sessions: 12 });
  const stored = await db.selectFrom('view_sessions').selectAll().execute();
  assert.equal(stored.length, 12);
  assert.ok(stored.every((row) => row.presentation_id === DECK));
  const views = await db.selectFrom('slide_views').selectAll().execute();
  assert.equal(
    views.length,
    sessions.reduce((n, s) => n + s.slideViews.length, 0),
  );
});

test('outside sandbox mode nothing can write the history', async () => {
  const db = installDb();
  const sessions = buildSeedSessions(
    normalizeAnalyticsProfile({ sessions: 12 }),
    SLIDES,
    { now: NOW, seed: 'w' },
  );
  await withSandbox(false, async () => {
    assert.deepEqual(
      await insertSeededViewSessions(testScope(process.cwd()), DECK, sessions),
      { sessions: 0 },
      'the storage writer refuses on its own',
    );
    assert.deepEqual(
      await seedSandboxAnalytics(
        testScope(process.cwd()),
        { id: DECK, slides: SLIDES },
        { sessions: 12 },
      ),
      { sessions: 0 },
    );
  });
  assert.equal(
    (await db.selectFrom('view_sessions').selectAll().execute()).length,
    0,
  );
  assert.equal(
    (await db.selectFrom('slide_views').selectAll().execute()).length,
    0,
  );
});

test('outside sandbox mode the open-example route does not exist', async () => {
  installDb();
  const res = mockRes();
  await withSandbox(false, () =>
    handleSandbox({
      repoRoot: process.cwd(),
      storageScope: testScope(process.cwd()),
      req: { method: 'POST', headers: {} },
      res,
      url: new URL('http://test.local/api/sandbox/examples/meet-deckyard'),
      authedUser: sessionFor(OWNER, { isAdmin: false }),
    }),
  );
  assert.equal(res.statusCode, 404);
});

test('the shelf never hands the browser the viewing profile', async () => {
  installDb();
  const res = mockRes();
  await withSandbox(true, () =>
    handleSandbox({
      repoRoot: process.cwd(),
      req: { method: 'GET', headers: {} },
      res,
      url: new URL('http://test.local/api/sandbox/examples'),
      authedUser: sessionFor(OWNER, { isAdmin: false }),
    }),
  );
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.examples.length >= 3);
  for (const example of res.body.examples) {
    assert.equal('analytics' in example, false, example.id);
    assert.equal('sandbox' in example.deck, false, example.id);
  }
});
