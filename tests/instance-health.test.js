/**
 * The instance-health facade (B514, D246): one writer, one upsert per event,
 * days-active as the measure, and nothing on a sandbox instance (D248).
 *
 * What is pinned here is the facade itself — the vocabulary it refuses, the
 * row it writes, the read and the prune. That every measuring point reaches
 * it with the right key is pinned next to each point's own tests; the full
 * list is in docs/reference/instance-health.md.
 *
 * Run with: node --test tests/instance-health.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const {
  INSTANCE_HEALTH_AXES,
  INSTANCE_HEALTH_KEYS,
  countDeckView,
  pruneInstanceHealth,
  readInstanceHealth,
  recordInstanceHealth,
  slideTypeEntries,
} = await import('../server/storage/instance-health.js');
const { healthKeys } = await import('./helpers/instance-health.js');

const TODAY = new Date().toISOString().slice(0, 10);

function install(rows = []) {
  const db = createFakeDb({ instance_health: rows });
  __setTestDb(db);
  return db;
}

test.afterEach(() => {
  __setTestDb(null);
  delete process.env.SANDBOX_MODE;
});

test('the axes are the seven of D247', () => {
  assert.deepEqual(
    [...INSTANCE_HEALTH_AXES].sort(),
    [
      'api_v1',
      'export',
      'interaction',
      'mcp',
      'slide_type.authored',
      'slide_type.viewed',
      'surface',
    ].sort(),
  );
});

test('an axis, a key or a closed-vocabulary key outside the list is refused', async () => {
  install();
  await assert.rejects(
    recordInstanceHealth([{ axis: 'api_v2', key: 'x' }]),
    /unknown axis 'api_v2'/,
  );
  await assert.rejects(
    recordInstanceHealth([{ axis: 'mcp', key: '' }]),
    /empty key on axis 'mcp'/,
  );
  await assert.rejects(
    recordInstanceHealth([{ axis: 'mcp', key: 'x'.repeat(129) }]),
    /longer than 128/,
  );
  // No "unknown" bucket on a closed axis: an export format the doc does not
  // name is a programming error.
  await assert.rejects(
    recordInstanceHealth([{ axis: 'export', key: 'gif' }]),
    /unknown key 'gif' on 'export'/,
  );
  for (const [axis, keys] of Object.entries(INSTANCE_HEALTH_KEYS)) {
    for (const key of keys) {
      await recordInstanceHealth([{ axis, key }]);
    }
  }
});

test('one event is one row per distinct key for today, counted once', async () => {
  install();
  await recordInstanceHealth([
    { axis: 'surface', key: 'embed' },
    { axis: 'slide_type.viewed', key: 'content-slide' },
    { axis: 'slide_type.viewed', key: 'content-slide' },
  ]);
  assert.deepEqual(await readInstanceHealth(), [
    { axis: 'slide_type.viewed', key: 'content-slide', day: TODAY, count: 1 },
    { axis: 'surface', key: 'embed', day: TODAY, count: 1 },
  ]);
});

test('a second sighting on the same day bumps the count, not the days', async () => {
  const db = install();
  await recordInstanceHealth([{ axis: 'mcp', key: 'list_presentations' }]);
  await recordInstanceHealth([{ axis: 'mcp', key: 'list_presentations' }]);
  assert.equal(db.__tables.instance_health.length, 1);
  assert.equal(db.__tables.instance_health[0].count, 2);
});

test('a sandbox instance counts nothing (D248)', async () => {
  const db = install();
  process.env.SANDBOX_MODE = 'true';
  await recordInstanceHealth([{ axis: 'surface', key: 'share' }]);
  assert.deepEqual(db.__tables.instance_health, []);
  // The vocabulary still holds: a sandbox is no reason to accept a typo.
  await assert.rejects(
    recordInstanceHealth([{ axis: 'surface', key: 'shared' }]),
    /unknown key/,
  );
});

test('without a database the write and the reads are no-ops', async () => {
  __setTestDb(null);
  await recordInstanceHealth([{ axis: 'surface', key: 'share' }]);
  assert.deepEqual(await readInstanceHealth(), []);
  assert.equal(await pruneInstanceHealth(TODAY), 0);
});

test('the read answers the window oldest first; the prune keeps its cutoff day', async () => {
  install([
    { axis: 'surface', key: 'share', day: '2026-01-01', count: 2 },
    { axis: 'surface', key: 'embed', day: '2026-03-01', count: 1 },
    { axis: 'export', key: 'pdf', day: '2026-02-01', count: 4 },
  ]);
  assert.deepEqual(await readInstanceHealth({ sinceDay: '2026-02-01' }), [
    { axis: 'export', key: 'pdf', day: '2026-02-01', count: 4 },
    { axis: 'surface', key: 'embed', day: '2026-03-01', count: 1 },
  ]);
  assert.equal(await pruneInstanceHealth('2026-02-01'), 1);
  assert.deepEqual(
    (await readInstanceHealth()).map((r) => r.day),
    ['2026-02-01', '2026-03-01'],
  );
});

test('a deck carries its distinct types, every language version included', () => {
  const pres = {
    slides: [
      { type: 'title-slide' },
      { type: 'content-slide' },
      { type: 'content-slide' },
      { content: {} },
    ],
    i18n: {
      versions: {
        nl: { slides: [{ type: 'title-slide' }] },
        'en-GB': { slides: [{ type: 'quote-slide' }] },
      },
    },
  };
  assert.deepEqual(slideTypeEntries('slide_type.viewed', pres), [
    { axis: 'slide_type.viewed', key: 'content-slide' },
    { axis: 'slide_type.viewed', key: 'quote-slide' },
    { axis: 'slide_type.viewed', key: 'title-slide' },
  ]);
  assert.deepEqual(slideTypeEntries('slide_type.viewed', null), []);
});

test('a deck view counts its surface and its types', async () => {
  const db = install();
  countDeckView('embed', { slides: [{ type: 'poll-slide' }] });
  assert.deepEqual(await healthKeys(db), [
    'slide_type.viewed:poll-slide',
    'surface:embed',
  ]);
});
