/**
 * Anonymous visitor stores: the register matches the code (B786).
 *
 * Every table that holds a visitor datum (IP, user agent, device id, session
 * token, accessor e-mail) is registered in
 * `tests/fixtures/anonymous-visitor-stores.json` with its producers, readers,
 * cleanup, erase path (or a reasoned exception), tests and reference anchor.
 * The audit in `tests/helpers/anonymous-visitor-stores.js` parses every module
 * under `server/` (migrations excluded) and refuses an identity write without
 * a register line, a second write path into a registered table, a stale
 * register line, evidence that does not exist, and a reference inventory
 * that does not name a registered table. An `updateTable(…).set({ … })` that
 * writes an identity key must target a registered table that lists it, and a
 * spread in `.values()` or `.set()` is refused as unreadable (B811). The docs
 * gates test words; this one tests `insertInto(…).values({ … })` and
 * `updateTable(…).set({ … })`.
 *
 * The negative cases below feed the same audit a synthetic source, so the
 * gate is shown to bite rather than assumed to.
 *
 * Run with: node --test tests/anonymous-visitor-stores-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkFiles } from './helpers/walk-files.js';
import {
  IDENTITY_KEY_PATTERN,
  auditAnonymousVisitorStores,
  collectInsertSites,
} from './helpers/anonymous-visitor-stores.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const register = JSON.parse(
  readFileSync(
    join(repoRoot, 'tests', 'fixtures', 'anonymous-visitor-stores.json'),
    'utf8',
  ),
);
const referenceText = readFileSync(join(repoRoot, register.reference), 'utf8');

const readFile = (file) => {
  const full = join(repoRoot, file);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
};

const scanRoot = join(repoRoot, register.scan.root);
const sources = walkFiles(scanRoot, {
  extensions: ['.js'],
  skipDirs: ['vendor', 'node_modules'],
})
  .map((full) => relative(repoRoot, full))
  .filter(
    (file) => !register.scan.excluded.some((prefix) => file.startsWith(prefix)),
  )
  .sort()
  .map((file) => ({ file, text: readFile(file) }));

const runAudit = (overrides = {}) =>
  auditAnonymousVisitorStores({
    register,
    sources,
    referenceText,
    readFile,
    ...overrides,
  });

// ─── the gate on the real tree ──────────────────────────────────────────────

test('every identity write under server/ has a register line, and every register line has evidence', () => {
  const { violations, sites } = runAudit();
  assert.deepEqual(violations, []);
  // The scan actually saw the tree: a producer of every registered table.
  for (const table of Object.keys(register.stores)) {
    assert.ok(
      sites.some((s) => s.table === table),
      `no insertInto('${table}') found under ${register.scan.root}/`,
    );
  }
});

test('the scan reads keys through a .values() literal and through a .map() callback', () => {
  const direct = collectInsertSites(
    'server/storage/access-attempts.js',
    readFile('server/storage/access-attempts.js'),
  );
  assert.deepEqual(
    direct.map((s) => [s.table, s.fn]),
    [['access_attempt_log', 'logAccessAttempt']],
  );
  assert.ok(direct[0].keys.includes('accessor_ip'));

  const seeded = collectInsertSites(
    'server/storage/analytics/seeded-sessions.js',
    readFile('server/storage/analytics/seeded-sessions.js'),
  );
  const slideViews = seeded.find((s) => s.table === 'slide_views');
  assert.equal(slideViews.fn, 'insertSeededViewSessions');
  assert.ok(
    slideViews.keys.includes('view_session_id'),
    'keys of the object the map() callback returns are read',
  );
});

test('the scan reads the keys of the identity .set() sites on the tree', () => {
  const { updates } = runAudit();
  const identityUpdates = updates
    .filter((s) => s.keys.some((k) => IDENTITY_KEY_PATTERN.test(k)))
    .map((s) => [s.file, s.table, s.fn]);
  assert.deepEqual(identityUpdates.sort(), [
    [
      'server/storage/analytics/view-sessions-gdpr.js',
      'view_sessions',
      'anonymizeOldIpAddresses',
    ],
    [
      'server/storage/share-links/guests.js',
      'share_link_guests',
      'verifyGuestEmail',
    ],
  ]);
});

// ─── the negative cases: the gate bites ─────────────────────────────────────

const withSource = (file, text) => ({
  sources: sources.concat({ file, text }),
});

test('a new identity write without a register line fails', () => {
  const { violations } = runAudit(
    withSource(
      'server/storage/fictional-log.js',
      `export async function logVisit(scope, ip) {
         return db.insertInto('fictional_visit_log').values({ presentation_id: 'p', ip_address: ip }).execute();
       }`,
    ),
  );
  assert.equal(violations.length, 1, violations.join('\n'));
  assert.match(violations[0], /fictional_visit_log/);
  assert.match(violations[0], /ip_address/);
  assert.match(
    violations[0],
    /not in tests\/fixtures\/anonymous-visitor-stores\.json/,
  );
});

test('an identity write inside an anonymous callback is attributed to the named function around it', () => {
  const { violations } = runAudit(
    withSource(
      'server/storage/fictional-log.js',
      `export async function recordDevice(scope, did) {
         return withDbGuard(undefined, async (db) => {
           await db.insertInto('fictional_devices').values({ device_id: did }).execute();
         });
       }`,
    ),
  );
  assert.equal(violations.length, 1, violations.join('\n'));
  assert.match(violations[0], /fictional_devices/);
});

test('a second write path into a registered table fails, even without identity keys', () => {
  const { violations } = runAudit(
    withSource(
      'server/storage/fictional-attempts.js',
      `export async function copyAttempt(scope, row) {
         return db.insertInto('access_attempt_log').values(row).execute();
       }`,
    ),
  );
  assert.equal(violations.length, 1, violations.join('\n'));
  assert.match(violations[0], /second write path into `access_attempt_log`/);
  assert.match(violations[0], /copyAttempt/);
});

test('an identity key the register does not list for the table fails', () => {
  const { violations } = runAudit(
    withSource(
      'server/storage/fictional-attempts.js',
      `export async function logAccessAttempt(scope, ua) {
         return db.insertInto('access_attempt_log').values({ user_agent: ua }).execute();
       }`,
    ),
  );
  assert.ok(
    violations.some((v) =>
      /user_agent, missing from its identityColumns/.test(v),
    ),
    violations.join('\n'),
  );
});

test('an identity write through .set() into an unregistered table fails', () => {
  const { violations } = runAudit(
    withSource(
      'server/storage/fictional-log.js',
      `export async function stampAgent(scope, id, ua) {
         return db.updateTable('fictional_visit_log').set({ user_agent: ua }).where('id', '=', id).execute();
       }`,
    ),
  );
  assert.equal(violations.length, 1, violations.join('\n'));
  assert.match(
    violations[0],
    /`fictional_visit_log` receives user_agent but is not in tests\/fixtures\/anonymous-visitor-stores\.json/,
  );
});

test('a .set() identity key the register does not list for the table fails', () => {
  const { violations } = runAudit(
    withSource(
      'server/storage/fictional-guests.js',
      `export async function stampGuestIp(scope, id, ip) {
         return db.updateTable('share_link_guests').where('id', '=', id).set({ ip_address: ip }).execute();
       }`,
    ),
  );
  assert.equal(violations.length, 1, violations.join('\n'));
  assert.match(
    violations[0],
    /`share_link_guests` is written with ip_address, missing from its identityColumns/,
  );
});

test('a spread in .values() or .set() fails as unreadable, once per site', () => {
  for (const [method, body] of [
    ['values', `db.insertInto('spread_log').values({ ...row }).execute()`],
    [
      'set',
      `db.updateTable('spread_log').set({ ...row }).where('id', '=', 1).execute()`,
    ],
  ]) {
    const { violations } = runAudit(
      withSource(
        'server/storage/fictional-spread.js',
        `export async function copyRow(scope, row) { return ${body}; }`,
      ),
    );
    assert.equal(violations.length, 1, violations.join('\n'));
    assert.equal(
      violations[0],
      `server/storage/fictional-spread.js:1: .${method}() spreads an object the gate cannot read; write the keys out`,
    );
  }
});

test('a register line whose evidence does not exist fails', () => {
  const broken = structuredClone(register);
  broken.stores.access_attempt_log.tests.push('tests/does-not-exist.test.js');
  broken.stores.access_attempt_log.cleanup.functions.push(
    'server/storage/access-attempts.js :: notExported',
  );
  broken.stores.access_attempt_log.erase = { exception: '  ' };
  broken.stores.access_attempt_log.producers.push(
    'server/storage/access-attempts.js :: stale',
  );
  const { violations } = runAudit({ register: broken });
  assert.deepEqual(
    violations.sort(),
    [
      '`access_attempt_log` cleanup: server/storage/access-attempts.js does not export notExported',
      '`access_attempt_log` cleanup: server/jobs/retention-cleanup.js does not call notExported',
      '`access_attempt_log` erase: an exception needs a reason',
      '`access_attempt_log` tests: tests/does-not-exist.test.js does not exist',
      "`access_attempt_log`: registered producer server/storage/access-attempts.js :: stale has no insertInto('access_attempt_log') site",
    ].sort(),
  );
});

test('a registered table the reference inventory does not name fails', () => {
  const stripped = referenceText.replace(
    /`access_attempt_log`/g,
    'the attempt table',
  );
  const { violations } = runAudit({ referenceText: stripped });
  assert.deepEqual(violations, [
    'reference inventory does not name `access_attempt_log`',
  ]);
});
