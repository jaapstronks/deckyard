/**
 * C7c — notion/data-source/features throw AppError, not bare Error + `.statusCode =`.
 *
 * Pins per converted tree that the statuses are unchanged (the conversion is
 * behavior-preserving), that upstream Notion payloads stay out of the
 * serialized envelope, and gates the bare-Error idiom out of the three trees.
 *
 * Run with: node --test tests/notion-datasource-app-error.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { notionFetchJson } from '../server/utils/notion/client.js';
import { appendBlocksToPage } from '../server/utils/notion/blocks.js';
import { fetchNotionPage } from '../server/utils/notion/pages.js';
import { refreshSlideData } from '../server/utils/data-source/index.js';
import {
  AppError,
  ValidationError,
  isAppError,
} from '../server/utils/errors.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const isAppErrorWithStatus = (status) => (err) =>
  isAppError(err) && err.statusCode === status;

test('unconfigured Notion answers 501, envelope code stays internal_error', async () => {
  delete process.env.NOTION_SECRET;
  await assert.rejects(
    () => notionFetchJson('/pages/x'),
    (err) => {
      assert.ok(isAppError(err));
      assert.equal(err.statusCode, 501);
      // 501 has no dedicated machine code; ≥500 falls back to internal_error —
      // the same code errorToResponse() produced before the conversion.
      assert.equal(err.toJSON().error, 'internal_error');
      return true;
    },
  );
});

test('notion input validation throws 400 ValidationError', async () => {
  await assert.rejects(
    () => appendBlocksToPage('', []),
    (err) => err instanceof ValidationError && err.statusCode === 400,
  );
  await assert.rejects(
    () => appendBlocksToPage('abc'.repeat(12), []),
    isAppErrorWithStatus(400),
  );
  await assert.rejects(
    () => fetchNotionPage('not a notion url'),
    isAppErrorWithStatus(400),
  );
});

test('data-source validation failures stay 400', async () => {
  await assert.rejects(
    () => refreshSlideData({ provider: 'no-such-provider' }, {}),
    isAppErrorWithStatus(400),
  );
});

test('no bare .statusCode assignment left in the three converted trees', () => {
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
  walk(path.join(repoRoot, 'server/utils/notion'));
  walk(path.join(repoRoot, 'server/utils/data-source'));
  const features = readFileSync(
    path.join(repoRoot, 'server/config/features.js'),
    'utf8',
  );
  if (/\.statusCode = /.test(features))
    offenders.push('server/config/features.js');
  assert.deepEqual(
    offenders,
    [],
    `These modules must throw AppError subclasses: ${offenders.join(', ')}`,
  );
});

test('upstream Notion payloads never reach the serialized envelope', () => {
  const err = new AppError('Notion request failed (400)', 400);
  err.upstream = { secret: 'raw notion payload' };
  const body = err.toJSON();
  assert.ok(!('upstream' in body));
  assert.ok(!JSON.stringify(body).includes('raw notion payload'));
});
