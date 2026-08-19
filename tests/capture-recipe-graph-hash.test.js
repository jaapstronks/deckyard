/**
 * The recipe hash must move with the recipe's *module graph* inside the scope
 * directory, and stay still for everything outside it.
 *
 * Two failures this guards:
 *  - the #A6 gap: sixteen of the seventeen recipes are thin wrappers over a
 *    shared factory, so a hash over the entry module alone barely guards
 *    anything;
 *  - the regex trap: a naive `import\(...\)` match also fires on a JSDoc
 *    `import('...')` type annotation, which blew the measured graph up from 5
 *    to 227 modules.
 *
 * Every fixture tree lives in the OS temp dir and passes its own absolute
 * `scope`, so no test writes into the shared working tree.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  hashRecipeGraph,
  DEFAULT_RECIPE_SCOPE,
} from '../capture/lib/recipe.js';
import { RECIPES, recipeFsPath } from '../capture/recipes/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Build a throwaway module tree outside the working tree. The returned `dir`
 * doubles as the hash scope, so a fixture behaves exactly like `capture/`
 * without having to live there.
 * @returns {Promise<{
 *   dir: string,
 *   hash: (entryFsPath: string) => Promise<string>,
 *   cleanup: () => Promise<void>,
 * }>}
 */
async function sandbox(prefix = 'deckyard-graph-hash-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    dir,
    hash: (entryFsPath) => hashRecipeGraph(entryFsPath, { scope: dir }),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

test('a change in a shared factory moves the hash of every recipe built on it', async () => {
  const { dir, hash, cleanup } = await sandbox();
  try {
    const factory = path.join(dir, '_factory.js');
    const entryA = path.join(dir, 'a.js');
    const entryB = path.join(dir, 'b.js');
    await fs.writeFile(factory, "export const shape = 'one';\n");
    await fs.writeFile(
      entryA,
      "import { shape } from './_factory.js';\nexport default { shape };\n",
    );
    await fs.writeFile(
      entryB,
      "import { shape } from './_factory.js';\nexport default { shape, b: 1 };\n",
    );

    const beforeA = await hash(entryA);
    const beforeB = await hash(entryB);

    await fs.writeFile(factory, "export const shape = 'two';\n");

    assert.notEqual(await hash(entryA), beforeA);
    assert.notEqual(await hash(entryB), beforeB);
  } finally {
    await cleanup();
  }
});

test('a change two hops down the graph still moves the hash', async () => {
  const { dir, hash, cleanup } = await sandbox();
  try {
    const leaf = path.join(dir, 'leaf.js');
    const middle = path.join(dir, 'middle.js');
    const entry = path.join(dir, 'a.js');
    await fs.writeFile(leaf, "export const leafValue = 'one';\n");
    await fs.writeFile(
      middle,
      "import { leafValue } from './leaf.js';\nexport const midValue = leafValue;\n",
    );
    await fs.writeFile(
      entry,
      "import { midValue } from './middle.js';\nexport default { midValue };\n",
    );

    const before = await hash(entry);
    await fs.writeFile(leaf, "export const leafValue = 'two';\n");

    assert.notEqual(
      await hash(entry),
      before,
      'the walk is transitive, not one level deep',
    );
  } finally {
    await cleanup();
  }
});

test('a re-export is followed the same as an import', async () => {
  const { dir, hash, cleanup } = await sandbox();
  try {
    const source = path.join(dir, 'source.js');
    const entry = path.join(dir, 'a.js');
    await fs.writeFile(source, "export const value = 'one';\n");
    await fs.writeFile(entry, "export { value } from './source.js';\n");

    const before = await hash(entry);
    await fs.writeFile(source, "export const value = 'two';\n");

    assert.notEqual(
      await hash(entry),
      before,
      '`export … from` is a real dependency',
    );
  } finally {
    await cleanup();
  }
});

test('a circular import terminates and still covers both modules', async () => {
  const { dir, hash, cleanup } = await sandbox();
  try {
    const a = path.join(dir, 'a.js');
    const b = path.join(dir, 'b.js');
    await fs.writeFile(
      a,
      "import { fromB } from './b.js';\nexport const fromA = () => fromB;\n",
    );
    await fs.writeFile(
      b,
      "import { fromA } from './a.js';\nexport const fromB = () => fromA;\n",
    );

    const before = await hash(a);
    assert.match(
      before,
      /^[0-9a-f]{16}$/,
      'the cycle resolved instead of looping forever',
    );

    await fs.writeFile(
      b,
      "import { fromA } from './a.js';\nexport const fromB = () => [fromA];\n",
    );
    assert.notEqual(
      await hash(a),
      before,
      'the cycle partner is part of the graph',
    );
  } finally {
    await cleanup();
  }
});

test('a change outside the scope leaves the hash alone', async () => {
  const { dir, hash, cleanup } = await sandbox();
  const outside = await sandbox('deckyard-graph-hash-outside-');
  try {
    const store = path.join(outside.dir, 'store.js');
    await fs.writeFile(store, 'export const version = 1;\n');
    const entry = path.join(dir, 'a.js');
    const rel = path.relative(dir, store).split(path.sep).join('/');
    await fs.writeFile(
      entry,
      `import { version } from '${rel}';\nexport default { version };\n`,
    );

    const before = await hash(entry);
    await fs.writeFile(store, 'export const version = 2;\n');

    assert.equal(await hash(entry), before);
  } finally {
    await cleanup();
    await outside.cleanup();
  }
});

test('the walk stops at the boundary instead of hopping back into scope', async () => {
  const { dir, hash, cleanup } = await sandbox();
  const outside = await sandbox('deckyard-graph-hash-outside-');
  try {
    // entry (in scope) -> hop (out of scope) -> deep (in scope again). `deep`
    // is only reachable through the hop, so it must not be hashed: an
    // out-of-scope module is neither hashed nor walked.
    const deep = path.join(dir, 'deep.js');
    const hop = path.join(outside.dir, 'hop.js');
    const entry = path.join(dir, 'a.js');
    await fs.writeFile(deep, "export const depth = 'one';\n");
    const relDeep = path.relative(outside.dir, deep).split(path.sep).join('/');
    await fs.writeFile(hop, `export { depth } from '${relDeep}';\n`);
    const relHop = path.relative(dir, hop).split(path.sep).join('/');
    await fs.writeFile(
      entry,
      `import { depth } from '${relHop}';\nexport default { depth };\n`,
    );

    const before = await hash(entry);
    await fs.writeFile(deep, "export const depth = 'two';\n");

    assert.equal(
      await hash(entry),
      before,
      'a module reachable only through an out-of-scope hop stays out of the graph',
    );
  } finally {
    await cleanup();
    await outside.cleanup();
  }
});

test('a JSDoc import() annotation pulls nothing into the graph', async () => {
  const { dir, hash, cleanup } = await sandbox();
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
      ].join('\n'),
    );

    const before = await hash(entry);
    await fs.writeFile(annotated, "export const noise = 'y';\n");

    assert.equal(
      await hash(entry),
      before,
      'a type-only import() in a comment is not a runtime dependency',
    );
  } finally {
    await cleanup();
  }
});

test('a specifier Node ESM would refuse to load is not resolved', async () => {
  const { dir, hash, cleanup } = await sandbox();
  try {
    const helper = path.join(dir, 'helper.js');
    const nested = path.join(dir, 'nested');
    await fs.mkdir(nested);
    const nestedIndex = path.join(nested, 'index.js');
    const entry = path.join(dir, 'a.js');
    await fs.writeFile(helper, "export const a = 'one';\n");
    await fs.writeFile(nestedIndex, "export const b = 'one';\n");
    await fs.writeFile(
      entry,
      "import { a } from './helper';\nimport { b } from './nested/';\nexport default { a, b };\n",
    );

    const before = await hash(entry);
    await fs.writeFile(helper, "export const a = 'two';\n");
    await fs.writeFile(nestedIndex, "export const b = 'two';\n");

    assert.equal(
      await hash(entry),
      before,
      'extension guessing and directory index resolution are bundler rules, not Node ESM',
    );
  } finally {
    await cleanup();
  }
});

test('identical trees hash identically whatever order the files were written in', async () => {
  // A fixed directory, not mkdtemp: the hash covers each module's path as well
  // as its contents, so the two builds have to occupy the same paths for the
  // comparison to isolate write order.
  const dir = path.join(
    os.tmpdir(),
    `deckyard-graph-hash-order-${process.pid}`,
  );
  const factory = path.join(dir, '_factory.js');
  const entry = path.join(dir, 'a.js');
  const FACTORY_SRC = "export const shape = 'one';\n";
  const ENTRY_SRC =
    "import { shape } from './_factory.js';\nexport default { shape };\n";

  /** @param {Array<[string, string]>} writes */
  const build = async (writes) => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    for (const [file, src] of writes) await fs.writeFile(file, src);
    return hashRecipeGraph(entry, { scope: dir });
  };

  try {
    const entryFirst = await build([
      [entry, ENTRY_SRC],
      [factory, FACTORY_SRC],
    ]);
    const factoryFirst = await build([
      [factory, FACTORY_SRC],
      [entry, ENTRY_SRC],
    ]);

    assert.equal(
      factoryFirst,
      entryFirst,
      'the hash is over path + contents, never over filesystem metadata',
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('every registered recipe sits in the default scope and hashes to the registry format', async () => {
  const scopeDir = path.join(REPO_ROOT, DEFAULT_RECIPE_SCOPE);
  for (const recipe of RECIPES) {
    const fsPath = recipeFsPath(recipe.id);
    assert.ok(
      fsPath.startsWith(`${scopeDir}${path.sep}`),
      `${recipe.id} lives outside the hash scope, so its graph would be empty`,
    );
    const hash = await hashRecipeGraph(fsPath);
    assert.match(
      hash,
      /^[0-9a-f]{16}$/,
      `${recipe.id} produced a malformed hash`,
    );
  }
});
