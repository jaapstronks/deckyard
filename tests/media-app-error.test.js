/**
 * C7f — the media tree throws AppError, not bare Error + `.statusCode =`.
 *
 * Pins that the statuses are unchanged (the conversion is behavior-preserving:
 * all local validation stays 400, the ImageKit proxy keeps passing the
 * upstream status through), that raw upstream ImageKit payloads stay out of
 * the serialized envelope (they ride along as the `upstream` instance field,
 * the same pattern C7c used for Notion), and gates the bare-Error idiom out
 * of `server/media/`.
 *
 * Run with: node --test tests/media-app-error.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LocalProvider, parseDataUrl } from '../server/media/local.js';
import { listImageKitFiles } from '../server/media/imagekit.js';
import {
  AppError,
  ValidationError,
  isAppError,
} from '../server/utils/errors.js';

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

test('upstream ImageKit payloads never reach the serialized envelope', () => {
  // The shape the proxy throws for a failed upstream call: status passed
  // through, raw body as the `upstream` instance field, never `details`.
  const err = new AppError('ImageKit request failed (503)', 503);
  err.upstream = { help: 'raw imagekit payload' };
  const body = err.toJSON();
  assert.ok(!('upstream' in body) && !('details' in body));
  assert.ok(!JSON.stringify(body).includes('raw imagekit payload'));
});

test('no bare .statusCode assignment left under server/media/', () => {
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
  walk(path.join(repoRoot, 'server/media'));
  assert.deepEqual(
    offenders,
    [],
    `Media modules must throw AppError subclasses: ${offenders.join(', ')}`,
  );
});
