/** Print a fresh B665 inventory; the checked-in fixture is the original ceiling. */
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  storageScopeInventory,
  scopeFirstViolations,
} from '../tests/helpers/storage-scope-inventory.js';
import { STORAGE_SCOPE_EXCEPTIONS } from '../tests/helpers/storage-scope-exceptions.js';

const callerRoots = [
  'server',
  'client',
  'shared',
  'scripts',
  'tests',
  'capture',
];
const excludedDirectories = ['vendor', 'fixtures'];
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return excludedDirectories.includes(entry.name) ? [] : walk(file);
    }
    return file.endsWith('.js') ? [file] : [];
  });
}
const sources = new Map(
  callerRoots.flatMap(walk).map((file) => [file, readFileSync(file, 'utf8')]),
);
const storage = new Map(
  [...sources].filter(([file]) => file.startsWith('server/storage/')),
);
const inventory = storageScopeInventory(storage, sources);
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString().slice(0, 10),
      base: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      callerRoots,
      excludedDirectories,
      violations: scopeFirstViolations(inventory, STORAGE_SCOPE_EXCEPTIONS),
      exports: inventory.map(({ key, line, params, callers }) => ({
        key,
        line,
        params,
        exception: STORAGE_SCOPE_EXCEPTIONS.get(key) || null,
        callers,
      })),
    },
    null,
    2,
  ),
);
