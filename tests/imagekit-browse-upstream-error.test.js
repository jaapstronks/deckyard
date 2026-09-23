/**
 * B415 — the ImageKit browse routes refuse in our own words.
 *
 * `fetchJsonOrThrow` used to put ImageKit's raw body into the error message on
 * a 4xx and forward ImageKit's status, so the picker showed
 * `{"message":"…","help":"For support kindly contact us at support@imagekit.io"}`
 * and a 401 on our own key reached the editor as a 401. B412 fixed the copy
 * route; these pin the rest of the surface: listing files, the tag sample, and
 * reading and writing a file's details.
 *
 * Every upstream failure — a 4xx, a 5xx, no answer at all — is the same
 * answer: `502 bad_gateway` with one sentence, nothing of ImageKit's payload
 * on the wire. The payload goes to `logError` only, and that is pinned too.
 *
 * Run with: node --test tests/imagekit-browse-upstream-error.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.DEMO_MODE;
delete process.env.SANDBOX_MODE;
process.env.IMAGEKIT_PRIVATE_KEY = 'private_test';
process.env.IMAGEKIT_PUBLIC_KEY = 'public_test';
process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/test';

const { handleMedia } = await import('../server/routes/api/media.js');

const USER = { email: 'olive@example.com', name: 'Olive' };

const UPSTREAM_BODY = {
  message: 'Your request contains invalid fileId parameter.',
  help: 'For support kindly contact us at support@imagekit.io .',
};

const savedFetch = globalThis.fetch;
const savedConsoleError = console.error;

test.after(() => {
  globalThis.fetch = savedFetch;
  console.error = savedConsoleError;
});

/** A response double capturing the status/body the http helpers write. */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
      return this;
    },
  };
}

/** Drive `handleMedia` the way the router does. */
async function call(method, pathAndQuery, { as = null, body } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = {
    method,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  await handleMedia({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://decks.example.test${pathAndQuery}`),
    authedUser: as || undefined,
  });
  return res;
}

const ROUTES = [
  ['GET', '/api/media/imagekit/files?q=olive'],
  ['GET', '/api/media/imagekit/tags'],
  ['GET', '/api/media/imagekit/files/ik-file-1/details'],
  ['PATCH', '/api/media/imagekit/files/ik-file-1/details'],
];

const FAILURES = {
  '4xx': () => ({
    ok: false,
    status: 400,
    headers: { get: () => 'application/json' },
    json: async () => UPSTREAM_BODY,
  }),
  '401 on our key': () => ({
    ok: false,
    status: 401,
    headers: { get: () => 'application/json' },
    json: async () => UPSTREAM_BODY,
  }),
  '5xx': () => ({
    ok: false,
    status: 503,
    headers: { get: () => 'text/html' },
    text: async () => '<html>upstream maintenance at imagekit.io</html>',
  }),
  'network error': () => {
    throw new TypeError('fetch failed: getaddrinfo ENOTFOUND api.imagekit.io');
  },
};

/** Stub ImageKit with `reply` and capture what reaches `logError`. */
function stubImageKit(reply) {
  const logged = [];
  console.error = (...args) => logged.push(args);
  globalThis.fetch = async () => reply();
  return logged;
}

for (const [method, route] of ROUTES) {
  for (const [name, reply] of Object.entries(FAILURES)) {
    test(`${method} ${route.split('?')[0]}: a ${name} is our refusal`, async () => {
      const logged = stubImageKit(reply);
      const res = await call(method, route, {
        as: USER,
        body: method === 'PATCH' ? { tags: ['x'] } : undefined,
      });
      console.error = savedConsoleError;

      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.body, {
        ok: false,
        error: 'bad_gateway',
        message: 'ImageKit could not complete this request',
      });
      // Nothing of ImageKit's answer, and not its status, on the wire.
      const wire = JSON.stringify(res.body);
      assert.doesNotMatch(
        wire,
        /imagekit\.io|invalid fileId|maintenance|ENOTFOUND|40\d|503/,
      );
      // The log is where the payload goes.
      const log = logged.flat().map(String).join(' ');
      assert.match(log, /\[imagekit\]/);
      if (name !== 'network error') {
        const wanted = name === '5xx' ? /maintenance/ : /invalid fileId/;
        const payloads = logged
          .flat()
          .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)));
        assert.ok(
          payloads.some((p) => wanted.test(p)),
          'the upstream payload reaches logError',
        );
      }
    });
  }
}

test('the tag sample keeps what it has when a later batch fails', async () => {
  let calls = 0;
  const files = Array.from({ length: 100 }, (_, i) => ({
    tags: [i % 2 ? 'team' : 'office'],
  }));
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => files,
      };
    }
    return FAILURES['5xx']();
  };
  console.error = () => {};
  const res = await call('GET', '/api/media/imagekit/tags', { as: USER });
  console.error = savedConsoleError;

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, [
    { tag: 'office', count: 50 },
    { tag: 'team', count: 50 },
  ]);
});
