/**
 * Local HTTP doubles and file walkers may only disappear from this inventory.
 * The inventory covers named declarations and function-valued variables,
 * including async functions. Walker detection requires a walk* name and a
 * readdir call in its body; anonymous traversal loops are outside this gate.
 * Run with: node --test tests/test-helper-burndown.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'acorn';
import { walkFiles } from './helpers/walk-files.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = JSON.parse(
  readFileSync(
    new URL('./fixtures/test-helper-debt.json', import.meta.url),
    'utf8',
  ),
);

function definitions(source) {
  const found = { http: 0, walkers: 0 };
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const fn =
      node.type === 'FunctionDeclaration'
        ? node
        : node.type === 'VariableDeclarator' &&
            ['ArrowFunctionExpression', 'FunctionExpression'].includes(
              node.init?.type,
            )
          ? node.init
          : null;
    if (fn) {
      const name = node.id?.name;
      if (/^(?:makeRes|mockRes|fakeRes)$/.test(name)) found.http++;
      if (
        /^walk(?:[A-Z]\w*)?$/.test(name) &&
        /\breaddir(?:Sync)?\s*\(/.test(source.slice(fn.start, fn.end))
      )
        found.walkers++;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  return found;
}

test('the inventory recognizes functions, async functions and arrow doubles', () => {
  assert.deepEqual(
    definitions(
      'function mockRes() {}\nconst makeRes = () => ({});\nasync function walkJs() { await fs.readdir(dir); }',
    ),
    { http: 2, walkers: 1 },
  );
  assert.deepEqual(
    definitions(
      '// function mockRes() {}\nconst text = "function fakeRes() {}";',
    ),
    { http: 0, walkers: 0 },
  );
});

test('local HTTP doubles and walkers match the shrinking per-file inventory', () => {
  const actual = {};
  for (const file of walkFiles(path.join(root, 'tests'), {
    extensions: ['.js'],
    skipDirs: ['fixtures', 'helpers'],
  })) {
    const counts = definitions(readFileSync(file, 'utf8'));
    if (counts.http || counts.walkers)
      actual[path.relative(root, file).split(path.sep).join('/')] = counts;
  }
  assert.deepEqual(
    actual,
    baseline,
    'Use the shared helpers for new tests; remove inventory entries when migrating existing copies.',
  );
});
