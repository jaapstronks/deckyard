/**
 * Core fixtures must not depend on the checkout's fork drop-ins. The custom
 * import audit intentionally validates those drop-ins and is the sole direct
 * REPO_ROOT/custom reader.
 * Run with: node --test tests/core-fixture-root-gate.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { walkJsFiles } from './helpers/call-sites.js';

function readsForkRoot(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const temporaryRoots = new Set();
  function collect(node) {
    if (!node || typeof node !== 'object') return;
    const value =
      node.type === 'VariableDeclarator'
        ? node.init
        : node.type === 'AssignmentExpression'
          ? node.right
          : null;
    const name =
      node.type === 'VariableDeclarator' ? node.id?.name : node.left?.name;
    if (
      name &&
      /^(?:mkdtempSync|mkdtemp)$/.test(
        value?.callee?.property?.name ?? value?.callee?.name ?? '',
      )
    )
      temporaryRoots.add(name);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') collect(value);
    }
  }
  collect(ast);
  let found = false;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const name = node.callee?.name ?? node.callee?.property?.name;
    if (
      node.type === 'CallExpression' &&
      ['join', 'resolve'].includes(name) &&
      !temporaryRoots.has(node.arguments[0]?.name) &&
      /^(?:REPO_ROOT|repoRoot|ROOT)$/.test(node.arguments[0]?.name ?? '') &&
      /^custom(?:\/|$)/.test(node.arguments[1]?.value ?? '')
    )
      found = true;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  return found;
}

test('root detector catches path construction, ignoring comments and temporary roots', () => {
  for (const source of [
    "path.join(REPO_ROOT, 'custom')",
    "join(repoRoot, 'custom/themes')",
    "resolve(ROOT, 'custom', 'themes')",
  ])
    assert.equal(readsForkRoot(source), true);
  for (const source of [
    "join(tmp, 'custom')",
    "const REPO_ROOT = fs.mkdtempSync('/tmp/fixture-'); join(REPO_ROOT, 'custom')",
    "let repoRoot; repoRoot = fs.mkdtempSync('/tmp/fixture-'); join(repoRoot, 'custom')",
    "join(REPO_ROOT, 'themes')",
    "// join(REPO_ROOT, 'custom')",
    'readCoreThemeSeeds()',
  ])
    assert.equal(readsForkRoot(source), false);
});

test('only the fork import audit constructs the checkout custom root', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const hits = walkJsFiles(path.join(root, 'tests'))
    .filter((file) => readsForkRoot(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file));
  assert.deepEqual(hits, ['tests/custom-imports-resolvable.test.js']);
});
