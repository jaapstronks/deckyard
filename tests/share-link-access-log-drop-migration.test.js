/**
 * Migration 094 drops the share-link verification log (B784).
 *
 * The fake-db double has no schema builder, so this file hands the migration a
 * recorder that captures every schema call it makes. It pins the statements:
 * `up` drops the index and the table, both guarded with `IF EXISTS`; `down`
 * recreates the empty table and index in the 004 shape, guarded with
 * `IF NOT EXISTS`. That PostgreSQL accepts them, that rows go with the table
 * and that the restored foreign key cascades is
 * `tests/pg/share-link-access-log-drop.pgtest.js`.
 *
 * Run with: node --test tests/share-link-access-log-drop-migration.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  up,
  down,
} from '../server/db/migrations/094_drop_share_link_access_log.js';

/**
 * A `db.schema` stand-in that turns every builder chain into one recorded
 * statement: `[verb, name, ...modifiers]`.
 * @returns {{ db: { schema: Object }, statements: Array<string[]> }}
 */
function recordingDb() {
  const statements = [];
  const chain = (statement) => {
    const builder = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'execute') {
            return async () => {
              statements.push(statement);
            };
          }
          return (...args) => {
            const arg = typeof args[0] === 'string' ? args[0] : null;
            statement.push(arg ? `${String(prop)}:${arg}` : String(prop));
            return builder;
          };
        },
      },
    );
    return builder;
  };
  const schema = new Proxy(
    {},
    { get: (_target, verb) => (name) => chain([String(verb), name]) },
  );
  return { db: { schema }, statements };
}

test('up drops the index and the table, each only if it exists', async () => {
  const { db, statements } = recordingDb();
  await up(db);
  assert.deepEqual(statements, [
    ['dropIndex', 'idx_access_log_link', 'ifExists'],
    ['dropTable', 'share_link_access_log', 'ifExists'],
  ]);
});

test('down recreates the empty 004 table and its index, each only if missing', async () => {
  const { db, statements } = recordingDb();
  await down(db);
  assert.deepEqual(statements, [
    [
      'createTable',
      'share_link_access_log',
      'ifNotExists',
      'addColumn:id',
      'addColumn:share_link_id',
      'addColumn:accessed_at',
      'addColumn:ip_address',
      'addColumn:user_agent',
    ],
    [
      'createIndex',
      'idx_access_log_link',
      'ifNotExists',
      'on:share_link_access_log',
      'column:share_link_id',
    ],
  ]);
});
