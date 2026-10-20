import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { userRows } from './helpers/identity-fixtures.js';
import { cookieFor, startCollabServer } from './helpers/collab-socket.js';

process.env.COLLAB_ENABLED = 'true';
process.env.AUTH_ENABLED = 'true';
process.env.AUTH_SECRET = ['deckyard', 'test', 'b801']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
delete process.env.AUTH_DEV_BYPASS;
delete process.env.MULTI_ORG_ENABLED;
delete process.env.APP_URL;
delete process.env.DOMAIN;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const users = userRows('writer@example.com');
__setTestDb(createFakeDb({ users }));
await initializeStorage();
after(() => __setTestDb(null));

// Real HTTP upgrade: use a valid writer's cookie, with browser-shaped Origin.
// No production host or DNS is involved, including for the proxy scenarios.
function upgrade(url, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(url.replace('ws:', 'http:'), {
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': Buffer.alloc(16).toString('base64'),
        ...headers,
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Upgrade timed out')));
    req.end();
  });
}

test('collab upgrade enforces the browser origin before cookie authentication', async (t) => {
  const collab = await startCollabServer({ repoRoot: process.cwd() });
  t.after(() => collab.stop());
  const cookie = await cookieFor(users[0]);
  const origin = collab.url.replace('ws:', 'http:').replace('/collab', '');
  assert.equal(await upgrade(collab.url, { cookie, origin }), 101);
  assert.equal(await upgrade(collab.url, { cookie }), 101);
  assert.equal(await upgrade(collab.url, { origin }), 401);

  process.env.APP_URL = 'https://slides.example.com/app';
  t.after(() => delete process.env.APP_URL);
  for (const origin of [
    'https://untrusted.example.com',
    'http://slides.example.com',
    'https://slides.example.com:444',
    'null',
    'garbage',
    'https://slides.example.com/path',
    'https://user@slides.example.com',
    'https://slides.example.com, https://untrusted.example.com',
    '',
  ]) {
    assert.equal(await upgrade(collab.url, { cookie, origin }), 403, origin);
  }
  assert.equal(
    await upgrade(collab.url, {
      cookie,
      origin: 'https://slides.example.com',
      'x-forwarded-host': 'internal:4177',
      'x-forwarded-proto': 'http',
    }),
    101,
  );
  assert.equal(
    await upgrade(collab.url, {
      cookie,
      origin: 'https://untrusted.example.com',
      'x-forwarded-host': 'untrusted.example.com',
      'x-forwarded-proto': 'https',
    }),
    403,
    'forwarded headers cannot override APP_URL',
  );
  assert.equal(await upgrade(collab.url, { cookie }), 101);

  delete process.env.APP_URL;
  process.env.DOMAIN = 'slides.example.com';
  t.after(() => delete process.env.DOMAIN);
  assert.equal(
    await upgrade(collab.url, { cookie, origin: 'https://slides.example.com' }),
    101,
  );
  assert.equal(
    await upgrade(collab.url, {
      cookie,
      origin: 'https://untrusted.example.com',
    }),
    403,
  );
  delete process.env.DOMAIN;
  assert.equal(
    await upgrade(collab.url, {
      cookie,
      origin: 'https://slides.example.com',
      'x-forwarded-host': 'slides.example.com, internal:4177',
      'x-forwarded-proto': 'https, http',
    }),
    101,
  );
  assert.equal(
    await upgrade(collab.url, {
      cookie,
      origin: 'https://untrusted.example.com',
      'x-forwarded-host': 'slides.example.com',
      'x-forwarded-proto': 'https',
    }),
    403,
  );
});
