/**
 * The markdown importer must emit `list-slide` for every bullet-list import.
 *
 * This is the regression that matters most in the list consolidation. The
 * importer once produced a now-retired Dutch alias of this type on every
 * bullet-list import, so the alias population would have kept growing while we
 * tried to empty it. Both routes into the list builder are covered: the explicit
 * `layout: list` directive and the "**bold**: description" heuristic.
 *
 * Run with: node --test tests/markdown-import-list-slide.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { parseMarkdownDeck } from '../server/utils/markdown-import/parse.js';
import { mapParsedDeckToSlides } from '../server/utils/markdown-import/map.js';
import { LAYOUT_TO_SLIDE_TYPE } from '../server/utils/markdown-import/constants.js';

const mapped = (md) => mapParsedDeckToSlides(parseMarkdownDeck(md)).slides;

describe('markdown import: lists land on list-slide', () => {
  it('maps the explicit `layout: list` directive to list-slide', () => {
    assert.equal(LAYOUT_TO_SLIDE_TYPE.list.type, 'list-slide');
  });

  it('emits list-slide for a bold-colon bullet list', () => {
    const slides = mapped(
      [
        '# Our approach',
        '',
        '- **Discovery**: understand the goal',
        '- **Strategy**: pick the route',
        '- **Delivery**: ship it',
      ].join('\n'),
    );

    assert.equal(slides.length, 1);
    assert.equal(slides[0].type, 'list-slide');
    assert.equal(slides[0].content.items.length, 3);
    assert.equal(slides[0].content.items[0].title, 'Discovery');
    assert.equal(slides[0].content.items[0].text, 'understand the goal');
  });

  it('always emits list-slide, whatever the input', () => {
    const decks = [
      '# Plain\n\n- **A**: one\n- **B**: two',
      '---\nlayout: list\n---\n\n# Directed\n\n- **A**: one\n- **B**: two',
    ];
    for (const md of decks) {
      for (const slide of mapped(md)) {
        assert.equal(slide.type, 'list-slide');
      }
    }
  });
});
