import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEmbedHtml } from '../server/utils/embed-html/index.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * The embed <html> element must carry a `dir` attribute so RTL decks
 * (ar/he/fa/ur) render right-to-left, matching export/reader/print which
 * all set it via getDocDir. Regression guard for the missing-dir bug.
 */

function deck(overrides = {}) {
  return {
    title: 'Test deck',
    slides: [{ id: 's1', type: 'payoff-slide', content: {} }],
    ...overrides,
  };
}

test('embed <html> defaults to dir="ltr" for a non-RTL deck', () => {
  const html = buildEmbedHtml(repoRoot, deck({ lang: 'nl' }));
  assert.match(html, /<html lang="nl" dir="ltr"/);
});

test('embed <html> emits dir="rtl" for an RTL deck (pres.lang)', () => {
  const html = buildEmbedHtml(repoRoot, deck({ lang: 'ar' }));
  assert.match(html, /<html lang="[^"]*" dir="rtl"/);
});

test('embed <html> emits dir="rtl" when i18n active is RTL', () => {
  const html = buildEmbedHtml(
    repoRoot,
    deck({ i18n: { active: 'he' } }),
  );
  assert.match(html, /dir="rtl"/);
});
