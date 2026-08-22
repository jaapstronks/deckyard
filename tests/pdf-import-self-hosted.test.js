/**
 * PDF import parses an uploaded file with the build this repo pins.
 *
 * `server/render/pdf-to-images.js` opens a **user-uploaded** PDF inside the
 * shared headless browser — the same process that renders every deck, started
 * with `--no-sandbox` unless `PUPPETEER_SANDBOX=true`. It used to hand that
 * browser a hardcoded `cdnjs.cloudflare.com/…/pdf.js/3.11.174/pdf.min.js`,
 * pinned by nothing: `pdfjs-dist` was not a dependency, so no lockfile, no
 * integrity hash and no `npm audit` had an opinion about it. Meanwhile the
 * neighbouring render path inlines remote images through the SSRF guard
 * specifically so no user-supplied URL reaches that browser (B102).
 *
 * The harness is a `setContent()` document, so it has no origin to resolve
 * `/client/vendor/pdfjs/…` against: the two files are read from disk and
 * imported from blob URLs. That is what these tests pin — plus the vendoring
 * itself, which is what keeps the copy current.
 *
 * Run with: node --test tests/pdf-import-self-hosted.test.js
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
const readText = (rel) => fs.readFile(path.join(repoRoot, rel), 'utf8');

test('the harness names no third-party origin', async () => {
  const src = await readText('server/render/pdf-to-images.js');
  assert.doesNotMatch(src, /cdnjs\.cloudflare\.com/);
  assert.doesNotMatch(src, /https?:\/\/(?:cdn\.|cdnjs|unpkg|jsdelivr)/);
  // It reads the vendored files and hands them to the page as source.
  assert.ok(src.includes("'vendor'") && src.includes("'pdfjs'"));
  assert.match(src, /pdf\.min\.mjs/);
  assert.match(src, /pdf\.worker\.min\.mjs/);
  // A blob URL, because a setContent() document cannot resolve a path.
  assert.match(src, /createObjectURL/);
  assert.match(src, /GlobalWorkerOptions\.workerSrc/);
});

test('the vendored build is the version package-lock.json pins', async () => {
  const manifest = await readJson('client/vendor/pdfjs/manifest.json');
  const lock = await readJson('package-lock.json');
  const locked = lock.packages['node_modules/pdfjs-dist'];

  assert.ok(locked, 'pdfjs-dist is a real dependency, not an implied CDN one');
  assert.equal(
    manifest.version,
    locked.version,
    'run `npm run vendor:pdfjs` after bumping the pdfjs-dist dependency',
  );
  assert.ok(
    locked.integrity,
    'the lockfile entry carries the integrity hash that pins it',
  );

  const pkg = await readJson('package.json');
  assert.ok(
    pkg.dependencies['pdfjs-dist'],
    'pdfjs-dist is declared in dependencies',
  );
});

test('one pdfjs-dist in the tree, not two', async () => {
  // `pdf-parse` depends on pdfjs-dist at an exact version. Matching it keeps a
  // single copy; a `^` range resolves to the newest 5.x, npm nests pdf-parse's
  // pin underneath, and the install grows by ~70 MB (a second pdfjs-dist plus a
  // second @napi-rs/canvas native binary) to vendor two static files.
  const pkg = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  const viaPdfParse =
    lock.packages['node_modules/pdf-parse']?.dependencies?.['pdfjs-dist'];
  assert.ok(viaPdfParse, 'pdf-parse still declares a pdfjs-dist dependency');
  assert.equal(
    pkg.dependencies['pdfjs-dist'],
    viaPdfParse,
    'pdfjs-dist has drifted from the version pdf-parse pins, so the tree now ' +
      'carries two copies. Match it (exact, no caret) and re-run ' +
      '`npm run vendor:pdfjs`.',
  );
  assert.equal(
    lock.packages['node_modules/pdf-parse/node_modules/pdfjs-dist'],
    undefined,
    'the lockfile nests a second pdfjs-dist under pdf-parse',
  );
});

test('both files are vendored and look like the real builds', async () => {
  const lib = await readText('client/vendor/pdfjs/pdf.min.mjs');
  const worker = await readText('client/vendor/pdfjs/pdf.worker.min.mjs');
  assert.ok(lib.length > 100_000, 'pdf.min.mjs looks like the real build');
  assert.ok(worker.length > 100_000, 'the worker looks like the real build');
  // An ES module: the loader imports it, it does not run as a classic script.
  assert.match(lib, /\bexport\s*\{/);
});

test('postinstall vendors pdf.js so a fresh clone imports offline', async () => {
  const pkg = await readJson('package.json');
  assert.match(pkg.scripts.postinstall, /vendor-pdfjs\.js/);
  assert.equal(pkg.scripts['vendor:pdfjs'], 'node scripts/vendor-pdfjs.js');
});

test('the vendor script prunes, so a dropped file leaves the tree', async () => {
  // A script that only copies can never produce a deletion: an orphan then
  // regenerates byte-identical forever and CI's vendor-freshness job stays
  // green while the tree carries a file nothing lists (the lucide lesson, #864).
  const src = await readText('scripts/vendor-pdfjs.js');
  assert.match(src, /fs\.rm\(destDir, \{ recursive: true, force: true \}\)/);
});
