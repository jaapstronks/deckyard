/**
 * The sandbox names no theme that does not exist.
 *
 * `docker-compose.sandbox.yml` defaulted `SANDBOX_DEFAULT_THEME` to
 * `deckyard`, a seed renamed to `amethyst` long ago, so every deck created
 * without a theme on the sandbox failed with "Sandbox theme seed not found".
 * The compose default is now empty and the server keeps the one default
 * (`server/config/sandbox.js`). Both must name a core seed slug, the key the
 * sandbox resolves a theme handle against.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../server/config/paths.js';
import { sandboxDefaultThemeId } from '../server/config/sandbox.js';
import { readCoreThemeSeeds } from '../server/utils/theme-seeds.js';

const coreSlugs = new Set(
  (await readCoreThemeSeeds()).map(({ record }) => record.slug),
);

test('the server default sandbox theme is a core seed', () => {
  const saved = process.env.SANDBOX_DEFAULT_THEME;
  delete process.env.SANDBOX_DEFAULT_THEME;
  try {
    const id = sandboxDefaultThemeId();
    assert.ok(coreSlugs.has(id), `server default "${id}" is not a core seed`);
  } finally {
    if (saved !== undefined) process.env.SANDBOX_DEFAULT_THEME = saved;
  }
});

test('SANDBOX_DEFAULT_THEME in the sandbox compose file is empty or a core seed', () => {
  const compose = readFileSync(
    path.join(repoRoot, 'docker-compose.sandbox.yml'),
    'utf8',
  );
  const match = compose.match(
    /SANDBOX_DEFAULT_THEME:\s*'\$\{SANDBOX_DEFAULT_THEME:-([^}]*)\}'/,
  );
  assert.ok(match, 'docker-compose.sandbox.yml passes SANDBOX_DEFAULT_THEME');
  const fallback = match[1];
  if (fallback === '') return;
  assert.ok(
    coreSlugs.has(fallback),
    `compose default "${fallback}" is not one of ${[...coreSlugs].join(', ')}`,
  );
});
