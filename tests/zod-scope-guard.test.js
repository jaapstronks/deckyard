import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A7.19 B2 — `zod` is for LLM output schemas, nothing else.
 *
 * It earns its place in `dependencies` by parsing what a model hands back
 * (`server/utils/ai/schemas/`), which is genuinely untyped input. On request
 * bodies it would be a *second* validation vocabulary next to
 * `server/utils/request-validators.js`, with `docs/openapi.yaml` as a third
 * place the same contract is written down — the tolerance creep the beta
 * doctrine blocks (docs/reference/versioning.md).
 *
 * `eslint.config.js` carries the same rule via `no-restricted-imports`, which
 * is what gates CI and what an editor shows inline. This test is the half that
 * a plain local `npm test` catches, without needing the lint pass to have run.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** The only directory allowed to import zod. */
const ALLOWED = 'server/utils/ai/schemas';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'coverage',
  'custom',
  'client/vendor',
  'server/data',
  'server/uploads',
]);

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(REPO_ROOT, full);
    if (SKIP_DIRS.has(rel) || SKIP_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('zod is imported only from server/utils/ai/schemas', async () => {
  const files = await walk(REPO_ROOT);
  const offenders = [];

  for (const rel of files) {
    if (rel.startsWith(ALLOWED + path.sep)) continue;
    const src = await fs.readFile(path.join(REPO_ROOT, rel), 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (
        /\bfrom\s+['"]zod['"]/.test(line) ||
        /\brequire\(\s*['"]zod['"]\s*\)/.test(line)
      ) {
        offenders.push(`${rel}:${i + 1}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'zod belongs to the AI output schemas. Validate request bodies with ' +
      `server/utils/request-validators.js instead:\n${offenders.join('\n')}`,
  );
});

test('the allowed directory actually uses zod — the allowance is not stale', async () => {
  const dir = path.join(REPO_ROOT, ALLOWED);
  const files = await fs.readdir(dir);
  const sources = await Promise.all(
    files
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFile(path.join(dir, f), 'utf8')),
  );

  assert.ok(
    sources.some((src) => /\bfrom\s+['"]zod['"]/.test(src)),
    `nothing in ${ALLOWED} imports zod any more — drop the dependency and this ` +
      'allowance rather than leaving a carve-out for a use that no longer exists',
  );
});
