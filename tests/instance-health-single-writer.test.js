/**
 * Two single-writer rules the instance-health counters rest on (B514, D247).
 *
 *   1. `server/storage/instance-health.js` is the only module that touches the
 *      `instance_health` table. A second writer would be a second spelling of
 *      the vocabulary, and the view (B516) could no longer trust that every
 *      key it shows is one the reference doc names.
 *   2. Every new deck is written by the presentations facade's one insert,
 *      which is where `slide_type.authored` is counted. An `insertInto(
 *      'presentations')` anywhere else would be a deck whose types nobody
 *      counted — the facade would stop being the seam the axis claims.
 *
 * Source-level on purpose: a behavioural test cannot see a write path no test
 * exercises. Each rule ships a self-test so a scanner change that blinds it
 * fails loudly.
 *
 * Run with: node --test tests/instance-health-single-writer.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkJsFiles } from './helpers/call-sites.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Everything that ships: the server, the scripts that write the database. */
const SCANNED = ['server', 'scripts'].map((dir) => path.join(repoRoot, dir));

const TABLE_WRITERS = new Set([
  'server/storage/instance-health.js',
  'server/db/migrations/089_instance_health.js',
]);
const DECK_INSERTERS = new Set(['server/storage/presentations/index.js']);

const MENTIONS_TABLE = /['"`]instance_health['"`]/;
const INSERTS_DECK = /insertInto\(\s*['"`]presentations['"`]\s*\)/;

/**
 * Repo-relative paths of the scanned files whose source matches.
 * @param {RegExp} pattern
 * @returns {string[]}
 */
function filesMatching(pattern) {
  return SCANNED.flatMap((dir) => walkJsFiles(dir))
    .filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
    .sort();
}

test('only the facade and its migration name the instance_health table', () => {
  assert.deepEqual(filesMatching(MENTIONS_TABLE), [...TABLE_WRITERS].sort());
});

test('only the presentations facade inserts a deck', () => {
  assert.deepEqual(filesMatching(INSERTS_DECK), [...DECK_INSERTERS]);
});

test('the scanners see the shapes they guard', () => {
  assert.ok(MENTIONS_TABLE.test("db.insertInto('instance_health')"));
  assert.ok(MENTIONS_TABLE.test('db.selectFrom("instance_health")'));
  assert.ok(INSERTS_DECK.test("db\n    .insertInto('presentations')"));
  assert.ok(INSERTS_DECK.test('insertInto( "presentations" )'));
  assert.ok(!INSERTS_DECK.test("insertInto('presentation_versions')"));
});
