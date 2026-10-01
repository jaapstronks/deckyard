/**
 * One field, one naming rule, one answer for an installation cluster (D257).
 *
 * A cluster is a key; that key sits as `feature` on a mount, on a route row
 * and on an MCP tool, and `isFeatureEnabled(key)` answers for all of them.
 * This file pins that it stays one form:
 *
 *  1. Every declared `feature` lands on an `enable<Key>` key of the flag
 *     snapshot — the key is derived, so a typo would otherwise switch a module
 *     off for good instead of failing.
 *  2. Every cluster in `docs/reference/feature-flags.md` § Clusters has at
 *     least one declaration, and every declared key has a row there.
 *  3. The forms `feature` replaced stay gone: `ai: true` on a row, a
 *     `flags.x &&` branch in a mount chain, Notion's second table, the
 *     per-handler image-library checks, MCP's `permission === 'ai'` switch.
 *  4. `dispatchMounts` skips a mount whose cluster is off.
 *
 * The behaviour per cluster (404 with the cluster off) is pinned next to it:
 * `tests/ai-kill-switch.test.js` (AI, Notion), `tests/feed-*.test.js`,
 * `tests/data-sources-behavior.test.js`; the client half in
 * `tests/feature-entries-follow-flags.test.js`.
 *
 * Run with: node --test tests/feature-declarations.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.AUTH_SECRET = ['deckyard', 'test', 'feature-declarations']
  .join('-')
  .padEnd(40, '0');
delete process.env.AI_ENABLED;
delete process.env.DEMO_MODE;
delete process.env.SANDBOX_MODE;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const ROUTES_ROOT = join(repoRoot, 'server', 'routes');

const { getFeatureFlags, isFeatureEnabled, featureFlagKey } =
  await import('../server/config/flags-snapshot.js');
const { dispatchMounts } = await import('../server/utils/router.js');
const { PUBLIC_MOUNTS, MOUNTS } = await import('../server/routes/api/index.js');
const { V1_MOUNTS } = await import('../server/routes/public-api/v1/index.js');
const { STATIC_MOUNTS } = await import('../server/routes/static/index.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const isRouteTable = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (row) => row && 'pattern' in row && typeof row.handler === 'function',
  );

/** `[where, key]` for every `feature` declaration on the server. */
const declarations = [];

for (const [name, mounts] of Object.entries({
  PUBLIC_MOUNTS,
  MOUNTS,
  V1_MOUNTS,
  STATIC_MOUNTS,
})) {
  mounts.forEach((mount, index) => {
    if (mount.feature) declarations.push([`${name}[${index}]`, mount.feature]);
  });
}

for (const file of walk(ROUTES_ROOT)) {
  if (!/export const [A-Z_]*ROUTES\b/.test(readFileSync(file, 'utf8')))
    continue;
  const mod = await import(file);
  for (const [exportName, rows] of Object.entries(mod)) {
    if (!isRouteTable(rows)) continue;
    for (const row of rows)
      if (row.feature)
        declarations.push([
          `${relative(ROUTES_ROOT, file)}#${exportName} ${row.pattern}`,
          row.feature,
        ]);
  }
}

const mcp = new McpServer();
registerTools(mcp, { defaultOwnerEmail: 'owner@example.com' });
for (const tool of mcp.tools.values())
  if (tool.feature) declarations.push([`mcp:${tool.name}`, tool.feature]);

/** The keys in the § Clusters table of feature-flags.md. */
function documentedClusters() {
  const doc = readFileSync(
    join(repoRoot, 'docs', 'reference', 'feature-flags.md'),
    'utf8',
  );
  const section = doc.split(/^## Clusters$/m)[1]?.split(/^## /m)[0] ?? '';
  return [...section.matchAll(/^\| `([a-zA-Z]+)` +\|/gm)].map((m) => m[1]);
}

test('the scan sees the declarations at all', () => {
  // A broken scan would make every assertion below vacuous.
  assert.ok(declarations.length >= 20, `found ${declarations.length}`);
  const count = (prefix) =>
    declarations.filter(([w]) => w.startsWith(prefix)).length;
  assert.equal(count('MOUNTS['), 6, 'six feature mounts behind the login gate');
  assert.equal(count('V1_MOUNTS['), 1, 'v1 /ai');
  assert.equal(count('STATIC_MOUNTS['), 1, 'the feeds');
  assert.equal(count('mcp:'), 6, 'six AI tools');
  assert.ok(
    declarations.some(([w]) => w.startsWith('api/notion/index.js#ROUTES')),
    'the Notion import rows',
  );
});

test('every declared feature lands on an enable* key of the snapshot', () => {
  const flags = getFeatureFlags();
  for (const [where, key] of declarations) {
    assert.match(key, /^[a-z][a-zA-Z]*$/, `${where}: '${key}' is lowerCamel`);
    assert.ok(
      featureFlagKey(key) in flags,
      `${where}: '${key}' lands on no '${featureFlagKey(key)}'`,
    );
  }
});

test('every documented cluster is declared, and every declared one is documented', () => {
  const documented = documentedClusters();
  assert.ok(documented.length >= 6, 'the § Clusters table was not found');
  const declared = new Set(declarations.map(([, key]) => key));
  assert.deepEqual(
    [...declared].sort(),
    [...documented].sort(),
    'feature-flags.md § Clusters and the declarations disagree',
  );
});

test('isFeatureEnabled answers from the snapshot and refuses an unknown key', () => {
  assert.equal(isFeatureEnabled('ai'), getFeatureFlags().enableAi);
  process.env.AI_ENABLED = 'false';
  try {
    assert.equal(isFeatureEnabled('ai'), false);
  } finally {
    delete process.env.AI_ENABLED;
  }
  assert.throws(() => isFeatureEnabled('aI'), /unknown feature 'aI'/);
  assert.throws(() => isFeatureEnabled('bogus'), /unknown feature 'bogus'/);
});

test('dispatchMounts skips a mount whose cluster is off, and falls through', async () => {
  const seen = [];
  const mounts = [
    { handle: () => seen.push('ai') && true, feature: 'ai' },
    { handle: () => seen.push('plain') && false },
  ];
  assert.equal(await dispatchMounts(mounts, {}), true);
  assert.deepEqual(seen, ['ai']);

  process.env.AI_ENABLED = 'false';
  try {
    seen.length = 0;
    assert.equal(await dispatchMounts(mounts, {}), false);
    assert.deepEqual(seen, ['plain'], 'the ai mount never ran');
  } finally {
    delete process.env.AI_ENABLED;
  }
});

// ------------------------------------------------------- the replaced forms

const serverFiles = walk(join(repoRoot, 'server')).map((f) => ({
  rel: relative(repoRoot, f),
  src: readFileSync(f, 'utf8'),
}));

test('no route row says `ai: true` any more', () => {
  assert.deepEqual(
    serverFiles
      .filter(({ src }) => /^\s*ai: true,?$/m.test(src))
      .map((f) => f.rel),
    [],
  );
});

test('no mount chain branches on a flag', () => {
  for (const rel of [
    'server/routes/api/index.js',
    'server/routes/public-api/v1/index.js',
    'server/routes/static/index.js',
  ]) {
    const src = readFileSync(join(repoRoot, rel), 'utf8');
    assert.doesNotMatch(src, /flags\.\w+ &&/, rel);
    assert.doesNotMatch(src, /getFeatureFlags\(\)\.\w+ &&/, rel);
  }
});

test('the module-internal gates are gone', () => {
  const src = (rel) => readFileSync(join(repoRoot, rel), 'utf8');
  assert.doesNotMatch(src('server/routes/api/notion/index.js'), /GATED_ROUTES/);
  assert.doesNotMatch(
    src('server/routes/api/image-library.js'),
    /enableImageLibrary/,
  );
  assert.doesNotMatch(src('server/routes/feed.js'), /isRssFeedEnabled/);
  assert.doesNotMatch(
    src('server/routes/api/data-sources.js'),
    /isLiveDataEnabled/,
  );
  // The permission still selects the AI *quota*; it no longer decides
  // whether a tool exists.
  const mounted = src('server/mcp/authorization.js').match(
    /export function isToolMounted\([^)]*\) \{[^}]*\}/,
  );
  assert.ok(mounted, 'isToolMounted is found');
  assert.doesNotMatch(mounted[0], /permission/);
  assert.match(mounted[0], /tool\.feature/);
});
