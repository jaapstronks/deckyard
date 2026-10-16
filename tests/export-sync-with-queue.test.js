/**
 * `?sync=1` answers with the file, also on an instance with a job queue
 * (B715).
 *
 * The editor's export modal fetches every file itself and waits for the bytes;
 * it polls no job. On an instance with Redis a queue-backed route answers
 * `202 {queued}` unless the request says `?sync=1`, so the modal sends it on
 * every download. These tests install a queue double, so `isQueueAvailable()`
 * is true without Redis, and pin both halves: the API contract without
 * `?sync=1` is unchanged (`202`), and with it the route builds the file.
 *
 * The PowerPoint build needs a browser; that test skips locally when none is
 * installed, like `export-chrome-smoke`, never in CI.
 *
 * Run with: node --test tests/export-sync-with-queue.test.js
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { testScope } from './helpers/storage-scope.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';

const { closePuppeteerBrowser, resolveChromeExecutablePath } =
  await import('../server/utils/puppeteer-browser.js');
const { __setTestQueues, isQueueAvailable } =
  await import('../server/jobs/queue/connection.js');
const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { handleExports } = await import('../server/routes/api/export.js');

const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const noBrowser =
  (await resolveChromeExecutablePath()) || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

/** A queue double that records what was queued. */
function installQueue() {
  const added = [];
  __setTestQueues({
    export: {
      async add(name, data) {
        added.push({ name, data });
        return { id: String(added.length) };
      },
    },
  });
  return added;
}

afterEach(async () => {
  __setTestQueues(null);
  __setTestDb(null);
  await closePuppeteerBrowser();
});

/** A one-slide deck over the database double, owned by OWNER. */
async function seedDeck() {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      themes: [await brandSeedRow()],
      users: userRows(OWNER),
    }),
  );
  await initializeStorage();
  return createPresentation(testScope(process.cwd()), {
    title: 'Queued deck',
    ownerEmail: OWNER,
    theme: 'default',
    slides: [{ type: 'title-slide', content: { title: 'Bytes, not a job' } }],
  });
}

/** Call the export dispatcher for `pathname` and return the response double. */
async function exportAs(pathname) {
  const req = Readable.from([]);
  req.method = 'GET';
  req.headers = {};
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      return this;
    },
    end(payload) {
      this.body = payload;
    },
  };
  await handleExports({
    repoRoot: process.cwd(),
    storageScope: testScope(process.cwd(), { actorEmail: OWNER }),
    req,
    res,
    url: new URL(pathname, 'http://localhost'),
    authedUser: { id: userIdFor(OWNER), email: OWNER, organizationId: ORG },
  });
  return res;
}

test('without ?sync=1 a queue-backed export still answers 202 queued', async () => {
  const added = installQueue();
  assert.equal(isQueueAvailable(), true);
  const pres = await seedDeck();

  const res = await exportAs(`/api/presentations/${pres.id}/export/pptx`);
  assert.equal(res.statusCode, 202);
  const body = JSON.parse(res.body);
  assert.equal(body.queued, true);
  assert.equal(body.pollUrl, `/api/jobs/${body.jobId}`);
  assert.deepEqual(
    added.map((job) => job.name),
    ['pptx'],
  );
});

test(
  'with ?sync=1 the PowerPoint export answers with the file, queue or not',
  { skip: noBrowser },
  async () => {
    const added = installQueue();
    const pres = await seedDeck();

    const res = await exportAs(
      `/api/presentations/${pres.id}/export/pptx?sync=1`,
    );
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Disposition'], /\.pptx"$/);
    // A PPTX is a zip: the local file header's magic.
    assert.equal(Buffer.from(res.body).subarray(0, 2).toString(), 'PK');
    assert.deepEqual(added, [], 'a sync export queues nothing');
  },
);
