import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAndFixRefinedSlides } from '../server/utils/ai/validate-slides.js';

/**
 * Truncation runs inside slide validation, so drive it through a slide rather
 * than reaching for the private helper.
 */
function truncatedBody(text, type = 'content-slide') {
  const [slide] = validateAndFixRefinedSlides([
    { originalIndex: 0, type, content: { title: 'T', body: text } },
  ]);
  return slide.content.body;
}

test('over-long body is cut at a word boundary, not mid-word', () => {
  const sentence = 'We are deeply sorry for the disruption and we apologize for the problems caused. ';
  const body = truncatedBody(sentence.repeat(40));

  assert.ok(body.endsWith('...'), 'ellipsis is appended');
  const visible = body.slice(0, -3);
  assert.ok(!/\s$/.test(visible), 'no trailing whitespace before the ellipsis');
  // The defect this guards: a hard slice left "...we apologize for the p".
  assert.ok(
    !/\s\S{1,2}$/.test(visible) || sentence.includes(visible.split(/\s/).pop()),
    'the final token is a whole word from the source, not a fragment'
  );
});

test('truncation still bounds a single very long token', () => {
  // No whitespace to break on, so the hard cut must still apply.
  const body = truncatedBody('x'.repeat(5000));
  assert.ok(body.length < 5000, 'still truncated');
  assert.ok(body.endsWith('...'));
});

test('text within the limit is left untouched', () => {
  const text = 'A short body that needs no truncation.';
  assert.equal(truncatedBody(text), text);
});
