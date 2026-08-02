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
 * Upstream this test is near-vacuous by construction, and that is fine: it costs
 * nothing and it is live the moment a fork drops a module in. The "the scan
 * would notice files" assertion below keeps a silently-empty scan from reading
 * as a pass.
 *
 * Run with: node --test tests/custom-imports-resolvable.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { init as initLexer, parse as parseModule } from 'es-module-lexer';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  return imports
    .map((i) => i.n)
    // `n` is undefined for a dynamic import with a computed specifier, and a
    // specifier that does not start with `.` or `/` is a package.
    .filter((n) => n && (n.startsWith('.') || n.startsWith('/')));
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
    `custom/ should hold the fork drop-in directories, found: ${dirs.join(', ') || '(none)'}`
  );
});

test('every relative import in custom/ resolves to a file that exists', async () => {
  const broken = [];
  for (const file of FILES) {
    for (const specifier of await relativeImportsOf(file)) {
      if (resolveRelative(specifier, path.dirname(file))) continue;
      broken.push(`${path.relative(REPO_ROOT, file)} → ${specifier}`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    'these imports resolve to nothing — the app will fail at runtime, not at ' +
      `build time, because there is no bundler:\n  ${broken.join('\n  ')}\n\n` +
      'A core module probably moved. Check the release notes for the version ' +
      'you are upgrading to.'
  );
});
