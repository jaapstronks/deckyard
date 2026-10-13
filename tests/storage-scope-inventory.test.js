import test from 'node:test';
import assert from 'node:assert/strict';
import {
  storageScopeInventory,
  scopeFirstViolations,
  addedBurndownEntries,
} from './helpers/storage-scope-inventory.js';

const sources = new Map([
  [
    'server/storage/rows.js',
    `
    import { getDb as database } from '../db/client.js';
    function privateRead() { return database().selectFrom('rows'); }
    const read = () => privateRead();
    export { read as listRows };
    export const directAlias = read;
    export function pure(row) { return row.id; }
    export function scoped(scope) { return privateRead(); }
    export function renamed(storageScope) { return privateRead(); }
    export const empty = async () => privateRead();
    export function destructured({ organizationId }) { return privateRead(); }
  `,
  ],
  ['server/storage/index.js', `export { listRows as rows } from './rows.js';`],
  ['server/storage/barrel.js', `export * from './index.js';`],
  [
    'server/storage/caller.js',
    `
    import { rows as renamed } from './barrel.js';
    import * as storage from './index.js';
    export function delegated() { return renamed(); }
    export const namespaced = () => storage.rows();
  `,
  ],
]);

test('positive gate catches new DB exports through private helpers, aliases and barrels', () => {
  const inventory = storageScopeInventory(sources);
  assert.deepEqual(inventory.map((fn) => fn.name).sort(), [
    'delegated',
    'destructured',
    'empty',
    'namespaced',
    'read',
    'renamed',
    'scoped',
  ]);
  const violations = scopeFirstViolations(inventory, new Map());
  assert.equal(violations.length, 6);
  assert.ok(
    violations.includes('server/storage/rows.js :: empty :: scope-first'),
  );
  assert.ok(
    violations.includes('server/storage/rows.js :: renamed :: scope-first'),
  );
  assert.ok(!violations.some((line) => line.includes(' :: scoped ::')));
  assert.equal(addedBurndownEntries(violations, []).length, 6);
});

test('only explicitly registered exports are exempt, not their module or callers', () => {
  const inventory = storageScopeInventory(sources);
  const exceptions = new Map([
    ['server/storage/rows.js :: read', 'token: presented capability'],
  ]);
  const violations = scopeFirstViolations(inventory, exceptions);
  assert.equal(violations.length, 5);
  assert.ok(
    violations.includes('server/storage/caller.js :: delegated :: scope-first'),
  );
});

test('the burndown cannot grow or exchange a fixed identity for a new violation', () => {
  assert.deepEqual(addedBurndownEntries(['old'], ['old']), []);
  assert.deepEqual(addedBurndownEntries([], ['old']), []);
  assert.deepEqual(addedBurndownEntries(['old', 'new'], ['old']), ['new']);
  assert.deepEqual(addedBurndownEntries(['new'], ['old']), ['new']);
});

test('caller inventory includes inline handlers and aliases through barrels', () => {
  const callers = new Map([
    ...sources,
    [
      'server/routes/rows.js',
      `
    import { rows as list } from '../storage/barrel.js';
    router.get('/rows', () => list());
  `,
    ],
  ]);
  const inventory = storageScopeInventory(sources, callers);
  const read = inventory.find((fn) => fn.name === 'read');
  assert.deepEqual(read.callers, [
    'server/routes/rows.js:3',
    'server/storage/caller.js:4',
    'server/storage/caller.js:5',
  ]);
});

test('query handles, nested callbacks and dynamic DB imports are DB-reaching', () => {
  const inventory = storageScopeInventory(
    new Map([
      [
        'server/storage/extra.js',
        `
    export function query(db) { return db.selectFrom('rows'); }
    export function callback() { return wrap(() => db.deleteFrom('rows')); }
    export async function lazy() { const {getDb} = await import('../db/client.js'); return getDb(); }
    export function commentOnly() { /* db.selectFrom('rows') */ return 'db.selectFrom'; }
  `,
      ],
    ]),
  );
  assert.deepEqual(inventory.map((fn) => fn.name).sort(), [
    'callback',
    'lazy',
    'query',
  ]);
});

test('literal lazy storage imports remain gated and their then-callback calls are inventoried', () => {
  const lazySources = new Map([
    ...sources,
    [
      'server/storage/cache.js',
      `
    export function cached(storageScope) {
      return import('./index.js').then(mod => mod.rows(storageScope));
    }
  `,
    ],
  ]);
  const inventory = storageScopeInventory(lazySources);
  assert.ok(
    scopeFirstViolations(inventory, new Map()).includes(
      'server/storage/cache.js :: cached :: scope-first',
    ),
  );
  assert.ok(
    inventory
      .find((fn) => fn.name === 'read')
      .callers.includes('server/storage/cache.js:3'),
  );
});

test('default function exports and default-import delegation cannot bypass the gate', () => {
  for (const declaration of [
    'export default function read() { return getDb(); }',
    'export default function () { return getDb(); }',
    'export default () => getDb();',
    'function read() { return getDb(); } export default read;',
  ]) {
    const inventory = storageScopeInventory(
      new Map([
        [
          'server/storage/default.js',
          `import { getDb } from '../db/client.js'; ${declaration}`,
        ],
        [
          'server/storage/consumer.js',
          `import read from './default.js'; export function caller() { return read(); }`,
        ],
      ]),
    );
    assert.equal(inventory.length, 2);
    assert.equal(scopeFirstViolations(inventory, new Map()).length, 2);
  }
});

test('lazy imports follow named and star export chains with cycles without duplicating definitions', () => {
  const lazySources = new Map([
    ...sources,
    [
      'server/storage/chain.js',
      `export * from './cycle.js'; export * from './barrel.js';`,
    ],
    ['server/storage/cycle.js', `export * from './chain.js';`],
    [
      'server/storage/cache.js',
      `
      export function named() { return import('./index.js').then(mod => mod.rows()); }
      export function starred() { return import('./barrel.js').then(mod => mod.rows()); }
      export function cyclic() { return import('./cycle.js').then(mod => mod.rows()); }
      export async function awaited() { const {rows} = await import('./cycle.js'); return rows(); }
    `,
    ],
  ]);
  const inventory = storageScopeInventory(lazySources);
  const violations = scopeFirstViolations(inventory, new Map());
  for (const name of ['named', 'starred', 'cyclic', 'awaited'])
    assert.ok(
      violations.includes(`server/storage/cache.js :: ${name} :: scope-first`),
    );
  const reads = inventory.filter((fn) => fn.name === 'read');
  assert.equal(reads.length, 1);
  assert.deepEqual(
    reads[0].callers.filter((site) =>
      site.startsWith('server/storage/cache.js:'),
    ),
    [
      'server/storage/cache.js:2',
      'server/storage/cache.js:3',
      'server/storage/cache.js:4',
    ],
  );
});

test('lazy barrels retain database entrypoints through named exports and cyclic star chains', () => {
  const inventory = storageScopeInventory(
    new Map([
      [
        'server/storage/named-db.js',
        `export {getDb as database} from '../db/client.js';`,
      ],
      [
        'server/storage/star-db.js',
        `export * from './db-cycle.js'; export * from '../db/client.js';`,
      ],
      ['server/storage/db-cycle.js', `export * from './star-db.js';`],
      [
        'server/storage/cache.js',
        `
      export function named() { return import('./named-db.js').then(mod => mod.database()); }
      export function starred() { return import('./db-cycle.js').then(mod => mod.getDb()); }
    `,
      ],
    ]),
  );
  assert.deepEqual(
    inventory.map((fn) => fn.name),
    ['named', 'starred'],
  );
  assert.equal(scopeFirstViolations(inventory, new Map()).length, 2);
});

test('star surfaces omit default exports and terminate pure cycles', () => {
  const inventory = storageScopeInventory(
    new Map([
      [
        'server/storage/default.js',
        `import {getDb} from '../db/client.js'; export default () => getDb();`,
      ],
      [
        'server/storage/barrel.js',
        `export * from './default.js'; export * from './cycle.js';`,
      ],
      ['server/storage/cycle.js', `export * from './barrel.js';`],
      [
        'server/storage/cache.js',
        `export function pure() { return import('./barrel.js'); }`,
      ],
    ]),
  );
  assert.deepEqual(
    inventory.map((fn) => fn.name),
    ['default'],
  );
});

test('parameter initializers reach DB operations directly and through private delegation', () => {
  const inventory = storageScopeInventory(
    new Map([
      [
        'server/storage/defaults.js',
        `
      import {getDb} from '../db/client.js';
      function privateRead() { return getDb(); }
      export function direct(result = getDb()) { return result; }
      export function delegated(result = privateRead()) { return result; }
      export function destructured({result = privateRead()} = {}) { return result; }
      export const nested = ([{result = getDb()}] = []) => result;
      export function query(result = db.selectFrom('rows')) { return result; }
      export function computed({[privateRead()]: result} = {}) { return result; }
      export function bindingOnly({getDb}) { return true; }
      export function injected({load = privateRead} = {}) { return load(); }
      export function scoped(scope, result = privateRead()) { return result; }
      export function pure({result = 'getDb()'} = {}) { return result; }
    `,
      ],
    ]),
  );
  assert.deepEqual(
    inventory.map((fn) => fn.name),
    [
      'computed',
      'delegated',
      'destructured',
      'direct',
      'injected',
      'nested',
      'query',
      'scoped',
    ],
  );
  assert.equal(scopeFirstViolations(inventory, new Map()).length, 7);
  assert.deepEqual(inventory.find((fn) => fn.name === 'destructured').params, [
    null,
  ]);
  assert.deepEqual(inventory.find((fn) => fn.name === 'direct').params, [
    'result',
  ]);
  assert.deepEqual(inventory.find((fn) => fn.name === 'scoped').params, [
    'scope',
    'result',
  ]);
});
