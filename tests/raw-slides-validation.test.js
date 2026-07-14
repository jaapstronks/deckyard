/**
 * Tests for the strict raw-slide validator used by
 * create_presentation_from_slides.
 *
 * Run with: node --test tests/raw-slides-validation.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  validateRefinedSlidesStrict,
  diffAppliedFixes,
  validateAndFixRefinedSlides,
  RawSlideValidationError,
} from '../server/utils/ai/validate-slides.js';

describe('validateRefinedSlidesStrict', () => {
  it('accepts a valid title + team-cards deck', () => {
    const slides = [
      { type: 'title-slide', content: { title: 'Hello' } },
      {
        type: 'team-cards-slide',
        content: {
          title: 'Team',
          members: [
            { name: 'Alice', byline: 'Lead' },
            { name: 'Bob', byline: 'Dev' },
          ],
        },
      },
    ];
    assert.doesNotThrow(() => validateRefinedSlidesStrict(slides));
  });

  it('rejects unknown slide type with structured detail', () => {
    try {
      validateRefinedSlidesStrict([{ type: 'not-a-real-slide', content: {} }]);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof RawSlideValidationError);
      assert.strictEqual(err.details.slideIndex, 0);
      assert.strictEqual(err.details.field, 'type');
    }
  });

  it('rejects empty items[] on list-slide with minItems detail', () => {
    try {
      validateRefinedSlidesStrict([
        { type: 'title-slide', content: { title: 'x' } },
        { type: 'list-slide', content: { title: 'List', items: [] } },
      ]);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof RawSlideValidationError);
      assert.strictEqual(err.details.slideIndex, 1);
      assert.strictEqual(err.details.slideType, 'list-slide');
      assert.strictEqual(err.details.field, 'items');
      assert.match(err.details.expected, /minItems/);
    }
  });

  it('rejects empty slides array', () => {
    assert.throws(
      () => validateRefinedSlidesStrict([]),
      (err) => err instanceof RawSlideValidationError && err.details.field === 'slides'
    );
  });

  it('rejects overlong title with maxLength detail', () => {
    const longTitle = 'x'.repeat(500);
    try {
      validateRefinedSlidesStrict([{ type: 'title-slide', content: { title: longTitle } }]);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof RawSlideValidationError);
      assert.strictEqual(err.details.field, 'title');
      assert.match(err.details.expected, /maxLength/);
      assert.strictEqual(err.details.got, 500);
    }
  });
});

describe('diffAppliedFixes', () => {
  it('reports truncation on overlong title', () => {
    const input = [{ type: 'title-slide', content: { title: 'x'.repeat(500) } }];
    const fixed = validateAndFixRefinedSlides(
      input.map((s) => ({ type: s.type, content: s.content }))
    );
    const fixes = diffAppliedFixes(input, fixed);
    const titleFix = fixes.find((f) => f.field === 'title');
    assert.ok(titleFix, 'expected a title fix');
    assert.match(titleFix.change, /truncated/);
  });

  it('reports layout switch on 5+ list items', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      title: `Item ${i + 1}`,
      text: 'short',
    }));
    const input = [{ type: 'list-slide', content: { title: 'L', items, layout: 'one-column' } }];
    const fixed = validateAndFixRefinedSlides(
      input.map((s) => ({ type: s.type, content: s.content }))
    );
    const fixes = diffAppliedFixes(input, fixed);
    assert.ok(fixes.some((f) => f.field === 'layout'), 'expected a layout fix');
  });

  it('returns empty array when nothing changed', () => {
    const input = [
      { type: 'title-slide', content: { title: 'Hello' } },
    ];
    const fixed = validateAndFixRefinedSlides(
      input.map((s) => ({ type: s.type, content: s.content }))
    );
    const fixes = diffAppliedFixes(input, fixed);
    assert.deepStrictEqual(fixes, []);
  });
});
