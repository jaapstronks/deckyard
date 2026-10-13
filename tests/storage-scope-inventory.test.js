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
