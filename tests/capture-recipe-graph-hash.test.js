/**
 * The recipe hash must move with the recipe's *module graph* inside `capture/`,
 * and stay still for everything outside it.
 *
 * Two failures this guards:
 *  - the #A6 gap: sixteen of the seventeen recipes are thin wrappers over a
 *    shared factory, so a hash over the entry module alone barely guards
 *    anything;
 *  - the regex trap: a naive `import\(...\)` match also fires on a JSDoc
 *    `import('...')` type annotation, which blew the measured graph up from 5
 *    to 227 modules.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hashRecipeGraph, DEFAULT_RECIPE_SCOPE } from '../capture/lib/recipe.js';
import { RECIPES, recipeFsPath } from '../capture/recipes/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Build a throwaway module tree under `capture/` so a test can edit files
 * without touching real recipes. Returns the sandbox dir plus a cleanup.
 * The tree has to live inside `capture/` because that is the hash's scope.
 * @returns {Promise<{ dir: string, cleanup: () => Promise<void> }>}
 */
async function sandbox() {
  const dir = await fs.mkdtemp(path.join(REPO_ROOT, 'capture', '.tmp-graph-hash-'));
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('a change in a shared factory moves the hash of every recipe built on it', async () => {
  const { dir, cleanup } = await sandbox();
  try {
    const factory = path.join(dir, '_factory.js');
    const entryA = path.join(dir, 'a.js');
    const entryB = path.join(dir, 'b.js');
    await fs.writeFile(factory, "export const shape = 'one';\n");
    await fs.writeFile(entryA, "import { shape } from './_factory.js';\nexport default { shape };\n");
    await fs.writeFile(entryB, "import { shape } from './_factory.js';\nexport default { shape, b: 1 };\n");

    const beforeA = await hashRecipeGraph(entryA);
    const beforeB = await hashRecipeGraph(entryB);

    await fs.writeFile(factory, "export const shape = 'two';\n");

    assert.notEqual(await hashRecipeGraph(entryA), beforeA);
    assert.notEqual(await hashRecipeGraph(entryB), beforeB);
  } finally {
    await cleanup();
  }
});

test('a change outside the scope leaves the hash alone', async () => {
  const { dir, cleanup } = await sandbox();
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-graph-hash-'));
  try {
    const outside = path.join(outsideDir, 'store.js');
    await fs.writeFile(outside, "export const version = 1;\n");
    const entry = path.join(dir, 'a.js');
    const rel = path.relative(dir, outside).split(path.sep).join('/');
    await fs.writeFile(entry, `import { version } from '${rel}';\nexport default { version };\n`);

    const before = await hashRecipeGraph(entry);
    await fs.writeFile(outside, "export const version = 2;\n");

    assert.equal(await hashRecipeGraph(entry), before);
  } finally {
    await cleanup();
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test('a JSDoc import() annotation pulls nothing into the graph', async () => {
  const { dir, cleanup } = await sandbox();
  try {
    const annotated = path.join(dir, 'annotated.js');
    const entry = path.join(dir, 'a.js');
    await fs.writeFile(annotated, "export const noise = 'x';\n");
    await fs.writeFile(
      entry,
      [
        '/**',
        " * @param {import('./annotated.js').Whatever} value",
        ' * @returns {number}',
        ' */',
        'export default function useIt(value) {',
        '  return String(value).length;',
        '}',
        '',
      ].join('\n')
    );

    const before = await hashRecipeGraph(entry);
    await fs.writeFile(annotated, "export const noise = 'y';\n");

    assert.equal(
      await hashRecipeGraph(entry),
      before,
      'a type-only import() in a comment is not a runtime dependency'
    );
  } finally {
    await cleanup();
  }
});

test('the hash is stable across traversal order and keeps the registry format', async () => {
  const hash = await hashRecipeGraph(recipeFsPath(RECIPES[0].id));
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.equal(await hashRecipeGraph(recipeFsPath(RECIPES[0].id)), hash);
  assert.equal(
    await hashRecipeGraph(recipeFsPath(RECIPES[0].id), { scope: DEFAULT_RECIPE_SCOPE }),
    hash,
    'the default scope is the documented one'
  );
});

test('every registered recipe hashes without reaching outside capture/', async () => {
  for (const recipe of RECIPES) {
    const hash = await hashRecipeGraph(recipeFsPath(recipe.id));
    assert.match(hash, /^[0-9a-f]{16}$/, `${recipe.id} produced a malformed hash`);
  }
});
