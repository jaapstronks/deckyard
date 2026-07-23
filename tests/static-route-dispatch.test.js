/**
 * Static/public router: dispatch wiring + the path-traversal guard. Guards the
 * split of the former 654-line handleStatic if-chain into per-route handlers
 * under server/routes/static/. Storage-backed routes (embed, published, share)
 * are covered by their own integration tests; here we verify the cheap,
 * self-contained behaviour: unmatched → 404, traversal → 404, and that every
 * handler module exports its function.
 *
 * Run with: node --test tests/static-route-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';

const { handleStatic } = await import('../server/routes/static.js');
const { handleStaticFiles } = await import('../server/routes/static/static-files.js');

function fakeRes() {
  return {
    statusCode: null,
    ended: false,
    writeHead(code) {
      this.statusCode = code;
      return this;
    },
    setHeader() {},
    end() {
      this.ended = true;
    },
  };
}

test('unmatched path falls through to 404', async () => {
  const res = fakeRes();
  await handleStatic({
    repoRoot: '/tmp',
    req: { method: 'GET', headers: {} },
    res,
    url: { pathname: '/totally-unknown-xyz', search: '' },
    clientDir: '/tmp',
    sharedPublicDirs: [],
  });
  assert.equal(res.statusCode, 404, 'responds 404');
  assert.equal(res.ended, true);
});

test('static file serving blocks path traversal', () => {
  const res = fakeRes();
  const handled = handleStaticFiles({
    res,
    url: { pathname: '/assets/../../../etc/passwd' },
    sharedPublicDirs: [{ urlPrefix: '/assets/', dir: os.tmpdir() }],
  });
  assert.equal(handled, true, 'prefix matched, so it handled the request');
  assert.equal(res.statusCode, 404, 'traversal is rejected with 404');
});

test('a non-matching prefix is not handled (falls through)', () => {
  const res = fakeRes();
  const handled = handleStaticFiles({
    res,
    url: { pathname: '/nope/thing.js' },
    sharedPublicDirs: [{ urlPrefix: '/assets/', dir: os.tmpdir() }],
  });
  assert.equal(handled, false);
});

test('all static handler modules export their handler function', async () => {
  const mods = {
    'static-files.js': ['handleGo', 'handleStaticFiles'],
    'embed.js': ['handleEmbed'],
    'published.js': ['handlePublishedReader', 'handlePublishedPage'],
    'sandbox-og.js': ['handleSandboxOg'],
    'share-viewer.js': ['handleShareLink'],
    'app-shell.js': ['serveAppIndex', 'handleAppRoutes'],
  };
  for (const [file, names] of Object.entries(mods)) {
    const mod = await import(`../server/routes/static/${file}`);
    for (const name of names) {
      assert.equal(typeof mod[name], 'function', `${file} exports ${name}`);
    }
  }
});
