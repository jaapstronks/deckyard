/**
 * C7f — uploads, postgres tags and collab auth throw AppError, not bare
 * Error + `.statusCode =`.
 *
 * Pins that the statuses are unchanged (the conversion is
 * behavior-preserving: 400 for caller mistakes, 404 for missing targets,
 * 401/403 for collab authorization) and gates the bare-Error idiom out of
 * `server/storage/` and `server/collab/`.
 *
 * Run with: node --test tests/storage-collab-app-error.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  writeUploadedFile,
  replaceUploadFromDataUrl,
} from '../server/storage/uploads.js';
import { authorizeDocument } from '../server/collab/auth.js';
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  isAppError,
} from '../server/utils/errors.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const isValidationError = (err) =>
  err instanceof ValidationError && err.statusCode === 400 && isAppError(err);

test('upload validation throws 400 ValidationError', async () => {
  await assert.rejects(
    () =>
      writeUploadedFile(repoRoot, Buffer.from('x'), 'x.zip', 'application/zip'),
    isValidationError,
  );
  await assert.rejects(
    () =>
      replaceUploadFromDataUrl(
        repoRoot,
        '/etc/passwd',
        'data:image/png;base64,AAAA',
      ),
    isValidationError,
  );
  await assert.rejects(
    () =>
      replaceUploadFromDataUrl(
        repoRoot,
        '/uploads/x.zip',
        'data:image/png;base64,AAAA',
      ),
    isValidationError,
  );
});

test('replacing a nonexistent upload throws 404 NotFoundError', async () => {
  const scratchRoot = mkdtempSync(path.join(tmpdir(), 'deckyard-uploads-'));
  await assert.rejects(
    () =>
      replaceUploadFromDataUrl(
        scratchRoot,
        '/uploads/nope.png',
        'data:image/png;base64,AAAA',
      ),
    (err) => err instanceof NotFoundError && err.statusCode === 404,
  );
});

test('collab authorization failures keep their statuses', async () => {
  await assert.rejects(
    () =>
      authorizeDocument({
        repoRoot,
        documentName: 'not-a-collab-doc',
        user: { email: 'a@b.c' },
      }),
    (err) => err instanceof NotFoundError && err.statusCode === 404,
  );
  await assert.rejects(
    () =>
      authorizeDocument({
        repoRoot,
        documentName: 'presentation:some-id',
        user: {},
      }),
    (err) => err instanceof UnauthorizedError && err.statusCode === 401,
  );
});

test('no bare .statusCode assignment left under storage/ and collab/', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (
        entry.endsWith('.js') &&
        /\.statusCode = /.test(readFileSync(full, 'utf8'))
      ) {
        offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(path.join(repoRoot, 'server/storage'));
  walk(path.join(repoRoot, 'server/collab'));
  assert.deepEqual(
    offenders,
    [],
    `These modules must throw AppError subclasses: ${offenders.join(', ')}`,
  );
});
