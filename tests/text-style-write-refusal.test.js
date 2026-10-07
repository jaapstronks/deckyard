/**
 * The write seam refuses a text style the slide's type does not offer
 * (B464, D220, D221): a per-instance key, any colour, an unoffered key or
 * property. Refused rather than pruned, so the writer learns the style did not
 * land; `details` names the slide and the `text_style_*` sub-code, the message
 * names the key and why.
 *
 * Run with: node --test tests/text-style-write-refusal.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSlides } from '../server/storage/presentations/slides.js';
import { assertErrorDetails } from '../server/utils/error-details.js';

function refusal(slides) {
  try {
    normalizeSlides(slides);
  } catch (err) {
    return err;
  }
  return null;
}

const content = (textStyles) => ({ title: 'T', body: 'B', textStyles });

test('an offered style passes and is stored as sent', () => {
  const [slide] = normalizeSlides([
    {
      type: 'content-slide',
      content: content({ body: { align: 'center', size: 'lg' } }),
    },
  ]);
  assert.deepEqual(slide.content.textStyles, {
    body: { align: 'center', size: 'lg' },
  });
});

test('a per-instance key on Image blocks is a 400 naming the key', () => {
  const err = refusal([
    { type: 'content-slide', content: content({}) },
    {
      type: 'team-cards-slide',
      content: {
        members: [],
        textStyles: { 'members.3.name': { size: 'lg' } },
      },
    },
  ]);
  assert.equal(err?.status ?? err?.statusCode, 400);
  assert.equal(err.code, 'invalid');
  assert.deepEqual(err.details, {
    field: 'slides',
    index: 1,
    reason: 'text_style_not_offered',
  });
  assert.match(err.message, /slides\[1\]/);
  assert.match(err.message, /"members\.3\.name"/);
  // The register accepts the shape on the wire.
  assertErrorDetails(err.code, err.details);
});

test('one quote of several is refused as per instance', () => {
  const err = refusal([
    {
      type: 'quote-slide',
      content: {
        quotes: [{ quote: 'a' }, { quote: 'b' }],
        textStyles: { 'quotes.1.quote': { size: 'lg' } },
      },
    },
  ]);
  assert.equal(err?.details?.reason, 'text_style_per_instance');
  assert.match(err.message, /"quotes\.\*\.quote"/);
});

test('any colour is refused, naming D221', () => {
  const err = refusal([
    { type: 'content-slide', content: content({ body: { color: 'accent' } }) },
  ]);
  assert.equal(err?.details?.reason, 'text_style_property_not_offered');
  assert.match(err.message, /colour was removed/);
});

test('a style on a field the type does not offer is refused', () => {
  const err = refusal([
    {
      type: 'content-slide',
      content: content({ subheading: { size: 'lg' } }),
    },
  ]);
  assert.equal(err?.details?.reason, 'text_style_not_offered');
  assert.match(err.message, /"subheading"/);
});
