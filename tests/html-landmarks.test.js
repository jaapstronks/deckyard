import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStandaloneHtml } from '../server/export/html.js';
import { buildEmbedHtml } from '../server/utils/embed-html/index.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * The visual export/embed scaffolds were anonymous <div> chains. AT landmark
 * navigation needs real landmarks: one <main> per document, a <header> topbar,
 * a <nav> for slide controls. Pure tag swaps — classes/behavior unchanged.
 */

function deck() {
  return {
    id: 'deck1',
    title: 'Landmark deck',
    lang: 'en-GB',
    slides: [{ id: 's1', type: 'payoff-slide', content: {} }],
  };
}

test('export scaffold exposes header/main/nav/footer landmarks', async () => {
  const html = await buildStandaloneHtml(repoRoot, deck(), {
    context: 'published',
  });
  assert.match(html, /<header class="presenter-topbar">/);
  assert.match(html, /<main id="deck" class="deck"/);
  assert.match(html, /<nav class="ps-standalone-nav" aria-label="Slide navigation">/);
  assert.match(html, /<footer class="presenter-progress">/);
  // exactly one <main> in the document
  assert.equal((html.match(/<main[\s>]/g) || []).length, 1);
});

test('embed scaffold wraps the deck in a single <main>', () => {
  const html = buildEmbedHtml(repoRoot, deck());
  assert.match(html, /<main id="deck" class="deck"/);
  assert.equal((html.match(/<main[\s>]/g) || []).length, 1);
  // the controls bar keeps its toolbar role
  assert.match(html, /role="toolbar"/);
});
