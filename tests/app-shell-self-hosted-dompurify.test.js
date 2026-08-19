/**
 * The app shell must not fetch its sanitizer from a third-party CDN.
 *
 * DOMPurify is the defense-in-depth sanitizer for every bit of user HTML the
 * editor renders, so loading it from cdn.jsdelivr.net made a third party a
 * dependency of the app's security posture *and* of it booting at all. It is
 * now vendored from the pinned npm dependency.
 *
 * Run with: node --test tests/app-shell-self-hosted-dompurify.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const readJson = async (rel) =>
  JSON.parse(await fs.readFile(path.join(repoRoot, rel), 'utf8'));

test('index.html loads DOMPurify from this server, not from a CDN', async () => {
  const html = await fs.readFile(
    path.join(repoRoot, 'client/index.html'),
    'utf8',
  );

  assert.match(
    html,
    /<script src="\/client\/vendor\/dompurify\/purify\.min\.js"><\/script>/,
  );
  // No CDN copy left behind — neither as the loaded script nor as a fallback.
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/dompurify/);
});

test('the vendored bundle is the version package-lock.json pins', async () => {
  const manifest = await readJson('client/vendor/dompurify/manifest.json');
  const lock = await readJson('package-lock.json');
  const locked = lock.packages['node_modules/dompurify'];

  assert.equal(
    manifest.version,
    locked.version,
    'run `npm run vendor:dompurify` after bumping the dompurify dependency',
  );
  assert.ok(
    locked.integrity,
    'the lockfile entry carries the integrity hash that pins it',
  );
});

test('the vendored bundle is served and non-empty', async () => {
  const bundle = await fs.readFile(
    path.join(repoRoot, 'client/vendor/dompurify/purify.min.js'),
    'utf8',
  );
  assert.ok(bundle.length > 10_000, 'looks like the real minified build');
  assert.match(bundle, /DOMPurify/);

  // client/ is a shared public dir, so /client/vendor/... resolves without a
  // dedicated route.
  const { SHARED_PUBLIC_DIRS } = await import('../server/config/paths.js');
  assert.ok(SHARED_PUBLIC_DIRS.some((d) => d.urlPrefix === '/client/'));
});

test('postinstall vendors DOMPurify so a fresh clone boots offline', async () => {
  const pkg = await readJson('package.json');
  assert.match(pkg.scripts.postinstall, /vendor-dompurify\.js/);
  assert.equal(
    pkg.scripts['vendor:dompurify'],
    'node scripts/vendor-dompurify.js',
  );
});
