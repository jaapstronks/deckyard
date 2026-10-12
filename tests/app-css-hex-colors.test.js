/**
 * App CSS hex colours left after B678. Existing values have a per-file budget;
 * each file's budget can only decrease as the colours move to role tokens.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'client/styles/app');
const budgets = JSON.parse(
  await fs.readFile(path.join(root, 'app-css-hex-budgets.json'), 'utf8'),
);

async function cssFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await cssFiles(full)));
    else if (entry.name.endsWith('.css')) files.push(full);
  }
  return files;
}

describe('app CSS hex colour budget (B678)', () => {
  it('does not add literal hex colours or increase an existing file budget', async () => {
    const actual = {};
    for (const file of await cssFiles(appDir)) {
      const css = (await fs.readFile(file, 'utf8')).replace(
        /\/\*[\s\S]*?\*\//g,
        '',
      );
      const count = [...css.matchAll(/#[\da-fA-F]{3,8}\b/g)].length;
      if (count)
        actual[path.relative(root, file).split(path.sep).join('/')] = count;
    }
    const excess = Object.entries(actual).filter(
      ([file, count]) => count > (budgets[file] ?? 0),
    );
    const stale = Object.entries(budgets).filter(
      ([file, count]) => (actual[file] ?? 0) < count,
    );
    assert.deepEqual(excess, [], 'New hex colour: use a role token');
    assert.deepEqual(stale, [], 'Lower the budget when a literal is removed');
  });
});
