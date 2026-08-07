/**
 * Guard: `getDefaultOrganizationId()` is only called from a fixed allowlist.
 *
 * The default organization is the single-organization answer to "which organization
 * does this act in". Reaching for it on the request path — as a `|| getDefault…`
 * tail on a value that should already carry the organization — hands an
 * unfiltered query the default organization on a multi-organization instance, which
 * is the tenant-isolation leak `server/storage/scope.js` exists to prevent. The
 * org-scoping decision (docs/reference/tenant-isolation.md § *Which domains
 * partition on the organization*; brief `org-scoping-decision.md`
 * § *Uitvoeringsspec fallback-sweep*) swept those tails out and pinned the
 * legitimate callers to the list below.
 *
 * Every remaining caller is here on purpose:
 *   - the definition itself, and the two doctrine forms that answer only in
 *     single-organization mode and throw otherwise (`singleOrganizationScope`, and the
 *     `isDefaultOrganization` comparison);
 *   - boot/no-request paths that have no session to resolve an org from
 *     (auth disabled + dev bypass, identity fallback, sandbox cleanup);
 *   - the pre-auth route-context default (reset / magic-link / SSO have no
 *     resolved org yet);
 *   - the RSS feed + its autodiscovery links, which are per-organization but
 *     have no session, so they use the default org *and 404 / omit the links
 *     under multi-organization* rather than serve one organization instance-globally.
 *
 * A file that is NOT on the list but calls the function fails this test — add the
 * organization to the call site instead. A file that IS on the list but no longer
 * calls it also fails, so the allowlist can't rot into a stale rubber stamp.
 *
 * Run with: node --test tests/default-org-fallback-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const TARGET_DIR = 'server';

// { file: 'server/…', reason: '…' } — the sanctioned rest list. Keep it exact:
// this is the complete set of legitimate `getDefaultOrganizationId()` callers.
const ALLOWLIST = [
  { file: 'server/config/database.js', reason: 'the definition itself' },
  {
    file: 'server/storage/scope.js',
    reason: 'singleOrganizationScope() — the doctrine form, throws under multi-organization',
  },
  {
    file: 'server/storage/user-organizations/organizations.js',
    reason: 'isDefaultOrganization() comparison',
  },
  {
    file: 'server/storage/identity.js',
    reason: 'single-organization identity fallback (no membership row to read)',
  },
  {
    file: 'server/utils/sandbox-cleanup.js',
    reason: 'the sandbox is single-org by definition',
  },
  {
    file: 'server/auth/auth.js',
    reason: 'auth-disabled and dev-bypass synthetic users (no session org)',
  },
  {
    file: 'server/utils/context.js',
    reason: 'createRouteContext pre-auth default (reset / magic-link / SSO have no resolved org)',
  },
  {
    file: 'server/routes/feed.js',
    reason: 'per-org feed with no session; 404s under multi-organization (see handleFeed)',
  },
  {
    file: 'server/routes/static/app-shell.js',
    reason: 'feed autodiscovery links; omitted under multi-organization (see injectFeedDiscovery)',
  },
];

// Matches a call `getDefaultOrganizationId(` — the definition line matches too
// (config/database.js is allowlisted); bare `import { getDefaultOrganizationId }`
// has no following `(`, so imports never trip the guard.
const CALL = /getDefaultOrganizationId\s*\(/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function callSites(file) {
  const rel = path.relative(repoRoot, file).split(path.sep).join('/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    const trimmed = line.trimStart();
    // Skip comment-only lines so prose mentioning the function is fine.
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (CALL.test(line)) hits.push(`${rel}:${i + 1}  ${trimmed.trim()}`);
  });
  return { rel, hits };
}

test('getDefaultOrganizationId() is only called from the sanctioned allowlist', () => {
  const allowed = new Set(ALLOWLIST.map((a) => a.file));
  const callers = new Set();
  const violations = [];

  for (const file of walk(path.join(repoRoot, TARGET_DIR))) {
    const { rel, hits } = callSites(file);
    if (hits.length === 0) continue;
    callers.add(rel);
    if (!allowed.has(rel)) violations.push(...hits);
  }

  assert.equal(
    violations.length,
    0,
    'These files call getDefaultOrganizationId() but are not on the allowlist — ' +
      'pass the organization to the call site instead of falling back to the default:\n  ' +
      violations.join('\n  ')
  );

  // The allowlist must stay exact: an entry that no longer calls the function is
  // dead and should be removed, so it can't drift into a rubber stamp.
  const stale = ALLOWLIST.filter((a) => !callers.has(a.file)).map((a) => a.file);
  assert.equal(
    stale.length,
    0,
    `These allowlist entries no longer call getDefaultOrganizationId() — remove them:\n  ${stale.join('\n  ')}`
  );
});
