/**
 * Every relative import in `custom/` resolves to a file that exists, and names
 * an export that file actually has.
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
 * Resolving the file is not enough, which the v1.10 → v1.27 fork upgrade
 * proved: `shared/slide-types/helpers.js` resolved perfectly while the `esc`
 * the fork imported from it had been renamed to `escapeHtml`. The custom
 * loader catches the throw and logs it, so the app boots with the fork's title
 * slide simply *absent* — on a deck that uses it the failure presents as "our
 * title slide is gone", not as an error, and in a 550-commit merge that reads
 * as something you broke yourself. So the named-import check below asks the
 * second question: does the module export the name. Barrels are followed
 * through `export * from './…'`, since that is how `shared/` publishes most of
 * what a custom type imports.
 *
 * Upstream `custom/` is empty, so the real scans find nothing to reject. Two
 * things keep that from reading as a pass:
 *
 * 1. The "the scan would notice files" assertion — the walk works and the
 *    drop-in directories are where they should be.
 * 2. The **self-tests** at the bottom, which run the same functions over
 *    throwaway temp trees built to make them fail — a moved module, a renamed
 *    export, a renamed export behind a barrel, a default that isn't there —
 *    and assert they name exactly the broken ones. That is what makes this
 *    file a gate rather than a promise: the logic executes on every run,
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

/** A specifier that names a file rather than a package. */
function isRelative(n) {
  return Boolean(n) && (n.startsWith('.') || n.startsWith('/'));
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
      .filter(isRelative)
  );
}

/** The `{ … }` clause of an import/export statement, or null when it has none. */
function braceClause(statement) {
  const open = statement.indexOf('{');
  const close = statement.indexOf('}', open + 1);
  return open === -1 || close === -1 ? null : statement.slice(open + 1, close);
}

/**
 * The names a statement binds FROM the module it names — `{ a, b as c }` binds
 * `a` and `b`, a default import binds `default`. A namespace import
 * (`* as ns`) binds nothing checkable: the whole module object is the binding,
 * and reading a missing property off it is a runtime `undefined`, not a load
 * failure, so it is out of scope here.
 * @param {string} statement - Source text of one import/export statement
 * @returns {string[]}
 */
function importedNames(statement) {
  const names = [];
  const clause = braceClause(statement);
  if (clause) {
    for (const part of clause.split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (name) names.push(name);
    }
  }
  // A default binding sits between `import` and the first `{` or `from`.
  const head = /^\s*import\s+([^{;]*?)\s*(?:,|from\b)/.exec(statement);
  const bare = head?.[1]?.trim();
  if (bare && !bare.startsWith('*') && !bare.startsWith('{'))
    names.push('default');
  return names;
}

/**
 * Every name a module provides, following `export * from './…'` chains.
 * A star re-export from a PACKAGE is not followed — whether it is installed is
 * npm's business, same boundary `resolveRelative` draws — and makes the answer
 * `null`, meaning "cannot be sure", which suppresses reporting.
 * @param {string} file - absolute path
 * @param {Set<string>} [seen] - cycle guard
 * @returns {Set<string>|null} exported names, or null when unknowable
 */
function exportedNamesOf(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  const [imports, exports] = parseModule(src, file);
  const names = new Set(exports.map((e) => e.n));
  for (const imp of imports) {
    // `ss`..`se` spans the whole statement, which is how a star re-export is
    // told apart from a plain import of the same module.
    if (!/^export\s*\*/.test(src.slice(imp.ss, imp.se))) continue;
    if (!isRelative(imp.n)) return null;
    const target = resolveRelative(imp.n, path.dirname(file));
    if (!target) continue; // already reported by the resolve check
    const inner = exportedNamesOf(target, seen);
    if (!inner) return null;
    for (const n of inner) names.add(n);
  }
  return names;
}

/**
 * Named imports that resolve to a module which does not export them.
 *
 * The resolve check above only proves the FILE is there. `helpers.js` resolved
 * perfectly while the fork's `esc` had been renamed to `escapeHtml` — the
 * custom loader caught the throw, logged it, and the app booted with the
 * fork's title slide simply absent. On a deck that used it the failure
 * presents as "our title slide is gone", not as an error.
 *
 * @param {string[]} files absolute paths
 * @param {string} root what the report paths are relative to
 * @returns {Promise<string[]>} `file → specifier: name` per missing export
 */
async function missingNamedImportsIn(files, root) {
  const missing = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const [imports] = parseModule(src, file);
    for (const imp of imports) {
      if (!isRelative(imp.n)) continue;
      const statement = src.slice(imp.ss, imp.se);
      // A dynamic import binds nothing at load time; its names are read off
      // the resolved namespace object at runtime.
      if (imp.d > -1) continue;
      const target = resolveRelative(imp.n, path.dirname(file));
      if (!target) continue; // the resolve check owns this one
      const provided = exportedNamesOf(target);
      if (!provided) continue;
      for (const name of importedNames(statement)) {
        if (provided.has(name)) continue;
        missing.push(`${path.relative(root, file)} → ${imp.n}: ${name}`);
      }
    }
  }
  return missing;
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

test('every named import in custom/ names a real export', async () => {
  const missing = await missingNamedImportsIn(FILES, REPO_ROOT);
  assert.deepEqual(
    missing,
    [],
    'these imports name exports that do not exist — the module fails to load ' +
      `at runtime, and the custom loader swallows it:\n  ${missing.join('\n  ')}\n\n` +
      'A core export was probably renamed. Check the release notes for the ' +
      'version you are upgrading to.',
  );
});

test('the export check rejects what it should — hermetic self-test', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckyard-named-imports-'));
  try {
    // A rename exactly like the one that broke the fork: the file still
    // resolves, the name does not.
    fs.writeFileSync(
      path.join(tmp, 'helpers.js'),
      'export function escapeHtml(s) {\n  return s;\n}\nexport default 1;\n',
    );
    fs.writeFileSync(
      path.join(tmp, 'renamed.js'),
      "import { esc } from './helpers.js';\nexport default esc;\n",
    );
    fs.writeFileSync(
      path.join(tmp, 'fine.js'),
      "import def, { escapeHtml as e } from './helpers.js';\nexport default [def, e];\n",
    );
    // A barrel that only re-exports: the name lives one hop away.
    fs.writeFileSync(
      path.join(tmp, 'barrel.js'),
      "export * from './helpers.js';\n",
    );
    fs.writeFileSync(
      path.join(tmp, 'via-barrel.js'),
      "import { escapeHtml } from './barrel.js';\nexport default escapeHtml;\n",
    );
    fs.writeFileSync(
      path.join(tmp, 'via-barrel-missing.js'),
      "import { esc } from './barrel.js';\nexport default esc;\n",
    );
    // A namespace import binds the module object, not a name — unknowable
    // here, and a missing property is `undefined` at use, not a load failure.
    fs.writeFileSync(
      path.join(tmp, 'namespace.js'),
      "import * as all from './helpers.js';\nexport default all;\n",
    );

    assert.deepEqual(
      (await missingNamedImportsIn(jsFilesUnder(tmp), tmp)).sort(),
      [
        'renamed.js → ./helpers.js: esc',
        'via-barrel-missing.js → ./barrel.js: esc',
      ],
      'exactly the two renamed imports, including the one behind a barrel',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a default import of a module with no default export is caught', async () => {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'deckyard-default-import-'),
  );
  try {
    fs.writeFileSync(path.join(tmp, 'named-only.js'), 'export const a = 1;\n');
    fs.writeFileSync(
      path.join(tmp, 'wants-default.js'),
      "import thing from './named-only.js';\nexport default thing;\n",
    );
    assert.deepEqual(await missingNamedImportsIn(jsFilesUnder(tmp), tmp), [
      'wants-default.js → ./named-only.js: default',
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
