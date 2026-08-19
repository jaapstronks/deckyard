/**
 * Unit tests for the advisory dead-exports scanner (scripts/lint-dead-exports.js).
 *
 * This scanner replaced `import-x/no-unused-modules`, which ESLint 10 turned
 * into a silent no-op (B47). The behaviours worth pinning are the ones that make
 * it trustworthy: a never-imported export IS reported, and every kind of real
 * usage (named / default / namespace / re-export / dynamic / JSDoc, and the
 * name-collision case where the same name lives in two files) keeps its export
 * alive. The scan is exercised with an injected reader — no real files or git.
 *
 * Run with: node --test tests/lint-dead-exports.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { extractExports, harvestUsage, resolveSpecifier, scan } =
  await import('../scripts/lint-dead-exports.js');

/** Names of the candidates the scan reports, for a given virtual file tree. */
const deadNames = (files) => {
  const { candidates } = scan({
    files: Object.keys(files),
    read: (f) => files[f],
  });
  return candidates.map((c) => `${c.file}:${c.name}`).sort();
};

describe('extractExports', () => {
  it('reads declaration exports with line numbers', () => {
    const src = [
      'export function a() {}',
      '',
      'export const b = 1;',
      'export class C {}',
    ].join('\n');
    const byName = Object.fromEntries(
      extractExports(src).map((e) => [e.name, e.line]),
    );
    assert.equal(byName.a, 1);
    assert.equal(byName.b, 3);
    assert.equal(byName.C, 4);
  });

  it('names a default export "default", not its identifier', () => {
    const names = extractExports('export default function foo() {}').map(
      (e) => e.name,
    );
    assert.deepEqual(names, ['default']);
  });

  it('reads local and re-export blocks by their exported (right-hand) name', () => {
    const src = [
      'export { internal as pub };',
      "export { x as y } from './other.js';",
    ].join('\n');
    const names = extractExports(src)
      .map((e) => e.name)
      .sort();
    assert.deepEqual(names, ['pub', 'y']);
  });
});

describe('harvestUsage', () => {
  it('records named, default and namespace imports', () => {
    const edges = harvestUsage(
      [
        "import def, { a, b as c } from './m.js';",
        "import * as ns from './n.js';",
      ].join('\n'),
    );
    const bySpec = Object.fromEntries(
      edges.map((e) => [e.spec, [...e.names].sort()]),
    );
    assert.deepEqual(bySpec['./m.js'], ['a', 'b', 'default']);
    assert.deepEqual(bySpec['./n.js'], ['*']);
  });

  it('treats dynamic import() and JSDoc type import() as whole-module usage', () => {
    const edges = harvestUsage(
      [
        "const m = await import('./lazy.js');",
        "/** @type {import('./types.js').T} */",
      ].join('\n'),
    );
    const bySpec = Object.fromEntries(edges.map((e) => [e.spec, [...e.names]]));
    assert.deepEqual(bySpec['./lazy.js'], ['*']);
    assert.deepEqual(bySpec['./types.js'], ['*']);
  });

  it('reads a multi-line import brace block', () => {
    const edges = harvestUsage("import {\n  a,\n  b,\n} from './m.js';");
    assert.deepEqual([...edges[0].names].sort(), ['a', 'b']);
  });
});

describe('resolveSpecifier', () => {
  const tracked = new Set(['client/lib/x.js', 'client/lib/dir/index.js']);
  it('resolves a relative specifier with a .js fallback', () => {
    assert.equal(
      resolveSpecifier('./x.js', 'client/lib/app.js', tracked),
      'client/lib/x.js',
    );
    assert.equal(
      resolveSpecifier('./x', 'client/lib/app.js', tracked),
      'client/lib/x.js',
    );
  });
  it('resolves a directory to its index.js', () => {
    assert.equal(
      resolveSpecifier('./dir', 'client/lib/app.js', tracked),
      'client/lib/dir/index.js',
    );
  });
  it('returns null for a bare (npm) specifier', () => {
    assert.equal(
      resolveSpecifier('node:fs', 'client/lib/app.js', tracked),
      null,
    );
  });
});

describe('scan (end to end, injected reader)', () => {
  it('reports a never-imported export and nothing that is imported', () => {
    const files = {
      'client/app.js': "import { used } from './lib.js';\nused();",
      'client/lib.js': 'export function used() {}\nexport function orphan() {}',
    };
    assert.deepEqual(deadNames(files), ['client/lib.js:orphan']);
  });

  it('distinguishes a name collision by file (only the un-imported copy dies)', () => {
    const files = {
      // Consumers import withBackoff from net.js only; the poll.js copy is dead.
      'client/net.js': 'export function withBackoff() {}',
      'client/poll.js': 'export function withBackoff() {}',
      'client/app.js':
        "import { withBackoff } from './net.js';\nwithBackoff();",
    };
    assert.deepEqual(deadNames(files), ['client/poll.js:withBackoff']);
  });

  it('a namespace import keeps every export of the target alive', () => {
    const files = {
      'client/util.js': 'export const a = 1;\nexport const b = 2;',
      'client/app.js': "import * as u from './util.js';\nu.a;",
    };
    assert.deepEqual(deadNames(files), []);
  });

  it('counts a re-export as a real consumer of the underlying name', () => {
    const files = {
      'client/impl.js': 'export function deep() {}',
      'client/barrel.js': "export { deep } from './impl.js';",
      'client/app.js': "import { deep } from './barrel.js';\ndeep();",
    };
    assert.deepEqual(deadNames(files), []);
  });

  it('counts importers outside the four scanned trees (a test-only export lives)', () => {
    const files = {
      'client/lib.js': 'export function onlyForTests() {}',
      'tests/x.test.js':
        "import { onlyForTests } from '../client/lib.js';\nonlyForTests();",
    };
    // tests/ is a usage source but not a scanned tree, so it reports nothing.
    assert.deepEqual(deadNames(files), []);
  });
});
