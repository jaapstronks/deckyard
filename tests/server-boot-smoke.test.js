/**
 * Server-boot smoke test — the gate that makes "the suite is green" mean "the
 * server module actually loads and answers".
 *
 * Why this exists (docs/plans/TODO.md B89): until now no test imported or booted
 * server/server.js. The two tests that referenced it (no-raw-console,
 * error-envelope-stragglers-guard) read the source as *text*. So server.js could
 * carry a broken import, a syntax error, or a top-level statement that throws,
 * and 400+ green tests would prove nothing about whether `node server/server.js`
 * even starts — the failure would surface for the first time on deploy. That is
 * the #717 lesson (a green suite over an unbootable server).
 *
 * What it covers: it imports server.js (exercising its ENTIRE dependency
 * graph — every one of the ~45 module imports at the top of the file, and thus
 * a broken import anywhere in that graph), calls the buildServer() factory,
 * binds an ephemeral port, hits /health (the one route that needs no database),
 * asserts the 200/ok envelope, and closes cleanly.
 *
 * What it deliberately does NOT cover: the full boot *sequence* (config guards,
 * initializeStorage, job scheduling, listen on the configured port) runs only
 * in server.js's main(), which needs a real PostgreSQL and Redis and so cannot
 * run in the database-free `npm test` suite (that is the `test-postgres` CI
 * job's territory). buildServer() has no boot side effects by construction: the
 * entrypoint guard at the bottom of server.js keeps main() from firing on
 * import. This smoke proves the module loads and dispatches; it is not a boot
 * of the production process.
 *
 * Run with: node --test tests/server-boot-smoke.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Importing server.js runs its module top level. The entrypoint guard means
// main() does not fire (this file is argv[1], not server.js), so no database is
// opened and no port is bound — but every top-level import is still resolved,
// which is the coverage this test buys.
const { buildServer } = await import('../server/server.js');

/** GET a path off a listening server and resolve { status, body }. */
function get(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

let server;
after(() => server && new Promise((resolve) => server.close(resolve)));

test('server.js exports a buildServer() factory', () => {
  assert.equal(
    typeof buildServer,
    'function',
    'server.js must export buildServer() so a test can boot the real dispatch pipeline'
  );
});

test('the built server boots and answers /health without a database', async () => {
  server = buildServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { status, body } = await get(server.address().port, '/health');
  assert.equal(status, 200, '/health must answer 200 on a freshly booted server');

  const payload = JSON.parse(body);
  assert.equal(payload.status, 'ok', '/health must report status: ok');
  assert.equal(
    typeof payload.timestamp,
    'number',
    '/health must carry a numeric timestamp'
  );
});
