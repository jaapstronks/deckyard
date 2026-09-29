/**
 * A checkout root that holds core and nothing of the fork.
 *
 * A fork runs core's suite with its own `custom/` in place, so a core test
 * that passes `repoRoot` to a loader reading `custom/` measures the fork, not
 * core (`docs/reference/fork-setup.md` § _After the merge, run the suite_).
 * This root symlinks the core directories a render or export path reads and
 * leaves `custom/` absent; a test that wants fork files writes them into it.
 */
import { mkdtempSync, symlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const CORE_DIRS = ['client', 'assets', 'shared', 'themes'];

/**
 * Create a temporary core-only root.
 * @param {string} [prefix] - Temp directory name prefix
 * @returns {{ root: string, remove: () => Promise<void> }}
 */
export function createCoreFixtureRoot(prefix = 'deckyard-core-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  for (const dir of CORE_DIRS) {
    symlinkSync(path.join(repoRoot, dir), path.join(root, dir), 'dir');
  }
  return {
    root,
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
