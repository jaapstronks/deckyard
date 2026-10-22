/**
 * The renderer has a bounded dependency closure, and the scan that says so
 * refuses the things it claims to refuse (T1.1, criteria 3 and 5).
 *
 * The finding this file pins is the measurement T1.1 existed to make. Before
 * it, the import closure of the published render path was **305 modules** and
 * reached `server/db/client.js` (through `server/utils/themes.js`, for one pure
 * function), `server/utils/ssrf-guard.js` (through a re-export of `escapeHtml`)
 * and `server/config/flags-snapshot.js` (through the public-output filter). A
 * renderer that can open a socket and a database connection is not frozen,
 * whatever its version number says.
 *
 * Three seam corrections closed all three edges - `themeVarsCssText` moved to
 * its own pure module, the `escapeHtml` re-export hop was removed, and the two
 * document assemblers were split from the preparers that read an installation.
 * What is left is asserted here, as properties rather than as a file list: a
 * pinned list of 140 modules would be a maintenance tax that fails on every
 * refactor without telling anyone anything.
 *
 * The second half of the file points the same scanner at tiny fixture trees, so
 * each refusal is proved by a bundle that *is* refused. A scan that only ever
 * ran over a passing checkout would be a scan nobody has seen say no.
 *
 * Run with: node --test tests/renderer-bundle-closure.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  RendererBundleBuildError,
  WORKER_ENTRY,
  rendererDependencyMap,
  scanClosure,
} from '../scripts/build-renderer-bundle.js';
import { repoRoot, tempDir } from './helpers/renderer-bundle.js';

const temps = [];
after(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

const map = await rendererDependencyMap(repoRoot);
const closure = await scanClosure(repoRoot, [WORKER_ENTRY]);
const modules = closure.files.map((f) =>
  path.relative(repoRoot, f).split(path.sep).join('/'),
);

test('the renderer closure is closed: the scan has nothing to refuse', () => {
  assert.deepEqual(map.refusals, []);
});

test('no module in the renderer reaches storage, the database or live config', () => {
  const forbidden = modules.filter(
    (m) =>
      m.startsWith('server/storage/') ||
      m.startsWith('server/db/') ||
      m.startsWith('server/media/') ||
      m === 'server/config/flags-snapshot.js' ||
      m === 'server/utils/html-utils.js' ||
      m === 'server/utils/ssrf-guard.js' ||
      m === 'server/utils/themes.js' ||
      m === 'server/utils/public-output.js',
  );
  assert.deepEqual(
    forbidden,
    [],
    'these modules read a current value, so they belong to the preparer, not the renderer',
  );
});

test('the renderer imports no package, and only file-and-compute builtins', () => {
  // Every bare specifier the scan accepted is either an allowed builtin or a
  // recorded unsealed edge; anything else would have become a refusal, which
  // the first test pins at zero. So this asserts the *shape* of what is left.
  assert.deepEqual(
    map.unsealed.map((e) => e.specifier).sort(),
    ['dompurify', 'jsdom'],
    'the sanitizer backend is the one unsealed edge T1.1 did not close',
  );
  for (const edge of map.unsealed) {
    assert.equal(edge.kind, 'dynamic');
    assert.equal(edge.importer, 'shared/sanitize.js');
    assert.ok(
      map.acceptedUnsealed[edge.specifier],
      'an unsealed edge carries the reason it is tolerated',
    );
  }
});

test('the renderer carries its own slide-type registry', () => {
  assert.ok(
    modules.includes('shared/slide-types/registry.js'),
    'the registry is frozen in the bundle, not read from the installation',
  );
  assert.ok(
    map.modulesByArea['shared/slide-types'] > 50,
    'the slide types themselves are renderer code',
  );
});

test('the files the renderer reads at run time are found, not assumed', () => {
  // The scan looks for `new URL('…', import.meta.url)` rather than keeping a
  // list, so a module that starts reading a new file cannot leave it out of the
  // bundle. These six are what that finds today.
  assert.deepEqual(map.runtimeReads.sort(), [
    'client/lib/slide-runtime/countdown-runtime.js',
    'client/lib/slide-runtime/logo-wall-balance.js',
    'client/lib/slide-runtime/team-cards-justify.js',
    'client/styles/slides/03-components/60-accessibility.css',
    'client/views/presenter/chrome-autohide.js',
    'client/views/presenter/fullscreen.js',
  ]);
});

test('the renderer freezes its stylesheets and the highlighter bytes', () => {
  assert.ok(map.counts.css > 50, 'the CSS @import closure is carried');
  assert.ok(
    map.counts['static-trees'] > 20,
    'the vendored Prism/KaTeX bytes are carried: they decide what a code block looks like',
  );
});

/** A fixture source root with one entry module, for the refusal tests. */
async function fixtureRoot(files) {
  const root = await tempDir('deckyard-closure-fixture-');
  temps.push(root);
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, source);
  }
  return root;
}

test('a network import is refused', async () => {
  const root = await fixtureRoot({
    'entry.js':
      "import { connect } from 'node:net';\nexport default connect;\n",
  });
  const { reasons } = await scanClosure(root, ['entry.js']);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /node:net.*network access is sealed/);
});

test('a database client is refused, through a module two steps away', async () => {
  const root = await fixtureRoot({
    'entry.js': "export { q } from './store.js';\n",
    'store.js': "import { Pool } from 'pg';\nexport const q = Pool;\n",
  });
  const { reasons } = await scanClosure(root, ['entry.js']);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /store\.js imports pg.*database access is sealed/);
});

test('a builtin outside the allowed set is refused even when harmless-looking', async () => {
  const root = await fixtureRoot({
    'entry.js': "import os from 'node:os';\nexport default os;\n",
  });
  const { reasons } = await scanClosure(root, ['entry.js']);
  assert.match(reasons[0], /node:os.*not an allowed builtin/);
});

test('a static package import is refused: a bundle carries no node_modules', async () => {
  const root = await fixtureRoot({
    'entry.js': "import sharp from 'sharp';\nexport default sharp;\n",
  });
  const { reasons } = await scanClosure(root, ['entry.js']);
  assert.match(reasons[0], /statically imports the package sharp/);
});

test('an unlisted dynamic package import is refused', async () => {
  const root = await fixtureRoot({
    'entry.js': "export const load = () => import('mammoth');\n",
  });
  const { reasons } = await scanClosure(root, ['entry.js']);
  assert.match(reasons[0], /dynamically imports the package mammoth/);
});

test('a computed dynamic import is refused unless its directory is frozen', async () => {
  const root = await fixtureRoot({
    'entry.js': 'export const load = (n) => import(`./types/${n}.js`);\n',
  });
  const { reasons } = await scanClosure(root, ['entry.js']);
  assert.match(reasons[0], /non-literal dynamic import/);
  // The one module allowed to do it is the fork type loader, whose directory
  // the bundle carries whole - and it is allowed by path, not by shape.
  assert.ok(
    Object.keys(map.sealedCapabilities).length > 0,
    'the sealed capability table is non-empty',
  );
});

test('a read of a file outside the checkout is refused', async () => {
  const root = await fixtureRoot({
    'entry.js':
      "import { readFileSync } from 'node:fs';\n" +
      "export const read = () => readFileSync(new URL('../outside.txt', import.meta.url));\n",
  });
  const { reasons } = await scanClosure(root, ['entry.js']);
  assert.match(reasons[0], /outside the checkout/);
});

test('a refusal names every reason, not the first one', () => {
  const err = new RendererBundleBuildError(['one', 'two']);
  assert.match(err.message, /- one/);
  assert.match(err.message, /- two/);
  assert.deepEqual(err.reasons, ['one', 'two']);
});
