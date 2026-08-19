/**
 * The render contract for a slide whose type does not resolve.
 *
 * Removing a slide type is only safe if a deck that still carries it stays
 * legible. Before this contract, a removed type rendered as a bare "Unknown
 * slide type" box: it named nothing and dropped the stored content on every
 * surface, which is why removing a type decks actually use was blocked.
 *
 * These tests pin the promise itself, not one surface's markup:
 *
 * 1. the missing type is named;
 * 2. a deliberate removal is told apart from an unrecognised name, with the
 *    successor when there is one;
 * 3. the stored content stays visible;
 * 4. it renders as an archived slide, never as a thrown error;
 * 5. the reader projection is the complete surface (the canvas is bounded).
 *
 * Run with: node --test tests/unresolved-slide-render.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderSlideHtml } from '../shared/slide-types.js';
import {
  describeUnresolvedType,
  renderUnresolvedSlideHtml,
  renderUnresolvedSlideSemanticHtml,
  unresolvedContentEntries,
  unresolvedSlideAsMarkdown,
} from '../shared/slide-types/unresolved.js';

describe('describeUnresolvedType', () => {
  it('reports a removed core type with its successor', () => {
    // agenda-timeline-slide is the model removal: consolidated into another
    // type, with a DB migration. The record is what lets the placeholder say
    // where the content should go instead of shrugging.
    const info = describeUnresolvedType('agenda-timeline-slide');
    assert.equal(info.state, 'removed');
    assert.equal(info.successor, 'timeline-slide');
    assert.ok(info.successorLabel, 'resolves the successor to its human label');
  });

  it('reports a removed type without a successor', () => {
    const info = describeUnresolvedType('freeform-slide');
    assert.equal(info.state, 'removed');
    assert.equal(info.successor, null);
    assert.ok(info.removed, 'carries when it went');
  });

  it('reports an unrecognised name as unknown, not removed', () => {
    // A fork's custom type, a typo or a deck from a newer Deckyard. The record
    // cannot speak for it, and the placeholder must not pretend it can.
    assert.equal(describeUnresolvedType('acme-hero-slide').state, 'unknown');
    assert.equal(describeUnresolvedType('').state, 'unknown');
  });
});

describe('unresolvedContentEntries', () => {
  it('keeps content and drops presentation-only keys', () => {
    const entries = unresolvedContentEntries({
      title: 'Q3',
      col1Title: 'Left',
      slideBgImage: '/uploads/x.png',
      textStyles: { title: { align: 'center' } },
      background: 'mist',
      empty: '   ',
    });
    const keys = entries.map((e) => e.key);
    assert.deepEqual(keys, ['title', 'col1Title']);
    assert.equal(
      entries[1].label,
      'Col 1 title',
      'stored key humanised honestly',
    );
    assert.ok(
      !keys.includes('empty'),
      'blank values are not listed as content',
    );
  });

  it('flattens nested items one level instead of showing [object Object]', () => {
    const entries = unresolvedContentEntries({
      items: [{ title: 'One', body: 'First' }, { title: 'Two' }],
    });
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].lines, [
      'Title: One',
      'Body: First',
      'Title: Two',
    ]);
  });
});

describe('the canvas placeholder', () => {
  const slide = {
    type: 'agenda-timeline-slide',
    content: { title: 'Programme', item1Label: 'Welcome', item1Body: 'Coffee' },
  };

  it('names the type, the removal and the successor, and keeps the content', () => {
    const html = renderUnresolvedSlideHtml(slide);
    assert.match(
      html,
      /class="slide slide-unresolved"/,
      'still a slide, not an error',
    );
    assert.match(html, /agenda-timeline-slide/, 'names the missing type');
    assert.match(html, /was removed from Deckyard/);
    assert.match(html, /Rebuild this slide as a/, 'points at the successor');
    assert.match(
      html,
      /Programme/,
      'the slide keeps its own title as the heading',
    );
    assert.match(html, /Welcome/, 'stored content stays visible');
  });

  it('says a type is unavailable rather than removed when it is merely unknown', () => {
    const html = renderUnresolvedSlideHtml({
      type: 'acme-hero-slide',
      content: { title: 'Hi' },
    });
    assert.match(html, /Unavailable slide type/);
    assert.match(html, /acme-hero-slide/);
    assert.doesNotMatch(html, /was removed from Deckyard/);
  });

  it('is bounded, and says how much it withheld', () => {
    // A slide frame does not scroll: showing everything would overflow the
    // canvas silently. Truncating without saying so would be the same failure
    // the generic box made, so the count is part of the contract.
    const content = {};
    for (let i = 1; i <= 12; i += 1) content[`field${i}`] = `value ${i}`;
    const html = renderUnresolvedSlideHtml({ type: 'freeform-slide', content });
    assert.match(html, /\+6 more fields/);
    assert.match(
      html,
      /reader view/,
      'points at the surface that shows the rest',
    );
  });

  it('escapes stored content (no live type definition validated it)', () => {
    const html = renderUnresolvedSlideHtml({
      type: 'freeform-slide',
      content: { title: '<img src=x onerror=alert(1)>' },
    });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  it('is what renderSlideHtml falls back to', () => {
    const html = renderSlideHtml({
      type: 'freeform-slide',
      content: { title: 'Old' },
    });
    assert.match(html, /slide-unresolved/);
    assert.match(html, /Old/);
  });

  it('never throws, whatever the slide looks like', () => {
    for (const bad of [
      undefined,
      {},
      { type: 'x' },
      { type: 'x', content: null },
    ]) {
      assert.doesNotThrow(() => renderSlideHtml(bad));
    }
  });
});

describe('the reader projection', () => {
  it('is complete where the canvas is bounded', () => {
    const content = {};
    for (let i = 1; i <= 12; i += 1) content[`field${i}`] = `value ${i}`;
    const html = renderUnresolvedSlideSemanticHtml({
      type: 'freeform-slide',
      content,
    });
    for (let i = 1; i <= 12; i += 1) {
      assert.match(html, new RegExp(`value ${i}`), `field ${i} is readable`);
    }
  });

  it('does not repeat the content key the reader already used as the heading', () => {
    const html = renderUnresolvedSlideSemanticHtml(
      {
        type: 'freeform-slide',
        content: { title: 'Heading text', note: 'Body text' },
      },
      { headingKey: 'title' },
    );
    assert.match(html, /Body text/);
    assert.doesNotMatch(html, /Heading text/);
  });

  it('carries the same explanation as the canvas', () => {
    const html = renderUnresolvedSlideSemanticHtml({
      type: 'agenda-timeline-slide',
      content: { item1Label: 'Welcome' },
    });
    assert.match(html, /reader-archived/);
    assert.match(html, /agenda-timeline-slide/);
    assert.match(html, /Rebuild this slide as a/);
  });
});

describe('the import placeholder', () => {
  it('carries the explanation and the content into a storable content-slide', () => {
    // Import persists rather than renders: whatever it drops is gone for good,
    // so this is the one surface where the contract has to survive as text.
    const { title, body } = unresolvedSlideAsMarkdown({
      type: 'freeform-slide',
      content: { title: 'Old canvas', caption: 'Kept' },
    });
    assert.equal(title, 'Old canvas');
    assert.match(body, /freeform-slide/);
    assert.match(body, /Kept/);
  });
});
