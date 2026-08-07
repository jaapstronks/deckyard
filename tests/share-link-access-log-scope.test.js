/**
 * What scopes the share-link access log (A1(a), the org-scoping defects).
 *
 * `share_link_access_log` holds viewer PII — IP address and user agent, one row
 * per opened share link. Both functions over it
 * (`server/storage/share-links/access-log.js`) used to take a context object
 * and ignore it completely: a signature that promised an organization check
 * nobody performed. The org-scoping brief listed that as a defect under every
 * outcome of the decision.
 *
 * The chosen form is the one migration 064 / #626 settled for collaborator
 * rows: **the identifier is the scope**. A `presentation_share_links.id` is a
 * globally unique uuid and every log row hangs off exactly one of them, so an
 * organization in the filter cannot narrow the answer — only be wrong when the
 * two disagree. The context parameter is therefore gone rather than made real,
 * and authorization stays with the caller, which is where it already was.
 *
 * That leaves two things worth pinning, and this file is both halves:
 *
 *   1. **Behaviour** — the read answers for exactly one link, and answers with
 *      nothing when handed a link id that names no link. It is addressed, not
 *      searched.
 *   2. **Containment** — the route that exposes the log first authorizes the
 *      presentation and then binds the link id to it through
 *      `getShareLinkById`, which *is* organization-filtered. A link belonging
 *      to another organization does not resolve there, so it never reaches the
 *      log. `tests/security-audit-cluster4.test.js` (MH2) pins the deck half of
 *      that gate; this file pins the organization half, and a source-level guard
 *      refuses any call site that passes a scope to the access log again.
 *
 * House shape: storage functions called directly over
 * `tests/helpers/fake-db.js`, no HTTP server.
 *
 * Run with: node --test tests/share-link-access-log-scope.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { callArguments, walkJsFiles } from './helpers/call-sites.js';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { logShareLinkAccess, getShareLinkAccessLog, getShareLinkById } = await import(
  '../server/storage/share-links/index.js'
);

const ORG_A = '00000000-0000-0000-0000-0000000000aa';
const ORG_B = '00000000-0000-0000-0000-0000000000bb';
const LINK_IN_A = 'link-in-organization-a';
const LINK_IN_B = 'link-in-organization-b';

/**
 * A `presentation_share_links` row, in the shape the storage layer writes.
 * @param {Object} spec
 * @returns {Object}
 */
function linkRow({ id, org, deck }) {
  return {
    id,
    organization_id: org,
    presentation_id: deck,
    token: `tok-${id}`,
    label: null,
    permission: 'read',
    password_hash: null,
    expires_at: null,
    max_uses: null,
    use_count: 0,
    created_by: 'owner@example.test',
    created_at: '2026-03-01T00:00:00.000Z',
    last_used_at: null,
    revoked_at: null,
    revoked_by: null,
    revocation_message: null,
    registration_mode: 'invite_only',
  };
}

/** An access-log row for one link. */
function logRow({ id, linkId, ip = '203.0.113.7', at = '2026-03-02T00:00:00.000Z' }) {
  return {
    id,
    share_link_id: linkId,
    ip_address: ip,
    user_agent: 'UA/1.0',
    accessed_at: at,
  };
}

/** Install a fresh double seeded with both organizations' links. */
function seed(accessLog = []) {
  const db = createFakeDb({
    presentation_share_links: [
      linkRow({ id: LINK_IN_A, org: ORG_A, deck: 'deck-a' }),
      linkRow({ id: LINK_IN_B, org: ORG_B, deck: 'deck-b' }),
    ],
    share_link_access_log: accessLog,
  });
  __setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// Behaviour: the link is the address
// ---------------------------------------------------------------------------

test('the log answers for exactly the link it is asked about', async () => {
  seed([
    logRow({ id: 'a1', linkId: LINK_IN_A, ip: '203.0.113.1', at: '2026-03-02T10:00:00.000Z' }),
    logRow({ id: 'a2', linkId: LINK_IN_A, ip: '203.0.113.2', at: '2026-03-02T11:00:00.000Z' }),
    logRow({ id: 'b1', linkId: LINK_IN_B, ip: '198.51.100.9' }),
  ]);

  const entries = await getShareLinkAccessLog(LINK_IN_A, {});

  assert.deepEqual(
    entries.map((e) => e.id).sort(),
    ['a1', 'a2'],
    'the other organization’s link contributes nothing — different link, different rows'
  );
  assert.deepEqual(
    [...new Set(entries.map((e) => e.shareLinkId))],
    [LINK_IN_A]
  );
  assert.equal(entries[0].ipAddress, '203.0.113.2', 'newest access first');
});

test('an unknown or empty link id yields nothing', async () => {
  const db = seed([logRow({ id: 'a1', linkId: LINK_IN_A })]);

  assert.deepEqual(await getShareLinkAccessLog('no-such-link', {}), []);
  assert.deepEqual(await getShareLinkAccessLog('', {}), []);
  assert.deepEqual(await getShareLinkAccessLog(null, {}), []);
  assert.deepEqual(
    db.__queryLog,
    [{ op: 'select', table: 'share_link_access_log' }],
    'only the one real lookup reaches the database; a blank id short-circuits'
  );
});

test('writing a row needs the link and the access info, nothing else', async () => {
  const db = seed();

  await logShareLinkAccess(LINK_IN_A, { ipAddress: '203.0.113.5', userAgent: 'UA/2.0' });
  await logShareLinkAccess('', { ipAddress: '203.0.113.6' });

  const rows = db.__tables.share_link_access_log || [];
  assert.equal(rows.length, 1, 'the blank link id wrote nothing');
  assert.equal(rows[0].share_link_id, LINK_IN_A);
  assert.equal(rows[0].ip_address, '203.0.113.5');
  assert.equal(rows[0].user_agent, 'UA/2.0');
});

// ---------------------------------------------------------------------------
// Containment: the gate that stands between a caller and this table
// ---------------------------------------------------------------------------

test('a link id from another organization does not resolve, so the log is unreachable', async () => {
  seed([logRow({ id: 'b1', linkId: LINK_IN_B })]);

  // This is what `loadLinkForPresentation` calls before the route reads the
  // log. Acting in organization A, the organization-B link is simply absent — the
  // route turns that into a 404 (MH2) and never asks for the log.
  assert.equal(await getShareLinkById(LINK_IN_B, { organizationId: ORG_A }), null);

  const own = await getShareLinkById(LINK_IN_A, { organizationId: ORG_A });
  assert.equal(own?.id, LINK_IN_A, 'its own organization’s link resolves normally');
});

test('resolving a link with no organization to act in refuses rather than guessing', async () => {
  seed();

  await assert.rejects(
    () => getShareLinkById(LINK_IN_A, {}),
    /no organization/i,
    'getOrgId throws instead of falling back to the default organization'
  );
});

// ---------------------------------------------------------------------------
// The structural half: no call site can re-introduce a scope
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

/** Both access-log functions, and how many arguments each may be handed. */
const CONTRACTS = [
  { fn: 'logShareLinkAccess', maxArgs: 2, takes: 'a link id and the access info' },
  { fn: 'getShareLinkAccessLog', maxArgs: 2, takes: 'a link id and pagination options' },
];

test('no access-log call site passes a scope', () => {
  const offenders = [];

  for (const file of walkJsFiles(path.join(repoRoot, 'server'))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');
    for (const { fn, maxArgs } of CONTRACTS) {
      for (const args of callArguments(source, fn)) {
        if (args.length > maxArgs) offenders.push(`${rel}  ${fn}(${args.length} arguments)`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'the share link is the scope: ' +
      CONTRACTS.map((c) => `${c.fn} takes ${c.takes}`).join(', ') +
      '. A further argument is the context that used to be ignored, creeping back:\n  ' +
      offenders.join('\n  ')
  );
});

test('the guard would catch a re-introduced scope argument', () => {
  const planted = 'await getShareLinkAccessLog(linkId, { limit, offset }, ctx);';
  assert.equal(callArguments(planted, 'getShareLinkAccessLog')[0].length, 3);
  assert.equal(
    callArguments('await getShareLinkAccessLog(linkId, { limit, offset });', 'getShareLinkAccessLog')[0]
      .length,
    2,
    'and exactly two on the canonical form'
  );
});
