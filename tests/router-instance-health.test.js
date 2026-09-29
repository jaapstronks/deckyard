/**
 * The dispatcher counts operations (B515, D247): a matched row with an `id`
 * is recorded once as `<axis>:<id>` through `recordInstanceHealth`, the one
 * writer of the instance-health counters. The public v1 API dispatches on
 * axis `api_v1`, so one v1 call leaves one `api_v1` entry behind.
 *
 * The counters' table arrives with B514; until then the facade's test
 * recorder observes what would have been written. When B514 lands, these
 * assertions move to the rows the fake database holds.
 *
 * Run with: node --test tests/router-instance-health.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { dispatchRoutes } from '../server/utils/router.js';
import {
  __setInstanceHealthRecorderForTest,
  recordInstanceHealth,
} from '../server/storage/instance-health.js';

const { handlePublicApiV1 } =
  await import('../server/routes/public-api/v1/index.js');

const UUID = '00000000-0000-4000-8000-000000000001';

/** Collect what the dispatcher records for the duration of one test. */
function recordings(t) {
  const seen = [];
  __setInstanceHealthRecorderForTest((entries) => seen.push(...entries));
  t.after(() => __setInstanceHealthRecorderForTest(null));
  return seen;
}

/** A context carrying just what the dispatcher reads. */
function ctx(method, pathname) {
  return { req: { method }, url: { pathname }, res: {} };
}

const ROUTES = [
  {
    method: 'GET',
    id: 'getThing',
    pattern: /^\/api\/things\/([^/]+)$/,
    captures: ['uuid'],
    handler: () => 'got',
  },
  {
    pattern: /^\/api\/things\/([^/]+)$/,
    captures: ['text'],
    handler: () => 405,
  },
  { method: 'GET', pattern: '/api/unnamed', handler: () => 'unnamed' },
];

test('a matched row with an id is counted once on the axis', (t) => {
  const seen = recordings(t);
  const result = dispatchRoutes(ROUTES, ctx('GET', `/api/things/${UUID}`), {
    axis: 'api_v1',
  });
  assert.equal(result, 'got');
  assert.deepEqual(seen, [{ axis: 'api_v1', key: 'getThing' }]);
});

test('a row without an id, a 405 row and a refused capture are not counted', (t) => {
  const seen = recordings(t);
  const options = { axis: 'api_v1', notFound: () => 'not found' };
  dispatchRoutes(ROUTES, ctx('GET', '/api/unnamed'), options);
  dispatchRoutes(ROUTES, ctx('POST', `/api/things/${UUID}`), options);
  assert.equal(
    dispatchRoutes(ROUTES, ctx('GET', '/api/things/not-a-uuid'), options),
    'not found',
  );
  assert.deepEqual(seen, []);
});

test('an id on a surface that declares no axis is refused', () => {
  assert.throws(
    () => dispatchRoutes(ROUTES, ctx('GET', `/api/things/${UUID}`)),
    /carries id 'getThing' but its surface declares no axis/,
  );
});

test('the facade refuses an axis outside the vocabulary and an empty key', async () => {
  await assert.rejects(
    recordInstanceHealth([{ axis: 'api_v2', key: 'x' }]),
    /unknown axis 'api_v2'/,
  );
  await assert.rejects(
    recordInstanceHealth([{ axis: 'api_v1', key: '' }]),
    /empty key/,
  );
});

/** A request context for the real v1 router, no API key. */
function v1Ctx(pathname) {
  const req = Readable.from([]);
  req.method = 'GET';
  req.headers = {};
  const res = {
    statusCode: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end() {},
  };
  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
  };
}

test('one v1 call leaves one api_v1 entry named by its operationId', async (t) => {
  const seen = recordings(t);
  const c = v1Ctx('/api/v1/schema/deck.json');
  assert.equal(await handlePublicApiV1(c), true);
  assert.equal(c.res.statusCode, 200);
  assert.deepEqual(seen, [{ axis: 'api_v1', key: 'getDeckSchema' }]);
});

test('the meta endpoints answer outside the tables and are not counted', async (t) => {
  const seen = recordings(t);
  const c = v1Ctx('/api/v1/openapi.yaml');
  assert.equal(await handlePublicApiV1(c), true);
  assert.equal(c.res.statusCode, 200);
  assert.deepEqual(seen, []);
});
