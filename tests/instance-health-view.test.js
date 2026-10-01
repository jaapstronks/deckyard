/**
 * The admin view of the instance-health counters (A7.3, B516, D249): who may
 * read `GET /api/instance-health`, which windows it accepts, and the pure
 * pieces its answer is built from.
 *
 * The route's happy path runs the census, a `jsonb_path_query` over every deck
 * that the in-memory double does not model, so the full answer is pinned
 * against real PostgreSQL in `tests/pg/instance-health-view.pgtest.js`. Here:
 *
 *   - the gate: no user is a 401, a user without the **instance** admin role a
 *     403, both before anything is read; an unknown window is a 400, never
 *     rounded to the nearest one;
 *   - `summarizeInstanceHealth`: days active, not the raw count, is the
 *     measure (D246); every axis is present; the most-used key comes first;
 *   - `changedKeys`: a settings diff names dotted leaf paths, an array is one
 *     leaf, and a value never leaves the function;
 *   - `addMonths`: the decision date is the first day plus three calendar
 *     months, clamped at a month's end (D26).
 *
 * Run with: node --test tests/instance-health-view.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { handleInstanceHealthRoutes, addMonths } =
  await import('../server/routes/api/instance-health.js');
const { summarizeInstanceHealth, INSTANCE_HEALTH_AXES } =
  await import('../server/storage/instance-health.js');
const { changedKeys } = await import('../server/storage/instance-census.js');

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
    body() {
      return JSON.parse(chunks.join(''));
    },
  };
}

/**
 * A post-gate context. The storage scope is deliberately not a real one: a
 * gate that reads storage before refusing fails on it.
 *
 * @param {object|null} authedUser
 * @param {string} [search]
 */
function contextFor(authedUser, search = '') {
  return {
    repoRoot: process.cwd(),
    storageScope: null,
    req: { method: 'GET', headers: {} },
    res: fakeResponse(),
    url: new URL(`http://localhost/api/instance-health${search}`),
    authedUser,
  };
}

// ─── the gate ────────────────────────────────────────────────────────────────

test('an anonymous caller is a 401 in the envelope', async () => {
  const ctx = contextFor(null);
  assert.equal(await handleInstanceHealthRoutes(ctx), true);
  assert.equal(ctx.res.statusCode, 401);
  assert.equal(ctx.res.body().error, 'unauthorized');
});

test('a user without the instance admin role is a 403, whatever their workspace role', async () => {
  const ctx = contextFor({
    email: 'owner@example.com',
    isAdmin: false,
    organizationRole: 'owner',
  });
  assert.equal(await handleInstanceHealthRoutes(ctx), true);
  assert.equal(ctx.res.statusCode, 403);
  assert.deepEqual(ctx.res.body(), {
    ok: false,
    error: 'forbidden',
    message: 'Admin access required',
  });
});

test('a window outside 30, 90 and 365 is refused, not rounded', async () => {
  for (const search of ['?days=7', '?days=91', '?days=', '?days=abc']) {
    const ctx = contextFor({ email: 'a@example.com', isAdmin: true }, search);
    await handleInstanceHealthRoutes(ctx);
    assert.equal(ctx.res.statusCode, 400, search);
    assert.equal(ctx.res.body().error, 'bad_request', search);
  }
});

test('another path is not this module’s to answer', async () => {
  const ctx = contextFor({ email: 'a@example.com', isAdmin: true });
  ctx.url = new URL('http://localhost/api/instance-health/extra');
  assert.equal(await handleInstanceHealthRoutes(ctx), false);
  assert.equal(ctx.res.statusCode, null);
});

// ─── summarizeInstanceHealth ─────────────────────────────────────────────────

test('usage is days active and last seen per key; count is summed beside it', () => {
  const usage = summarizeInstanceHealth([
    { axis: 'export', key: 'pdf', day: '2026-09-01', count: 40 },
    { axis: 'export', key: 'pdf', day: '2026-09-03', count: 1 },
    { axis: 'export', key: 'pptx', day: '2026-09-02', count: 2 },
    { axis: 'export', key: 'pptx', day: '2026-09-04', count: 1 },
    { axis: 'export', key: 'pptx', day: '2026-09-05', count: 1 },
    { axis: 'mcp', key: 'list_presentations', day: '2026-09-02', count: 3 },
  ]);
  assert.deepEqual(Object.keys(usage), [...INSTANCE_HEALTH_AXES]);
  assert.deepEqual(usage.export, [
    { key: 'pptx', daysActive: 3, lastSeen: '2026-09-05', count: 4 },
    { key: 'pdf', daysActive: 2, lastSeen: '2026-09-03', count: 41 },
  ]);
  assert.deepEqual(usage.mcp, [
    {
      key: 'list_presentations',
      daysActive: 1,
      lastSeen: '2026-09-02',
      count: 3,
    },
  ]);
  assert.deepEqual(usage.surface, []);
});

test('equal days active: the more recently seen key comes first, then the name', () => {
  const usage = summarizeInstanceHealth([
    { axis: 'surface', key: 'share', day: '2026-09-01', count: 1 },
    { axis: 'surface', key: 'embed', day: '2026-09-02', count: 1 },
    { axis: 'surface', key: 'follow', day: '2026-09-02', count: 1 },
  ]);
  assert.deepEqual(
    usage.surface.map((row) => row.key),
    ['embed', 'follow', 'share'],
  );
});

// ─── changedKeys ─────────────────────────────────────────────────────────────

test('a settings diff names the dotted leaf paths that differ, never a value', () => {
  const defaults = {
    supportedSlideLangs: ['nl', 'en-GB'],
    webhooks: { commentCreatedUrl: '', signingSecret: '' },
    analytics: { enabled: true, retention: { sessionDataDays: 90 } },
    sessionDurationDays: 30,
  };
  const actual = {
    supportedSlideLangs: ['nl'],
    webhooks: {
      commentCreatedUrl: 'https://hooks.example.com/x',
      signingSecret: 's3cret',
    },
    analytics: { enabled: true, retention: { sessionDataDays: 30 } },
    sessionDurationDays: 30,
  };
  const keys = changedKeys(actual, defaults).sort();
  assert.deepEqual(keys, [
    'analytics.retention.sessionDataDays',
    'supportedSlideLangs',
    'webhooks.commentCreatedUrl',
    'webhooks.signingSecret',
  ]);
  assert.ok(!JSON.stringify(keys).includes('s3cret'));
  assert.deepEqual(changedKeys(defaults, defaults), []);
});

// ─── addMonths ───────────────────────────────────────────────────────────────

test('the decision date is three calendar months on, clamped at a month end', () => {
  assert.equal(addMonths('2026-10-01', 3), '2027-01-01');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2027-11-30', 3), '2028-02-29');
  assert.equal(addMonths('2026-08-31', 3), '2026-11-30');
});
