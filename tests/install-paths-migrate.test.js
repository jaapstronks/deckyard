import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Both install paths must apply the schema before the app serves anything.
 *
 * PostgreSQL is the only storage backend, so an install that skips `db:migrate`
 * produces a server that starts and then answers every request with a 500. The
 * Docker path has always migrated in its entrypoint; the Node path did not, and
 * nothing said so — which is how `curl … | bash` on a machine with Node and no
 * Docker shipped a broken instance (B364).
 *
 * A shell path is expensive to drive end to end (a clone, a database, a
 * foreground server), so this guards the two properties that drifted: the
 * ordering of the steps, and the absence of a storage mode that no longer
 * exists. The refusals themselves are pinned in Node:
 * tests/database-connection-error.test.js and the schema guard in
 * tests/storage-boot-check.test.js.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const read = (rel) => fs.readFile(path.join(REPO_ROOT, rel), 'utf8');

test('the Node install path migrates before it starts the server', async () => {
  const sh = await read('scripts/install.sh');

  const migrate = sh.indexOf('npm run db:migrate');
  const start = sh.indexOf('exec npm run start');
  assert.notEqual(migrate, -1, 'install.sh must apply the schema');
  assert.notEqual(start, -1, 'install.sh must still start the server');
  assert.ok(
    migrate < start,
    'db:migrate must run before the server, not after it has failed',
  );

  // The one external requirement, said before `npm install` spends minutes.
  assert.match(sh, /PostgreSQL 14\+ database/);
});

test('the container entrypoint migrates unconditionally', async () => {
  const sh = await read('scripts/docker-entrypoint.sh');

  assert.match(sh, /migrate\.js" up/, 'the entrypoint must apply the schema');
  // The migration used to sit inside `if [ "$storage_mode" = "postgres" ]`,
  // a branch on a value that can only have one value.
  assert.doesNotMatch(
    sh,
    /storage_mode/,
    'no branch on a storage mode with one member',
  );
});

test('no install surface offers file storage as a live path', async () => {
  for (const rel of [
    'scripts/install.sh',
    'scripts/docker-entrypoint.sh',
    'Dockerfile',
    'README.md',
  ]) {
    const text = await read(rel);
    assert.doesNotMatch(
      text,
      /file storage|file-based storage|STORAGE_MODE=file\b/i,
      `${rel} still describes file storage as a path Deckyard supports`,
    );
  }
});
