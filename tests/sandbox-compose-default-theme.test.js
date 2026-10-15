/**
 * The sandbox compose file names no theme that does not exist.
 *
 * `docker-compose.sandbox.yml` defaulted `SANDBOX_DEFAULT_THEME` to
 * `deckyard`, a seed renamed to `amethyst` long ago, so every deck created
 * without a theme on the sandbox failed with "Sandbox theme seed not found".
 * The compose default is now empty and the server keeps the one default
 * (`server/config/sandbox.js`); should a default return here, it must name a
 * core seed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('SANDBOX_DEFAULT_THEME in the sandbox compose file is empty or a core seed', () => {
  const compose = readFileSync(
    path.join(root, 'docker-compose.sandbox.yml'),
    'utf8',
  );
  const match = compose.match(
    /SANDBOX_DEFAULT_THEME:\s*'\$\{SANDBOX_DEFAULT_THEME:-([^}]*)\}'/,
  );
  assert.ok(match, 'docker-compose.sandbox.yml passes SANDBOX_DEFAULT_THEME');
  const fallback = match[1];
  if (fallback === '') return;
  const seeds = readdirSync(path.join(root, 'themes'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
  assert.ok(
    seeds.includes(fallback),
    `compose default "${fallback}" is not one of ${seeds.join(', ')}`,
  );
});
