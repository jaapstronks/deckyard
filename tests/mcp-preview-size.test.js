/**
 * An MCP preview is small enough for a client to show it (DY-842).
 *
 * `preview_slide` returned the whole slide CSS chain with every comment for
 * one title slide, plus its background at export resolution: 424,687
 * characters, ~217k tokens. Claude Code refuses a tool result over its token
 * cap and writes it to a file instead, so the user never saw the slide. The
 * preview now ships only the rules the rendered slides can match (a rule
 * scoped to another type's root class cannot), without comments, and caps
 * each image at preview resolution.
 *
 * The budgets below are characters, the unit a test can read; the cap they
 * guard is Claude Code's 25,000-token default for an MCP result, and this
 * CSS runs at about two characters a token.
 *
 * Run with: node --test tests/mcp-preview-size.test.js
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import sharp from 'sharp';

import {
  buildSingleSlidePreviewHtml,
  buildSlidePreviewHtml,
} from '../server/mcp/preview.js';
import {
  compactCss,
  pruneUnmatchableRules,
  rootClassesInMarkup,
} from '../server/utils/css-type-scope.js';
import { SLIDE_TYPES, newSlide } from '../shared/slide-types.js';
import { createCoreFixtureRoot } from './helpers/core-fixture-root.js';

const { root, remove } = createCoreFixtureRoot('deckyard-preview-size-');
after(remove);

/** A text-only title slide was ~350k characters before; now ~32k. */
const SINGLE_TEXT_BUDGET = 45_000;

/** The `<style>` text of a preview document. */
const styleOf = (html) =>
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n');

const titleSlide = {
  id: 's1',
  type: 'title-slide',
  content: { title: 'Preview size' },
};

test('a text-only title slide preview stays inside the budget', async () => {
  const html = await buildSingleSlidePreviewHtml(titleSlide, {
    repoRoot: root,
  });
  assert.ok(
    html.length <= SINGLE_TEXT_BUDGET,
    `preview is ${html.length} characters, budget ${SINGLE_TEXT_BUDGET}`,
  );
});

test("a preview carries its own type's rules and not another type's", async () => {
  const css = styleOf(
    await buildSingleSlidePreviewHtml(titleSlide, { repoRoot: root }),
  );
  assert.match(css, /\.slide-title[.\s{:,[]/);
  assert.doesNotMatch(css, /\.slide-timeline\b/);
  assert.doesNotMatch(css, /\.slide-team-cards\b/);
  assert.doesNotMatch(css, /\/\*/, 'comments are stripped');
});

test('the list preview keeps the rules of every type it shows', async () => {
  const slides = ['title-slide', 'timeline-slide'].map((type) =>
    newSlide({ type, slideTypes: SLIDE_TYPES, demoPictures: false }),
  );
  const css = styleOf(await buildSlidePreviewHtml(slides, { repoRoot: root }));
  assert.match(css, /\.slide-timeline\b/);
  assert.match(css, /\.slide-title[.\s{:,[]/);
  assert.doesNotMatch(css, /\.slide-team-cards\b/);
});

test("a type that carries another type's root keeps that type's rules", async () => {
  // A likert slider renders as `.slide-likert-slider.slide-likert`; deriving
  // the used roots from slide types alone would drop the shared likert rules.
  const slider = newSlide({
    type: 'likert-slider-slide',
    slideTypes: SLIDE_TYPES,
  });
  const css = styleOf(
    await buildSingleSlidePreviewHtml(slider, { repoRoot: root }),
  );
  assert.match(css, /\.slide-likert[\s{.:,]/);
});

test('an image is embedded at preview resolution, not source', async () => {
  // demo-moss.jpg is 2400x1600 in the checkout.
  const slide = {
    id: 'img',
    type: 'image-slide',
    content: { image: '/assets/images/backgrounds/demo-moss.jpg' },
  };
  const html = await buildSingleSlidePreviewHtml(slide, { repoRoot: root });
  const m = html.match(
    /data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)/,
  );
  assert.ok(m, 'the image is inlined');
  const meta = await sharp(Buffer.from(m[1], 'base64')).metadata();
  assert.ok(
    Math.max(meta.width, meta.height) <= 960,
    `embedded at ${meta.width}x${meta.height}`,
  );
});

test('pruning drops a rule only when every selector needs an absent root', () => {
  const roots = new Set(['slide-a', 'slide-b']);
  const unused = (cls) => roots.has(cls) && cls !== 'slide-a';
  const css = [
    '.slide-a .x { color: red; }',
    '.slide-b .y { color: blue; }',
    '.slide-b .z, .other { color: green; }',
    '.thing:not(.slide-b) { color: black; }',
    '@media (min-width: 1px) { .slide-b .w { color: pink; } .slide-a .v { color: navy; } }',
    '@font-face { font-family: X; }',
  ].join('\n');
  const out = pruneUnmatchableRules(css, unused);
  assert.match(out, /\.slide-a \.x/);
  assert.doesNotMatch(out, /\.slide-b \.y/);
  assert.match(out, /\.slide-b \.z,\.other|\.slide-b \.z, \.other/);
  assert.match(out, /:not\(\.slide-b\)/);
  assert.doesNotMatch(out, /\.slide-b \.w/);
  assert.match(out, /\.slide-a \.v/);
  assert.match(out, /@font-face/);
});

test('compaction leaves string literals alone', () => {
  const out = compactCss(
    '/* gone */ .a::before {\n  content: "/* kept */  two  spaces";\n}\n',
  );
  assert.equal(out, '.a::before{content: "/* kept */  two  spaces";}');
});

test('root classes are read from markup, not guessed from types', () => {
  const found = rootClassesInMarkup(
    '<div class="slide slide-b slide-a-inner"><p class=\'slide-c\'></p></div>',
    ['slide-a', 'slide-b', 'slide-c'],
  );
  assert.deepEqual([...found].sort(), ['slide-b', 'slide-c']);
});
