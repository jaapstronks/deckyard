/**
 * The image carries its own HEALTHCHECK on `/health` (B428), so a PaaS or
 * compose knows when the container serves without configuring one.
 *
 * Run with: node --test tests/dockerfile-healthcheck.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dockerfile = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Dockerfile'),
  'utf8',
);

test('the runtime stage has one HEALTHCHECK, on /health at PORT', () => {
  const checks = dockerfile.match(/^HEALTHCHECK (?:[^\n]*\\\n)*[^\n]*/gm) || [];
  assert.equal(checks.length, 1);
  assert.match(checks[0], /\/health/);
  assert.match(checks[0], /process\.env\.PORT/);
  // After the last FROM: a HEALTHCHECK in the deps stage is not inherited.
  assert.ok(
    dockerfile.lastIndexOf('HEALTHCHECK') > dockerfile.lastIndexOf('\nFROM '),
  );
});
