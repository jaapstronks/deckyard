/**
 * A published edition and its embed talk to this server and nobody else (D56).
 *
 * External analytics used to be injected into `/p/…` and `/embed/…`, gated by
 * `ANALYTICS_INCLUDE_EMBEDS` / `ANALYTICS_INCLUDE_EXPORTS`. The decision was
 * that the document CSP's block is the wanted end state: a published deck is
 * where strangers land and there is no consent seam on it. The normative rule
 * lives in `docs/reference/no-third-party-origins.md` § *A published deck and
 * an embed are first-party-only*.
 *
 * Since T1.5 both surfaces serve an edition (`server/routes/static/edition.js`):
 * the HTML comes from the edition's own render bundle and the serving
 * installation adds HTTP headers and nothing else, so no route can inject a
 * tag into it. The old addresses (`server/routes/static/published.js`) only
 * redirect. This file pins that neither route reaches for the third-party
 * analytics head; the frozen chrome is pinned by the renderer-bundle tests.
 *
 * Run with: node --test tests/published-embed-first-party-only.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the edition and old-link routes never reach for the analytics head', () => {
  for (const rel of [
    'server/routes/static/edition.js',
    'server/routes/static/published.js',
    'server/services/public-edition.js',
  ]) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    assert.ok(
      !src.includes('analytics/head.js') && !src.includes('analyticsHeadHtml'),
      `${rel} must not import the third-party analytics head`,
    );
  }
});

test('the old-link route renders nothing: it only redirects or 404s', () => {
  const src = readFileSync(
    new URL('../server/routes/static/published.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /buildStandaloneHtml|buildReaderHtml|<script/);
});
