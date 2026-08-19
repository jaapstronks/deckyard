/**
 * Every relative import in `custom/` resolves to a file that exists.
 *
 * This is the fork's half of the import-resolve gate. `import-x/no-unresolved`
 * (in `eslint.config.js`) covers `client/`, `server/`, `shared/`, `scripts/`,
 * `capture/` and `tests/` — but `custom/` is in the lint `ignores` list, because
 * upstream's copy of that tree is four `.gitkeep` files and a fork's is the
 * whole reason it exists. Yet `custom/` is precisely where the breakage lands:
 * fork code importing into a core tree that upstream reorganised.
 *
 * Why this class needs a gate at all: there is no bundler, so a moved module is
 * not a build error. ESM fails at *runtime*, on the import that never loads —
 * `npm test` stays green while the app no longer boots. That is what happened
 * when `client/lib/` was split into sub-folders and a fork's `client/app.js`
 * still imported `./lib/branding.js` (fork-upgrade finding B1).
 *
 * Upstream `custom/` is empty, so the real scan finds nothing to reject. Two
 * things keep that from reading as a pass:
 *
 * 1. The "the scan would notice files" assertion — the walk works and the
 *    drop-in directories are where they should be.
 * 2. The **self-test** at the bottom, which runs `brokenImportsIn()` over a
 *    throwaway temp tree holding one import that resolves and one that does not,
 *    and asserts it names exactly the broken one. That is what makes this file a
 *    gate rather than a promise: the resolution logic executes on every run,
 *    upstream included, on input designed to make it fail.
 *
 * The fork lane exercises the real path too: `tests/fixtures/fork-slide-types/`
 * is copied into `custom/slide-types/` by the `test-fork` CI job, and one of
 * those fixtures imports into `shared/` on purpose.
 *
 * Run with: node --test tests/custom-imports-resolvable.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { init as initLexer, parse as parseModule } from 'es-module-lexer';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const CUSTOM_DIR = path.join(REPO_ROOT, 'custom');

/**
 * Every `.js` file under `custom/`, repo-relative.
 * @param {string} dir
 * @returns {string[]}
 */
function jsFilesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Resolve one specifier the way Node's ESM loader would, minus package
 * resolution — a bare specifier is a package, and whether it is installed is
 * `npm`'s business, not this gate's.
 * @param {string} specifier
 * @param {string} fromDir
 * @returns {string | null} absolute path, or null when not resolvable
 */
function resolveRelative(specifier, fromDir) {
  const base = path.resolve(fromDir, specifier);
  // ESM does not do extension or index resolution, but a fork may still write
  // either; accepting them here would hide a real runtime failure, so only the
  // literal path counts.
  return fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
}

/**
 * @param {string} file absolute path
 * @returns {Promise<string[]>} the relative specifiers it imports
 */
async function relativeImportsOf(file) {
  const [imports] = parseModule(fs.readFileSync(file, 'utf8'), file);
  return (
    imports
      .map((i) => i.n)
      // `n` is undefined for a dynamic import with a computed specifier, and a
      // specifier that does not start with `.` or `/` is a package.
      .filter((n) => n && (n.startsWith('.') || n.startsWith('/')))
  );
}

/**
 * The whole check, over an arbitrary tree — so the real scan and the self-test
 * run the same code and neither can drift away from the other.
 * @param {string[]} files absolute paths
 * @param {string} root what the report paths are relative to
 * @returns {Promise<string[]>} `file → specifier` for each import that resolves to nothing
 */
async function brokenImportsIn(files, root) {
  const broken = [];
  for (const file of files) {
    for (const specifier of await relativeImportsOf(file)) {
      if (resolveRelative(specifier, path.dirname(file))) continue;
      broken.push(`${path.relative(root, file)} → ${specifier}`);
    }
  }
  return broken;
}

await initLexer;
const FILES = jsFilesUnder(CUSTOM_DIR);

test('the scan would notice files if a fork dropped some in', () => {
  // Upstream `custom/` holds only .gitkeep files, so an empty FILES list is the
  // expected state — but an empty list because the walk broke would make the
  // assertion below vacuous forever. Prove the walk works instead.
  assert.ok(fs.existsSync(CUSTOM_DIR), 'custom/ should exist in a checkout');
  const dirs = fs
    .readdirSync(CUSTOM_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  assert.ok(
    dirs.includes('slide-types') && dirs.includes('themes'),
    `custom/ should hold the fork drop-in directories, found: ${dirs.join(', ') || '(none)'}`,
  );
});

test('every relative import in custom/ resolves to a file that exists', async () => {
  const broken = await brokenImportsIn(FILES, REPO_ROOT);
  assert.deepEqual(
    broken,
    [],
    'these imports resolve to nothing — the app will fail at runtime, not at ' +
      `build time, because there is no bundler:\n  ${broken.join('\n  ')}\n\n` +
      'A core module probably moved. Check the release notes for the version ' +
      'you are upgrading to.',
  );
});

test('the resolver rejects what it should — a hermetic self-test on a temp tree', async () => {
  // Without this, upstream runs the assertion above over zero files and learns
  // nothing: a `resolveRelative` that returned a truthy value for everything
  // would pass CI forever and only fail in a fork. So build a tree that a
  // working checker MUST report on, and check it reports exactly that.
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'deckyard-custom-imports-'),
  );
  try {
    fs.mkdirSync(path.join(tmp, 'nested'));
    fs.writeFileSync(path.join(tmp, 'target.js'), 'export const ok = true;\n');
    fs.writeFileSync(
      path.join(tmp, 'nested', 'good.js'),
      "import { ok } from '../target.js';\nexport default ok;\n",
    );
    fs.writeFileSync(
      path.join(tmp, 'nested', 'broken.js'),
      "import { gone } from '../moved-away.js';\nexport default gone;\n",
    );

    // The walk finds every .js at every depth, and nothing else.
    assert.deepEqual(
      jsFilesUnder(tmp)
        .map((f) => path.relative(tmp, f).split(path.sep).join('/'))
        .sort(),
      ['nested/broken.js', 'nested/good.js', 'target.js'],
    );

    // The whole check, over that tree: one name, the right one.
    assert.deepEqual(await brokenImportsIn(jsFilesUnder(tmp), tmp), [
      'nested/broken.js → ../moved-away.js',
    ]);

    // And the leniency this resolver deliberately does not have, because the ESM
    // loader does not have it either: no extension resolution, no index
    // resolution. Both of these throw ERR_MODULE_NOT_FOUND at runtime.
    const fromNested = path.join(tmp, 'nested');
    assert.ok(
      resolveRelative('../target.js', fromNested),
      'the literal path resolves',
    );
    assert.equal(
      resolveRelative('../target', fromNested),
      null,
      'no extension resolution',
    );
    assert.equal(
      resolveRelative('../nested', fromNested),
      null,
      'no index/directory resolution',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
