/**
 * Security-audit cluster 1 regression tests (H1, H2, H3).
 *
 * H1 — arbitrary server file read via image-field path traversal on export
 *      (server/utils/html-utils.js). A user-controlled `/assets/../../.env`
 *      must never be read and inlined as a data URL.
 * H2 — API-key list/read/revoke scoped by owner (server/storage/api-keys.js).
 *      The owner-email scoping helper must fail closed when no actor is known.
 * H3 — export/translate/bulk job downloads gated by ownership
 *      (server/routes/api/jobs.js). A foreign owner (or a result with no owner
 *      stamp) must get 404, not another user's rendered deck.
 *
 * Run with: node --test tests/security-audit-cluster1.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';

import { toDataUrlIfLocal } from '../server/utils/html-utils.js';
import { getOwnerEmail } from '../server/storage/api-keys.js';
import { ownsStoredResult, handleJobs } from '../server/routes/api/jobs.js';
import { storeResult as storeBulkResult } from '../server/jobs/queue/workers/bulk-export-worker.js';

// ============================================================================
// H1 — image-field path traversal on export
// ============================================================================

test('H1: legit /assets and /uploads paths still inline as data URLs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dk-h1-ok-'));
  try {
    await fs.mkdir(path.join(root, 'assets'), { recursive: true });
    await fs.mkdir(path.join(root, 'server', 'uploads'), { recursive: true });
    await fs.writeFile(path.join(root, 'assets', 'ok.png'), Buffer.from('PNGDATA'));
    await fs.writeFile(path.join(root, 'server', 'uploads', 'pic.png'), Buffer.from('UPLOADDATA'));

    const asset = await toDataUrlIfLocal(root, '/assets/ok.png');
    assert.match(asset, /^data:image\/png;base64,/);

    const upload = await toDataUrlIfLocal(root, '/uploads/pic.png');
    assert.match(upload, /^data:image\/png;base64,/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('H1: /assets/../.env traversal is rejected (no file bytes leaked)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dk-h1-env-'));
  try {
    await fs.mkdir(path.join(root, 'assets'), { recursive: true });
    const secret = 'AUTH_SECRET=super-secret-value';
    await fs.writeFile(path.join(root, '.env'), secret);

    const traversal = '/assets/../.env';
    const out = await toDataUrlIfLocal(root, traversal);

    // The vulnerable code returned `data:...;base64,<bytes of .env>`. The fix
    // leaves the original string untouched (unreadable → stripped by Chrome).
    assert.equal(out, traversal);
    assert.doesNotMatch(out, /^data:/);
    assert.ok(
      !out.includes(Buffer.from(secret).toString('base64')),
      'secret bytes must not be inlined',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('H1: /uploads/../../.env traversal out of the uploads root is rejected', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dk-h1-up-'));
  try {
    await fs.mkdir(path.join(root, 'server', 'uploads'), { recursive: true });
    await fs.writeFile(path.join(root, '.env'), 'DB_PASSWORD=hunter2');

    // From <root>/server/uploads, `../../.env` lands on <root>/.env.
    const traversal = '/uploads/../../.env';
    const out = await toDataUrlIfLocal(root, traversal);
    assert.equal(out, traversal);
    assert.doesNotMatch(out, /^data:/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('H1: absolute-escape via encoded segments stays contained', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dk-h1-abs-'));
  try {
    await fs.mkdir(path.join(root, 'assets'), { recursive: true });
    await fs.writeFile(path.join(root, 'server-secret.txt'), 'nope');
    const traversal = '/assets/../server-secret.txt';
    const out = await toDataUrlIfLocal(root, traversal);
    assert.equal(out, traversal);
    assert.doesNotMatch(out, /^data:/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ============================================================================
// H2 — API-key owner scoping (fail-closed helper)
// ============================================================================

test('H2: getOwnerEmail returns "" when no actor (fail closed, matches nothing)', () => {
  assert.equal(getOwnerEmail(undefined), '');
  assert.equal(getOwnerEmail({}), '');
  assert.equal(getOwnerEmail({ actorEmail: null }), '');
  assert.equal(getOwnerEmail({ actorEmail: '' }), '');
});

test('H2: getOwnerEmail normalizes the actor email for scoping', () => {
  assert.equal(getOwnerEmail({ actorEmail: 'User@Example.COM' }), 'user@example.com');
  assert.equal(getOwnerEmail({ actorEmail: '  jaap@ciiic.nl  ' }), 'jaap@ciiic.nl');
});

test('H2: list/get/revoke/prefix queries all scope by owner_email', async () => {
  const src = await fs.readFile(
    fileURLToPath(new URL('../server/storage/api-keys.js', import.meta.url)),
    'utf8',
  );
  // Guard the invariant: every read/revoke query builder must carry an
  // owner_email filter so a cross-user IDOR can't regress back in.
  const ownerFilters = src.match(/\.where\('owner_email', '=', getOwnerEmail\(ctx\)\)/g) || [];
  assert.ok(
    ownerFilters.length >= 4,
    `expected owner_email scoping on list/get/revoke/prefix, found ${ownerFilters.length}`,
  );
});

// ============================================================================
// H3 — job-download ownership (fail closed)
// ============================================================================

test('H3: ownsStoredResult is fail-closed', () => {
  assert.equal(ownsStoredResult(null, { email: 'a@b.com' }), false);
  assert.equal(ownsStoredResult({}, { email: 'a@b.com' }), false, 'no owner stamp → deny');
  assert.equal(ownsStoredResult({ ownerEmail: 'a@b.com' }, null), false, 'no caller → deny');
  assert.equal(ownsStoredResult({ ownerEmail: 'a@b.com' }, { email: 'x@y.com' }), false);
  assert.equal(ownsStoredResult({ ownerEmail: 'a@b.com' }, { email: 'a@b.com' }), true);
  // Normalized comparison (case + whitespace).
  assert.equal(ownsStoredResult({ ownerEmail: 'A@B.com' }, { email: ' a@b.com ' }), true);
});

/**
 * Minimal ServerResponse mock: a Writable that also answers writeHead/end so
 * both serveJson (buffered) and stream.pipe (bulk file) paths work.
 */
class MockRes extends Writable {
  constructor() {
    super();
    this.chunks = [];
    this.statusCode = null;
    this.headers = null;
    this.headersSent = false;
  }
  _write(chunk, _enc, cb) {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
  writeHead(status, headers) {
    this.statusCode = status;
    this.headers = headers;
    this.headersSent = true;
    return this;
  }
  body() {
    return Buffer.concat(this.chunks);
  }
}

/**
 * Seed the bulk-worker result Map. storeResult schedules a multi-hour cleanup
 * timer; unref it so this test file doesn't keep the runner's event loop alive.
 */
function seedBulkResult(id, storedResult) {
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (...args) => {
    const timer = realSetTimeout(...args);
    timer?.unref?.();
    return timer;
  };
  try {
    storeBulkResult(id, storedResult);
  } finally {
    global.setTimeout = realSetTimeout;
  }
}

async function runDownload({ jobId, storedResult, authedUser }) {
  // parseJobId('heavy-<id>') → HEAVY queue, id '<id>'; getStoredBulkResult reads
  // the in-memory Map seeded via the bulk worker's exported storeResult.
  const id = jobId.replace(/^heavy-/, '');
  seedBulkResult(id, storedResult);

  const res = new MockRes();
  const url = new URL(`http://localhost/api/jobs/${jobId}/download`);
  const done = new Promise((resolve) => res.on('finish', resolve));
  const handled = await handleJobs({ req: { method: 'GET' }, url, res, authedUser });
  await done;
  return { handled, res };
}

test('H3: foreign owner cannot download another user’s bulk export (404)', async () => {
  const file = path.join(os.tmpdir(), `dk-h3-victim-${process.pid}.zip`);
  await fs.writeFile(file, Buffer.from('VICTIM-BACKUP-BYTES'));
  try {
    const { res } = await runDownload({
      jobId: 'heavy-101',
      storedResult: {
        filePath: file,
        contentType: 'application/zip',
        extension: '-backup.zip',
        filename: 'deckyard',
        ownerEmail: 'victim@example.com',
      },
      authedUser: { email: 'attacker@example.com' },
    });
    assert.equal(res.statusCode, 404);
    assert.ok(!res.body().includes('VICTIM-BACKUP-BYTES'), 'no victim bytes leaked');
  } finally {
    await fs.rm(file, { force: true });
  }
});

test('H3: the owner can download their own bulk export (200 + bytes)', async () => {
  const file = path.join(os.tmpdir(), `dk-h3-owner-${process.pid}.zip`);
  await fs.writeFile(file, Buffer.from('MY-BACKUP-BYTES'));
  try {
    const { res } = await runDownload({
      jobId: 'heavy-102',
      storedResult: {
        filePath: file,
        contentType: 'application/zip',
        extension: '-backup.zip',
        filename: 'deckyard',
        ownerEmail: 'owner@example.com',
      },
      authedUser: { email: 'owner@example.com' },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body().includes('MY-BACKUP-BYTES'), 'owner receives the file bytes');
  } finally {
    await fs.rm(file, { force: true });
  }
});

test('H3: a result with no owner stamp is denied (fail closed)', async () => {
  const file = path.join(os.tmpdir(), `dk-h3-noowner-${process.pid}.zip`);
  await fs.writeFile(file, Buffer.from('LEGACY-BYTES'));
  try {
    const { res } = await runDownload({
      jobId: 'heavy-103',
      storedResult: {
        filePath: file,
        contentType: 'application/zip',
        extension: '-backup.zip',
        filename: 'deckyard',
        // ownerEmail intentionally absent (older cached result)
      },
      authedUser: { email: 'someone@example.com' },
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await fs.rm(file, { force: true });
  }
});
