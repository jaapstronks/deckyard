/**
 * The tracked fork slide-type fixtures (`tests/fixtures/fork-slide-types/`),
 * imported the way the `test-fork` CI job installs them: from a directory two
 * levels below the repo root.
 *
 * They cannot be imported in place. A fork type's `import` specifiers are
 * written for its RUNTIME home (`custom/slide-types/`, hence `../../shared/…`),
 * and two fixtures carry one on purpose: `payoff-slide.js` is what
 * `tests/custom-imports-resolvable.test.js` exercises, and `fork-title-slide.js`
 * composes on `shared/slide-types/core-layouts.js`. Importing from
 * `tests/fixtures/` would resolve those to `tests/shared/…` and throw. Copying
 * to `<root>/<tmp>/slide-types/` restores the depth, so every fixture loads
 * exactly as it does in the fork lane.
 */

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TESTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(TESTS_DIR, '..');

/** Where the fixtures are tracked. */
export const FORK_FIXTURE_DIR = join(TESTS_DIR, 'fixtures', 'fork-slide-types');

/**
 * @returns {Promise<Array<{file: string, name: string, def: any}>>}
 */
export async function loadForkFixtures() {
  const files = readdirSync(FORK_FIXTURE_DIR).filter((f) => f.endsWith('.js'));
  const tmp = mkdtempSync(join(REPO_ROOT, '.fork-fixtures-'));
  try {
    const dir = join(tmp, 'slide-types');
    mkdirSync(dir);
    const loaded = [];
    for (const file of files) {
      copyFileSync(join(FORK_FIXTURE_DIR, file), join(dir, file));
      const mod = await import(pathToFileURL(join(dir, file)).href);
      loaded.push({ file, name: file.replace(/\.js$/, ''), def: mod.default });
    }
    return loaded;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
