/**
 * DY-866: an image URL whose last segment is not valid percent-encoding
 * (`100%.png`) must not make the slide render throw. Without an alt text the
 * alt is inferred from that segment; one that does not decode is used raw.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { pickAltText } from '../shared/slide-types/helpers.js';

test('an undecodable segment gives the raw segment as alt', () => {
  assert.equal(pickAltText({ src: 'https://host.example/100%.png' }), '100%');
  assert.equal(
    pickAltText({ src: 'https://host.example/a/%E0%A4%A_b.jpg' }),
    '%E0%A4%A b',
  );
});

test('a segment that decodes still decodes', () => {
  assert.equal(
    pickAltText({ src: 'https://host.example/my%20photo_2.png' }),
    'My photo 2',
  );
});

test('an image slide with such a URL and no alt renders', () => {
  const html = renderSlideHtml({
    type: 'image-slide',
    id: 's1',
    content: { image: 'https://host.example/100%.png' },
  });
  assert.match(html, /alt="100%"/);
});
