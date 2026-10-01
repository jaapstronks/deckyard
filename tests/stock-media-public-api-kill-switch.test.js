/**
 * The stock media and public API cluster switches reach every server surface
 * of their cluster (B525, D258, D260, D261).
 *
 * `STOCK_MEDIA_ENABLED=false`: the stock media mount (all fourteen rows,
 * the bundled manifest included) is skipped, so `/api/stock-media/*` reaches
 * the 404 at the end of `handleApi`.
 *
 * `PUBLIC_API_ENABLED=false`: the API-key surfaces are absent — v1
 * (`API_KEY_MOUNTS`), the `/mcp` transport (`ROOT_MOUNTS`, then the static
 * chain's 404), key management (`MOUNTS`) — and the stdio MCP server stops at
 * start with one line. The MCP session sweep keeps running (D261).
 *
 * The OpenAPI spec is served filtered: a path whose `x-feature` cluster is off
 * is left out (`tests/openapi-route-diff.test.js` pins the marker itself).
 *
 * The client half (no entry) is in `tests/feature-entries-follow-flags.test.js`.
 *
 * Run with: node --test tests/stock-media-public-api-kill-switch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

process.env.AUTH_SECRET = ['deckyard', 'test', 'stock-public-api-switch']
  .join('-')
  .padEnd(40, '0');
delete process.env.STOCK_MEDIA_ENABLED;
delete process.env.PUBLIC_API_ENABLED;
delete process.env.AI_ENABLED;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const { dispatchMounts } = await import('../server/utils/router.js');
const { API_KEY_MOUNTS, MOUNTS } =
  await import('../server/routes/api/index.js');
const { ROOT_MOUNTS } = await import('../server/server.js');
const { filterOpenApiSpec } =
  await import('../server/routes/public-api/v1/index.js');
const { getFeatureFlags } = await import('../server/config/flags-snapshot.js');
const { handleAppRoutes } =
  await import('../server/routes/static/app-shell.js');

test.afterEach(() => {
  delete process.env.STOCK_MEDIA_ENABLED;
  delete process.env.PUBLIC_API_ENABLED;
  delete process.env.AI_ENABLED;
});

/** A response double capturing the status. */
function makeRes() {
  return {
    statusCode: null,
    headers: {},
    headersSent: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status) {
      this.statusCode = status;
      this.headersSent = true;
      return this;
    },
    write() {
      return true;
    },
    end() {
      if (this.statusCode === null) this.statusCode = 200;
      return this;
    },
  };
}

function ctx(method, pathname) {
  return {
    req: { method, headers: {}, on() {}, once() {} },
    res: makeRes(),
    url: new URL(`http://localhost${pathname}`),
    authedUser: { id: 'u-1', email: 'owner@example.com', role: 'admin' },
    storageScope: null,
    repoRoot,
  };
}

test('the snapshot carries enableStockMedia and enablePublicApi, default on', () => {
  assert.equal(getFeatureFlags().enableStockMedia, true);
  assert.equal(getFeatureFlags().enablePublicApi, true);
  process.env.STOCK_MEDIA_ENABLED = 'false';
  process.env.PUBLIC_API_ENABLED = 'false';
  assert.equal(getFeatureFlags().enableStockMedia, false);
  assert.equal(getFeatureFlags().enablePublicApi, false);
});

const STOCK_PATHS = [
  ['GET', '/api/stock-media/status'],
  ['GET', '/api/stock-media/bundled/manifest'],
  ['GET', '/api/stock-media/unsplash/search'],
  ['POST', '/api/stock-media/giphy/download'],
];

for (const [method, path] of STOCK_PATHS) {
  test(`${method} ${path}: no mount takes it with STOCK_MEDIA_ENABLED=false`, async () => {
    process.env.STOCK_MEDIA_ENABLED = 'false';
    const c = ctx(method, path);
    assert.equal(await dispatchMounts(MOUNTS, c), false);
    assert.equal(c.res.statusCode, null, 'nothing was written');
  });
}

test('the stock media status answers with the cluster on', async () => {
  const c = ctx('GET', '/api/stock-media/bundled/manifest');
  assert.equal(await dispatchMounts(MOUNTS, c), true);
});

const PUBLIC_API_PATHS = [
  [API_KEY_MOUNTS, 'GET', '/api/v1'],
  [API_KEY_MOUNTS, 'GET', '/api/v1/openapi.yaml'],
  [API_KEY_MOUNTS, 'GET', '/api/v1/presentations'],
  [MOUNTS, 'GET', '/api/api-keys'],
  [MOUNTS, 'DELETE', '/api/api-keys/k-1'],
  [ROOT_MOUNTS, 'POST', '/mcp'],
];

for (const [mounts, method, path] of PUBLIC_API_PATHS) {
  test(`${method} ${path}: no mount takes it with PUBLIC_API_ENABLED=false`, async () => {
    process.env.PUBLIC_API_ENABLED = 'false';
    const c = ctx(method, path);
    assert.equal(await dispatchMounts(mounts, c), false);
    assert.equal(c.res.statusCode, null, 'nothing was written');
  });
}

test('v1 answers its info endpoint with the cluster on', async () => {
  const c = ctx('GET', '/api/v1');
  assert.equal(await dispatchMounts(API_KEY_MOUNTS, c), true);
  assert.equal(c.res.statusCode, 200);
});

test('/mcp with the cluster off is no page of the app shell either', async () => {
  process.env.PUBLIC_API_ENABLED = 'false';
  assert.equal(await handleAppRoutes(ctx('GET', '/mcp')), false);
});

test('npm run mcp stops at start with one line when the cluster is off', () => {
  const run = spawnSync(process.execPath, ['server/mcp/index.js'], {
    cwd: repoRoot,
    env: { ...process.env, PUBLIC_API_ENABLED: 'false' },
    input: '',
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(run.status, 1);
  assert.equal(
    run.stderr.trim(),
    '[MCP] PUBLIC_API_ENABLED=false: this installation has no MCP server.',
  );
});

test('boot: the MCP session sweep runs either way; one boot line while off (D261)', () => {
  const src = readFileSync(new URL('../server/server.js', import.meta.url), {
    encoding: 'utf8',
  });
  assert.match(src, /^\s*scheduleMcpSessionSweep\(\),/m);
  assert.match(
    src,
    /if \(!isFeatureEnabled\('publicApi'\)\) await warnApiKeysWhileOff\(\)/,
  );
});

// ------------------------------------------------------ the served spec

const SPEC = readFileSync(new URL('../docs/openapi.yaml', import.meta.url), {
  encoding: 'utf8',
});
const AI_PATHS = [
  '/ai/vendors',
  '/ai/wizard',
  '/ai/append-slides',
  '/presentations/{id}/translate',
];

test('the spec is served as written while every cluster is on', () => {
  assert.equal(filterOpenApiSpec(SPEC), SPEC);
});

test('with AI off the served spec leaves the x-feature: ai paths out', () => {
  process.env.AI_ENABLED = 'false';
  const served = parseYaml(filterOpenApiSpec(SPEC));
  for (const p of AI_PATHS) assert.ok(!(p in served.paths), `${p} is out`);
  const all = parseYaml(SPEC);
  const kept = Object.keys(all.paths).filter((p) => !AI_PATHS.includes(p));
  assert.deepEqual(Object.keys(served.paths), kept, 'the rest is all there');
});
