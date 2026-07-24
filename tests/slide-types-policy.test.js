import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInsertableSlideType } from '../client/views/editor/slide-types-policy.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';

test('a normal type is insertable', () => {
  assert.equal(
    isInsertableSlideType({ type: 'content-slide', def: { label: 'Text' } }),
    true
  );
});

test('deprecated types are never insertable (hidden from picker + AI)', () => {
  assert.equal(
    isInsertableSlideType({
      type: 'card-stack-slide',
      def: { label: 'Card stack', deprecated: true },
    }),
    false
  );
});

test('split-partner-title-slide is archived: deprecated + not insertable, still registered', () => {
  const def = SLIDE_TYPES['split-partner-title-slide'];
  assert.ok(def, 'type stays registered so stored/forked decks keep rendering');
  assert.equal(def.deprecated, true, 'marked deprecated (archive convention)');
  assert.equal(
    isInsertableSlideType({ type: 'split-partner-title-slide', def }),
    false,
    'hidden from every insertion path (picker + AI)'
  );
  // Rendering never goes through the insertability gate, so an existing deck
  // still renders unchanged.
  assert.doesNotThrow(() =>
    def.renderHtml({ title: 'T', logos: [], bgImage: '/x.jpg' })
  );
});

test('freeform-slide is archived: deprecated + not insertable, still renders stored decks', () => {
  const def = SLIDE_TYPES['freeform-slide'];
  assert.ok(def, 'type stays registered so decks that already use it keep rendering');
  assert.equal(def.deprecated, true, 'marked deprecated (archive convention, PR #197)');
  assert.equal(
    isInsertableSlideType({ type: 'freeform-slide', def }),
    false,
    'hidden from every insertion path (picker + AI)'
  );
  // A stored freeform slide (absolutely-positioned elements) still renders via
  // the kept render-only path — no authoring surface required.
  const html = def.renderHtml({
    elements: [
      { id: 'e1', type: 'heading', x: 10, y: 10, width: 80, height: 15, zIndex: 1, content: 'Kept', fontSize: 'xl' },
    ],
    background: 'lime',
  });
  assert.match(html, /class="slide/);
  assert.match(html, /Kept/);
});

test('content-columns-slide is archived: deprecated + not insertable, still renders', () => {
  const def = SLIDE_TYPES['content-columns-slide'];
  assert.ok(def, 'type stays registered so existing decks keep rendering');
  assert.equal(def.deprecated, true, 'marked deprecated (archive convention)');
  assert.equal(
    isInsertableSlideType({ type: 'content-columns-slide', def }),
    false,
    'hidden from every insertion path (picker + AI)'
  );
  // A stored content-columns slide still renders via the kept render-only path.
  const html = def.renderHtml(
    { title: 'Cols', columnCount: '2', col1Title: 'A', col2Title: 'B' },
    { type: 'content-columns-slide' },
    {}
  );
  assert.match(html, /class="slide/);
});

test('lead-capture-slide is parked: deprecated + not insertable, still renders', () => {
  // Parked (not superseded) pending the cookie-consent banner that would grant
  // the marketing consent its form is gated on. Uses the same deprecated
  // contract as the archived types: hidden from picker + AI, stored decks render.
  const def = SLIDE_TYPES['lead-capture-slide'];
  assert.ok(def, 'type stays registered so stored/forked decks keep rendering');
  assert.equal(def.deprecated, true, 'marked deprecated (parked pending cookie-consent)');
  assert.equal(
    isInsertableSlideType({ type: 'lead-capture-slide', def }),
    false,
    'hidden from every insertion path (picker + AI)'
  );
  // A stored lead-capture slide still renders via the kept render path.
  const html = def.renderHtml(
    { title: 'Stay in touch', thankYouTitle: 'Thanks', privacyText: 'I agree' },
    { id: 's1', type: 'lead-capture-slide' },
    {}
  );
  assert.match(html, /class="slide/);
  assert.match(html, /lead-capture-form/);
});

test('org-disabled types are not insertable', () => {
  assert.equal(
    isInsertableSlideType({
      type: 'poll-slide',
      def: { label: 'Poll' },
      disabledSlideTypes: ['poll-slide'],
    }),
    false
  );
});

test('custom-html requires the capability', () => {
  const def = { label: 'Custom HTML' };
  assert.equal(isInsertableSlideType({ type: 'custom-html-slide', def }), false);
  assert.equal(
    isInsertableSlideType({ type: 'custom-html-slide', def, canEditCustomHtml: true }),
    true
  );
});
