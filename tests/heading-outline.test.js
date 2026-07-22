import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStandaloneHtml } from '../server/export/html.js';
import { buildEmbedHtml } from '../server/utils/embed-html/index.js';
import {
  computeHeadingShifts,
  shiftHeadingLevels,
} from '../shared/slide-types.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * The visual output paths (standalone export / published player / embed) emit a
 * NESTED heading outline: the deck title is the single document <h1>; a
 * chapter-title slide is an <h2> section heading and pushes the slides after it
 * one level deeper (title <h3>, markdown subheading <h4>). Slides before any
 * chapter sit at <h2>/<h3> directly under the deck <h1>. Levels are threaded via
 * ctx (computeHeadingShifts + shiftHeadingLevels), never hardcoded per type.
 */

function id(n) {
  return `0000000000000000000000000000000${n}`.slice(-32).replace(
    /(.{8})(.{4})(.{4})(.{4})(.{12})/,
    '$1-$2-$3-$4-$5',
  );
}

// A content slide's markdown subheadings are only real <h3> elements once the
// DOM sanitizer is initialised (production/server); in the bare Node test env
// markdownToSafeHtml HTML-escapes its output. So the integration assertions use
// a slide type that emits a REAL heading element for its in-slide subheading
// (comparison's <h3 class="side-title">); the markdown-subheading capping is
// pinned directly by the shiftHeadingLevels unit test above.
function outlineDeck() {
  return {
    id: id(0),
    title: 'Outline deck',
    lang: 'en-GB',
    slides: [
      { id: id(1), type: 'title-slide', content: { title: 'Opening' } },
      { id: id(2), type: 'content-slide', content: { title: 'Intro' } },
      { id: id(3), type: 'chapter-title-slide', content: { title: 'Part One' } },
      {
        id: id(4),
        type: 'comparison-slide',
        content: { title: 'Compare', leftTitle: 'Left', rightTitle: 'Right' },
      },
    ],
  };
}

test('computeHeadingShifts: chapter opens a running section', () => {
  const slides = [
    { type: 'title-slide' },
    { type: 'content-slide' },
    { type: 'chapter-title-slide' },
    { type: 'content-slide' },
    { type: 'content-slide' },
    { type: 'chapter-title-slide' },
    { type: 'content-slide' },
  ];
  // chapters themselves stay at shift 0 (they ARE the section heading); only
  // what follows drops a level.
  assert.deepEqual(computeHeadingShifts(slides), [0, 0, 0, 1, 1, 0, 1]);
  assert.deepEqual(computeHeadingShifts([]), []);
  assert.deepEqual(computeHeadingShifts(null), []);
});

test('shiftHeadingLevels: floors to h2 and descends, preserving attributes', () => {
  // floor: a stray <h1> can never survive as a second document <h1>
  assert.equal(
    shiftHeadingLevels('<h1 class="title">X</h1>', 0),
    '<h2 class="title">X</h2>',
  );
  // descend one level, open + close tags both rewritten
  assert.equal(
    shiftHeadingLevels('<h2 class="heading" data-x="y">T</h2>', 1),
    '<h3 class="heading" data-x="y">T</h3>',
  );
  assert.equal(
    shiftHeadingLevels('<h3 class="md-subheading">S</h3>', 1),
    '<h4 class="md-subheading">S</h4>',
  );
  // non-heading tags starting with "h" are untouched
  assert.equal(shiftHeadingLevels('<header><hr></header>', 1), '<header><hr></header>');
  // capped at h6
  assert.equal(shiftHeadingLevels('<h6>D</h6>', 1), '<h6>D</h6>');
});

test('export: exactly one <h1> (the deck title) and a nested slide outline', async () => {
  const html = await buildStandaloneHtml(repoRoot, outlineDeck(), {
    context: 'published',
  });
  // The deck title is the single document <h1>.
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, /<h1 class="presenter-title">Outline deck<\/h1>/);
  // Title slide, content slide and chapter all sit at <h2> under the deck <h1>.
  assert.match(html, /<h2[^>]*>Opening<\/h2>/);
  assert.match(html, /<h2[^>]*>Intro<\/h2>/);
  assert.match(html, /<h2[^>]*>Part One<\/h2>/);
  // A slide inside the chapter section drops one level: title <h3>, and its
  // in-slide subheading is capped at <h4>.
  assert.match(html, /<h3[^>]*>Compare<\/h3>/);
  assert.match(html, /<h4[^>]*>Left<\/h4>/);
  // The pre-chapter title slide must NOT still be an <h1>.
  assert.doesNotMatch(html, /<h1[^>]*>Opening<\/h1>/);
});

test('embed: a fragment has no <h1>; slide titles nest from <h2>', () => {
  const html = buildEmbedHtml(repoRoot, outlineDeck());
  // The embed is embedded in a host page that owns the <h1>.
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 0);
  assert.match(html, /<h2[^>]*>Opening<\/h2>/);
  assert.match(html, /<h2[^>]*>Part One<\/h2>/);
  assert.match(html, /<h3[^>]*>Compare<\/h3>/);
  assert.match(html, /<h4[^>]*>Left<\/h4>/);
});
