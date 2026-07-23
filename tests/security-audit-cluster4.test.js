/**
 * Security-audit cluster 4 regression tests (H4, MH1, MH2).
 *
 * H4  — present-session control has no per-resource authz
 *       (server/routes/api/present-sessions.js). Creating/resuming a session,
 *       pushing live state, opening/closing interactions, driving remote
 *       control, and exporting audience feedback are all presenter actions and
 *       must require write permission on the backing presentation. A logged-in
 *       non-owner must get 401 — otherwise a public follow-code resolves to a
 *       presentationId, then to the live sessionId, then to full control of
 *       someone else's deck plus audience-PII export. Audience reads (state GET,
 *       SSE) stay capability-based.
 *
 * MH1 — read-SSRF in the csv-url data source
 *       (server/utils/data-source/providers/csv-url.js). The user-controlled URL
 *       must be validated with the shared SSRF guard (rejecting loopback,
 *       link-local/metadata, IPv6 and IPv4-mapped literals, non-http schemes)
 *       and fetched with redirect:'error' so a public URL can't 30x-bounce into
 *       private space.
 *
 * MH2 — share-link management linkId not tied to the authorized presentation
 *       (server/routes/api/share-links/management.js). Revoke/update/access-log
 *       must assert the linkId belongs to the presentation the caller can write,
 *       or a user who can write one deck could act on another (private) deck's
 *       link and read its viewer-PII access log.
 *
 * Run with: node --test tests/security-audit-cluster4.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { handlePresentSessions } from '../server/routes/api/present-sessions.js';
import { handleShareLinkManagement } from '../server/routes/api/share-links/management.js';
import { shareLinkBelongsToPresentation } from '../server/routes/api/share-links/management.js';
import { fetchCsvData } from '../server/utils/data-source/providers/csv-url.js';
import { sessions, loadedRoots } from '../server/storage/present-sessions/state.js';
import { presDir } from '../server/storage/presentations/paths.js';

const OWNER = { email: 'owner@example.com' };
const FOREIGN = { email: 'attacker@example.com' };

/**
 * Minimal ServerResponse mock: a Writable that also answers writeHead/end so
 * serveJson (buffered) works. Mirrors the cluster-1 harness.
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
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function mockReq(method, body) {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.headers = {};
  return req;
}

async function seedPresentation(root, id, { ownerEmail, slides = [] }) {
  const dir = presDir(root);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      title: 'Test deck',
      scope: 'private',
      ownerEmail,
      createdBy: ownerEmail,
      slides,
    }),
    'utf8',
  );
}

function seedSession(root, sessionId, presentationId, extra = {}) {
  // Pre-mark the root as loaded so getPresentSession skips the disk scan and
  // uses our in-memory entry.
  loadedRoots.add(root);
  const s = {
    sessionId,
    presentationId,
    state: {
      slideId: '',
      slideIndex: 0,
      updatedAt: 1,
      stepIdx: 0,
      stepParagraphs: false,
      slideType: '',
    },
    controlEnabled: false,
    followCodes: {},
    createdAt: 1,
    lastActivityAt: Date.now(),
    repoRoot: root,
    clients: new Set(),
    heartbeatTimers: new Map(),
    persistTimer: null,
    ...extra,
  };
  sessions.set(sessionId, s);
  return s;
}

async function withTempRoot(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dk-c4-'));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function callPresentSessions({ root, method, pathname, body, authedUser }) {
  const res = new MockRes();
  const url = new URL(`http://localhost${pathname}`);
  const handled = await handlePresentSessions({
    repoRoot: root,
    req: mockReq(method, body),
    res,
    url,
    authedUser,
  });
  return { handled, res };
}

// ============================================================================
// H4 — present-session per-resource authorization
// ============================================================================

test('H4: a non-owner cannot create/resume a present session (401)', async () => {
  await withTempRoot(async (root) => {
    await seedPresentation(root, 'deck-a', { ownerEmail: OWNER.email });
    const { res } = await callPresentSessions({
      root,
      method: 'POST',
      pathname: '/api/present-sessions',
      body: { presentationId: 'deck-a' },
      authedUser: FOREIGN,
    });
    assert.equal(res.statusCode, 401);
  });
});

test('H4: the owner can create a present session (201)', async () => {
  await withTempRoot(async (root) => {
    await seedPresentation(root, 'deck-b', { ownerEmail: OWNER.email });
    const { res } = await callPresentSessions({
      root,
      method: 'POST',
      pathname: '/api/present-sessions',
      body: { presentationId: 'deck-b' },
      authedUser: OWNER,
    });
    assert.equal(res.statusCode, 201);
    assert.ok(JSON.parse(res.body()).sessionId, 'owner receives a sessionId');
  });
});

test('H4: a non-owner cannot enable remote control on a live session (401)', async () => {
  await withTempRoot(async (root) => {
    await seedPresentation(root, 'deck-c', { ownerEmail: OWNER.email });
    seedSession(root, 'sess-c', 'deck-c');
    const { res } = await callPresentSessions({
      root,
      method: 'POST',
      pathname: '/api/present-sessions/sess-c/control/enable',
      authedUser: FOREIGN,
    });
    assert.equal(res.statusCode, 401);
    sessions.delete('sess-c');
  });
});

test('H4: the owner can enable remote control (200)', async () => {
  await withTempRoot(async (root) => {
    await seedPresentation(root, 'deck-d', { ownerEmail: OWNER.email });
    seedSession(root, 'sess-d', 'deck-d');
    const { res } = await callPresentSessions({
      root,
      method: 'POST',
      pathname: '/api/present-sessions/sess-d/control/enable',
      authedUser: OWNER,
    });
    assert.equal(res.statusCode, 200);
    sessions.delete('sess-d');
  });
});

test('H4: a non-owner cannot push live slide state (401)', async () => {
  await withTempRoot(async (root) => {
    await seedPresentation(root, 'deck-e', { ownerEmail: OWNER.email });
    seedSession(root, 'sess-e', 'deck-e');
    const { res } = await callPresentSessions({
      root,
      method: 'POST',
      pathname: '/api/present-sessions/sess-e/state',
      body: { presentationId: 'deck-e', slideId: 's1', slideIndex: 0 },
      authedUser: FOREIGN,
    });
    assert.equal(res.statusCode, 401);
    sessions.delete('sess-e');
  });
});

test('H4: a non-owner cannot export audience feedback CSV (401, no PII leaked)', async () => {
  await withTempRoot(async (root) => {
    await seedPresentation(root, 'deck-f', {
      ownerEmail: OWNER.email,
      slides: [{ id: 'fb1', type: 'feedback-slide', content: {} }],
    });
    seedSession(root, 'sess-f', 'deck-f');
    const { res } = await callPresentSessions({
      root,
      method: 'GET',
      pathname: '/api/present-sessions/sess-f/feedback/fb1.csv',
      authedUser: FOREIGN,
    });
    assert.equal(res.statusCode, 401);
    assert.ok(!/deviceId/.test(res.body()), 'no feedback CSV emitted to a non-owner');
    sessions.delete('sess-f');
  });
});

test('H4: reading session state stays open to the audience (GET is capability-based)', async () => {
  await withTempRoot(async (root) => {
    await seedPresentation(root, 'deck-g', { ownerEmail: OWNER.email });
    seedSession(root, 'sess-g', 'deck-g');
    // No authedUser at all (audience device): GET /state must still resolve.
    const { res } = await callPresentSessions({
      root,
      method: 'GET',
      pathname: '/api/present-sessions/sess-g/state',
      authedUser: null,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body()).presentationId, 'deck-g');
    sessions.delete('sess-g');
  });
});

// ============================================================================
// MH1 — csv-url read-SSRF guard
// ============================================================================

test('MH1: loopback / private / metadata IP literals are rejected before any fetch', async () => {
  const blocked = [
    'http://127.0.0.1/data.csv',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/data.csv',
    'http://[::ffff:169.254.169.254]/data.csv', // IPv4-mapped metadata IP
    'http://[::ffff:7f00:1]/data.csv', // hex-group IPv4-mapped loopback
  ];
  for (const url of blocked) {
    await assert.rejects(
      () => fetchCsvData({ url }),
      /internal\/private/,
      `expected ${url} to be blocked`,
    );
  }
});

test('MH1: non-http(s) schemes and malformed URLs are rejected', async () => {
  await assert.rejects(
    () => fetchCsvData({ url: 'file:///etc/passwd' }),
    /HTTP or HTTPS/,
  );
  await assert.rejects(
    () => fetchCsvData({ url: 'ftp://example.com/x.csv' }),
    /HTTP or HTTPS/,
  );
  await assert.rejects(() => fetchCsvData({ url: 'not-a-url' }), /Invalid CSV URL/);
  await assert.rejects(() => fetchCsvData({}), /url is required/);
});

test('MH1: the fetch is pinned to redirect:error (no 30x bounce into private space)', async () => {
  const src = await fs.readFile(
    fileURLToPath(new URL('../server/utils/data-source/providers/csv-url.js', import.meta.url)),
    'utf8',
  );
  assert.match(src, /redirect:\s*'error'/, 'csv-url fetch must set redirect:error');
  assert.match(src, /assertPublicHttpUrl/, 'csv-url must use the shared SSRF guard');
  assert.doesNotMatch(src, /function isPrivateUrl/, 'the weak string blocklist must be gone');
});

// ============================================================================
// MH2 — share-link management IDOR (linkId ↔ presentation containment)
// ============================================================================

test('MH2: shareLinkBelongsToPresentation is fail-closed', () => {
  assert.equal(shareLinkBelongsToPresentation(null, 'p1'), false);
  assert.equal(shareLinkBelongsToPresentation(undefined, 'p1'), false);
  assert.equal(shareLinkBelongsToPresentation({ presentationId: 'p2' }, 'p1'), false);
  assert.equal(shareLinkBelongsToPresentation({ presentationId: 'p1' }, ''), false);
  assert.equal(shareLinkBelongsToPresentation({ presentationId: 'p1' }, 'p1'), true);
});

test('MH2: revoke/update/access-log run the containment gate before mutating', async () => {
  const src = await fs.readFile(
    fileURLToPath(new URL('../server/routes/api/share-links/management.js', import.meta.url)),
    'utf8',
  );
  // The gate must precede each linkId-scoped storage call so a forged linkId
  // from another deck can't slip through.
  const gates = src.match(/loadLinkForPresentation\(/g) || [];
  assert.ok(gates.length >= 3, `expected containment on all 3 linkId routes, found ${gates.length}`);
});

test('MH2: a linkId that resolves to no in-scope link is denied (404, fail closed)', async () => {
  await withTempRoot(async (root) => {
    await seedPresentation(root, 'deck-h', { ownerEmail: OWNER.email });
    const res = new MockRes();
    const url = new URL(
      'http://localhost/api/presentations/deck-h/share-links/foreign-link-id',
    );
    // Owner can write deck-h, but the linkId doesn't belong to it (no DB → the
    // lookup returns null): the containment gate must 404, never 200.
    const handled = await handleShareLinkManagement({
      repoRoot: root,
      req: mockReq('DELETE'),
      res,
      url,
      authedUser: OWNER,
    });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 404);
  });
});
