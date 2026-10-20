/**
 * C7f — the media tree throws AppError, not bare Error + `.statusCode =`.
 *
 * Pins that local validation throws a 400 `ValidationError` and gates the
 * bare-Error idiom out of `server/media/`. How a failed ImageKit call
 * refuses is pinned in `imagekit-browse-upstream-error.test.js`.
 *
 * Run with: node --test tests/media-app-error.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkFiles } from './helpers/walk-files.js';

import { LocalProvider, parseDataUrl } from '../server/media/local.js';
import { listImageKitFiles } from '../server/media/imagekit.js';
import { ValidationError, isAppError } from '../server/utils/errors.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const isValidationError = (err) =>
  err instanceof ValidationError && err.statusCode === 400 && isAppError(err);

test('local media validation throws 400 ValidationError', async () => {
  assert.throws(() => parseDataUrl('not a data url'), isValidationError);

  const provider = new LocalProvider(repoRoot);
  await assert.rejects(
    () =>
      provider.uploadBuffer({
        buffer: Buffer.from('x'),
        filename: 'x.bin',
        contentType: 'application/zip',
      }),
    isValidationError,
  );
  await assert.rejects(
    () =>
      provider.uploadBuffer({
        buffer: Buffer.alloc(2),
        filename: 'x.png',
        contentType: 'image/png',
        maxBytes: 1,
      }),
    isValidationError,
  );
});

test('unconfigured ImageKit throws 400 ValidationError', async () => {
  delete process.env.IMAGEKIT_PRIVATE_KEY;
  await assert.rejects(() => listImageKitFiles({}), isValidationError);
});

test('no bare .statusCode assignment left under server/media/', () => {
  const offenders = [];
  for (const file of walkFiles(path.join(repoRoot, 'server/media'), {
    extensions: ['.js'],
    followSymlinks: true,
    filesOnly: false,
  })) {
    if (/\.statusCode = /.test(readFileSync(file, 'utf8'))) {
      offenders.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Media modules must throw AppError subclasses: ${offenders.join(', ')}`,
  );
});
