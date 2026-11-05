/**
 * An MCP preview loads nothing over the network (DY-853).
 *
 * A preview lands in a client frame without a Deckyard origin, so every
 * root-relative path in it loads nothing. `embedSlideImages()` inlines a
 * slide's image fields, but the renderer draws images of its own: the theme
 * logo on a title slide stayed `/assets/…` and showed as a broken icon. A
 * theme var may also hold `url('/uploads/…')`.
 *
 * Run with: node --test tests/mcp-preview-assets.test.js
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSingleSlidePreviewHtml,
  buildSlidePreviewHtml,
} from '../server/mcp/preview.js';
import { createCoreFixtureRoot } from './helpers/core-fixture-root.js';

const { root, remove } = createCoreFixtureRoot('deckyard-preview-assets-');
after(remove);

const titleSlide = {
  id: 's1',
  type: 'title-slide',
  content: { title: 'Logo' },
};

const theme = {
  assets: { logo: '/assets/images/logo.svg' },
  cssVars: { '--t-logo-url': "url('/assets/images/logo.svg')" },
};

/** Every root-relative `src` or `url()` left in a document. */
const rootRelativeRefs = (html) => [
  ...[...html.matchAll(/\ssrc="(\/[^"]*)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/url\(\s*['"]?(\/[^)'"]*)/g)].map((m) => m[1]),
];

for (const [label, withTheme] of [
  ['without a theme', null],
  ['with a theme logo', theme],
]) {
  test(`a single-slide preview inlines the logo (${label})`, async () => {
    const html = await buildSingleSlidePreviewHtml(titleSlide, {
      repoRoot: root,
      theme: withTheme,
    });
    assert.deepEqual(rootRelativeRefs(html), []);
    assert.match(html, /class="tsu-logo-img" src="data:image\/svg\+xml;/);
  });

  test(`a list preview inlines the logo (${label})`, async () => {
    const html = await buildSlidePreviewHtml([titleSlide], {
      repoRoot: root,
      theme: withTheme,
    });
    assert.deepEqual(rootRelativeRefs(html), []);
    assert.match(html, /class="tsu-logo-img" src="data:image\/svg\+xml;/);
  });
}
