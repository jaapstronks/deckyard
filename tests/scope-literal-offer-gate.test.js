/** Scope literals outside storage are a shrinking migration list (B663). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = join(root, 'server');

// Existing literals only. Removing a site requires removing its entry here.
const ALLOWED = {
  'server/export/deck-slide-types.js': 1,
  'server/export/deck-theme.js': 1,
  'server/jobs/queue/workers/bulk-export-worker.js': 1,
  'server/routes/api/share-links/public.js': 1,
  'server/routes/static/published.js': 2,
  'server/routes/static/embed.js': 1,
  'server/services/exports.js': 1,
  'server/services/publish-presentation.js': 1,
  'server/utils/themes.js': 1,
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) yield* files(file);
    else if (file.endsWith('.js')) yield file;
  }
}

/** Count scope arguments and properties beginning with organizationId. */
export function scopeLiteralCount(source) {
  return [...source.matchAll(/(?:\(\s*|\bscope\s*:\s*)\{\s*organizationId\b/g)]
    .length;
}

test('scope literals outside storage only shrink', () => {
  const found = {};
  for (const file of files(server)) {
    const path = relative(root, file);
    if (path.startsWith('server/storage/')) continue;
    const count = scopeLiteralCount(readFileSync(file, 'utf8'));
    if (count) found[path] = count;
  }
  assert.deepEqual(found, ALLOWED);
});

test('scope detector distinguishes literals from destructuring', () => {
  assert.equal(
    scopeLiteralCount(
      'const { organizationId } = scope;\nloadOffer({ organizationId });',
    ),
    1,
  );
});

test('scope detector catches formatted call arguments', () => {
  assert.equal(scopeLiteralCount('loadOffer({\n  organizationId,\n});'), 1);
  assert.equal(scopeLiteralCount('loadOffer(\n  { organizationId },\n);'), 1);
  assert.equal(
    scopeLiteralCount('notify({ scope: {\n  organizationId,\n} });'),
    1,
  );
});
