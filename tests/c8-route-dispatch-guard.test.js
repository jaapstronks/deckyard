/**
 * A7.19 C8 fase 3 — the dispatch gate.
 *
 * The ROUTES table (docs/reference/route-dispatch.md) is the single dispatch
 * form for `/api/*` route modules. This test fails on any hand-written path
 * compare in `server/routes/**` outside a ROUTES table:
 *
 *   - `…pathname === '…'`
 *   - `…pathname.match(…)`
 *   - `….exec(url.pathname)` / `….test(url.pathname)`
 *   - `…pathname.startsWith(…)` — EXCEPT the one sanctioned idiom, the
 *     module prefix guard in an entry function:
 *       `if (!<x>.pathname.startsWith('/api/…')) return false;`
 *     (single-line or with the `return false;` on the next line). The prefix
 *     guard is part of the canonical form — without it every module's table
 *     would be walked on every request (route-dispatch.md § the prefix guard
 *     stays).
 *
 * Files that still dispatch by hand are listed in ALLOWLIST below, each with
 * the reason it is allowed to. The goal is an empty list: an entry disappears
 * when its module migrates, and this test also fails when an entry goes stale
 * (file gone or clean), so the list can only shrink.
 *
 * Run with: node --test tests/c8-route-dispatch-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const ROUTES_ROOT = join(repoRoot, 'server', 'routes');

/**
 * Directory subtrees that are not the `/api/*` module-dispatch surface the
 * ROUTES-table norm governs. Everything under them is exempt as a group.
 */
const EXEMPT_TREES = [
  // The public v1 API is a separately versioned, OpenAPI-documented contract
  // with its own dispatcher and middleware (routes/public-api/v1/index.js).
  // Whether it moves to the shared table is an A7.4-adjacent decision, not a
  // fase-2 migration.
  'public-api/',
  // Static/published/embed viewers serve HTML and files; they are not part of
  // the /api dispatch surface the norm covers.
  'static/',
];

/**
 * Individual files still dispatching by hand, each with the reason. Remove
 * the entry when the module migrates — the staleness check below enforces
 * that this list only shrinks.
 */
const ALLOWLIST = new Map([
  // ── deliberate, migrate under dedicated review ──
  ['api/index.js',
    'root dispatcher: the maintenance endpoint, the /api/v1 prefix probe, and the public follow-code regex — the latter is security-sensitive (it decides which follow-code reads skip the login gate) and migrates under its own review (route-dispatch.md § the closing gate)'],
  ['api/follow.js',
    'follow surface: public audience routes; migrates in its own PR with security review (brief C8 fase 2)'],
  ['api/follow-codes.js',
    'follow-code surface: split public/authed around the login gate via the index.js regex; migrates together with that regex under security review'],

  // ── fase-2 tail, not yet migrated ──
  ['api/auth.js',
    'pre-auth login/session module; deliberately outside the unattended fase-2 batches — auth flows migrate with eyes on them'],
  ['api/password-reset.js',
    'pre-auth password-reset module; same reasoning as auth.js'],
  ['api/magic-link.js',
    'pre-auth magic-link module; same reasoning as auth.js'],
  ['api/sso.js',
    'pre-auth OIDC login/callback module; same reasoning as auth.js'],
  ['api/leads.js',
    'public (pre-gate) lead capture + authed listing; small pre-auth module, fase-2 tail'],
  ['api/share-links/guests.js',
    'share-links family: one module across four files with an internal handler split; migrates as one PR (fase-2 tail)'],
  ['api/share-links/management.js', 'share-links family (see guests.js entry)'],
  ['api/share-links/public.js', 'share-links family (see guests.js entry)'],
  ['static.js',
    'top-level static dispatcher (viewers, uploads, client files) — not the /api dispatch surface'],
]);

const BANNED = [
  { name: 'pathname ===', re: /\bpathname\s*===/ },
  { name: 'pathname.match(', re: /\bpathname\s*\.match\(/ },
  { name: '.exec(…pathname)', re: /\.exec\(\s*[\w.]*pathname\s*\)/ },
  { name: '.test(…pathname)', re: /\.test\(\s*[\w.]*pathname\s*\)/ },
];

const PREFIX_GUARD = /if\s*\(\s*!\s*[\w$.]*\.pathname\.startsWith\(\s*['"][^'"]+['"]\s*\)\s*\)/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith('.js')) yield p;
  }
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** Collect rule violations in one file. */
function scanFile(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isComment(line)) continue;

    for (const { name, re } of BANNED) {
      if (re.test(line)) violations.push({ line: i + 1, rule: name, text: line.trim() });
    }

    if (/\.pathname\.startsWith\(/.test(line)) {
      const guardShaped = PREFIX_GUARD.test(line);
      const sameLineReturn = /return false;?\s*$/.test(line);
      const next = (lines[i + 1] || '').trim();
      const nextNext = (lines[i + 2] || '').trim();
      const nextLineReturn = next === 'return false;' || (next === '{' && nextNext === 'return false;');
      if (!(guardShaped && (sameLineReturn || nextLineReturn))) {
        violations.push({
          line: i + 1,
          rule: 'pathname.startsWith outside the prefix-guard idiom',
          text: line.trim(),
        });
      }
    }
  }

  return violations;
}

test('no hand-written path compares in server/routes/** outside a ROUTES table', () => {
  const offenders = [];

  for (const abs of walk(ROUTES_ROOT)) {
    const rel = relative(ROUTES_ROOT, abs).split('\\').join('/');
    if (EXEMPT_TREES.some((prefix) => rel.startsWith(prefix))) continue;
    if (ALLOWLIST.has(rel)) continue;

    for (const v of scanFile(abs)) {
      offenders.push(`server/routes/${rel}:${v.line} [${v.rule}] ${v.text}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'Hand-written path compares outside a ROUTES table.\n' +
      'Migrate the module to a ROUTES table (docs/reference/route-dispatch.md) — ' +
      'or, for a deliberate exception, add an ALLOWLIST entry WITH a reason:\n' +
      offenders.join('\n')
  );
});

test('the allowlist carries no stale entries', () => {
  const stale = [];

  for (const [rel, reason] of ALLOWLIST) {
    const abs = join(ROUTES_ROOT, rel);
    assert.ok(reason && reason.length > 10, `${rel}: an allowlist entry needs a real reason`);
    if (!existsSync(abs)) {
      stale.push(`${rel}: file no longer exists — drop the entry`);
      continue;
    }
    if (scanFile(abs).length === 0) {
      stale.push(`${rel}: no hand-written path compares left — drop the entry`);
    }
  }

  assert.deepEqual(stale, [], `Stale allowlist entries:\n${stale.join('\n')}`);
});

test('the sanctioned prefix-guard idiom itself stays accepted', () => {
  // Regression pin for the idiom matcher: both spellings used by migrated
  // modules must pass, and a positive startsWith dispatch must not.
  const ok1 = "  if (!ctx.url.pathname.startsWith('/api/media/')) return false;";
  const ok2 = "  if (!url.pathname.startsWith('/api/admin/users')) {";
  const bad = "  if (url.pathname.startsWith('/api/follow-codes')) {";
  assert.ok(PREFIX_GUARD.test(ok1));
  assert.ok(PREFIX_GUARD.test(ok2));
  assert.ok(!PREFIX_GUARD.test(bad));
});
