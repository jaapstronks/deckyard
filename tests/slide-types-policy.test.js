import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInsertableSlideType } from '../client/views/editor/slide-types-policy.js';

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
