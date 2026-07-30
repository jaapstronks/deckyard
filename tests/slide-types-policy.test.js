import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInsertableSlideType } from '../client/views/editor/slide-types-policy.js';
import { SLIDE_TYPES, renderSlideHtml } from '../shared/slide-types.js';

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

test('split-partner-title-slide is removed: off the registry, and a stored slide degrades safely', () => {
  // Removed as the A7.1 KPI measurement closing the slide-type-seam done-gate:
  // `deprecated: true` was a waypoint, not an end state. No successor — the
  // "two partner logos side by side" use case may return as reusable editorial
  // components rather than a bespoke type.
  assert.equal(SLIDE_TYPES['split-partner-title-slide'], undefined, 'no longer registered');
  // A deck that still carries one degrades to the archived-slide placeholder,
  // which names the type and keeps its content visible rather than throwing.
  const html = renderSlideHtml({
    type: 'split-partner-title-slide',
    content: { title: 'Old partners' },
  });
  assert.match(html, /class="slide/);
  assert.match(html, /slide-unresolved/);
  assert.match(html, /split-partner-title-slide/);
  assert.match(html, /Old partners/);
});

test('freeform-slide is removed: off the registry, and a stored slide degrades safely', () => {
  // The last rung of the deprecation ladder: `deprecated: true` (out of picker
  // + AI, render-only) was a waypoint, not an end state. The freeform canvas
  // was retired as an authoring surface, no deck used it, so the type is gone
  // rather than carried forever as an exception every refactor must route
  // around. Re-adding it needs a product decision, not an import.
  assert.equal(SLIDE_TYPES['freeform-slide'], undefined, 'no longer registered');
  // A deck that still carries one does not blow up: renderSlideHtml falls back
  // to the archived-slide placeholder, which names the type rather than
  // throwing, emitting nothing, or saying only "unknown".
  const html = renderSlideHtml({ type: 'freeform-slide', content: { title: 'Old canvas' } });
  assert.match(html, /class="slide/);
  assert.match(html, /slide-unresolved/);
  assert.match(html, /freeform-slide/);
  assert.match(html, /Old canvas/);
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
