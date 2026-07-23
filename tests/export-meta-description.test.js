import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStandaloneHtml } from '../server/export/html.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * The reader view emits <meta name="description"> but the visual export/
 * published head did not. buildStandaloneHtml now emits exactly one, from the
 * caller-supplied `description` (published route) or the deck's own field.
 */

function deck(extra = {}) {
  return {
    id: 'd',
    title: 'T',
    slides: [{ id: 's', type: 'payoff-slide', content: {} }],
    ...extra,
  };
}

test('export emits one escaped description meta from the deck field', async () => {
  const html = await buildStandaloneHtml(
    repoRoot,
    deck({ description: 'Cats <b> & dogs' }),
    {},
  );
  assert.equal((html.match(/<meta name="description"/g) || []).length, 1);
  assert.match(
    html,
    /<meta name="description" content="Cats &lt;b&gt; &amp; dogs" \/>/,
  );
});

test('the description option overrides the deck field (published route)', async () => {
  const html = await buildStandaloneHtml(repoRoot, deck({ description: 'own' }), {
    context: 'published',
    description: 'Overridden',
  });
  assert.equal((html.match(/<meta name="description"/g) || []).length, 1);
  assert.match(html, /content="Overridden"/);
});

test('no description → no description meta (no empty tag)', async () => {
  const html = await buildStandaloneHtml(repoRoot, deck(), {});
  assert.doesNotMatch(html, /<meta name="description"/);
});
