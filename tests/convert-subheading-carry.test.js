import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  convertSlideToType,
  getConversionLossyKeys,
} from '../shared/slide-types/convert.js';

/**
 * Two conversion branches carry a subheading across, and both read the
 * pre-rename `subtitle` spelling until the v9 -> v10 fold made that key
 * unreachable — so both silently dropped the field instead. These tests pin
 * the carry on the canonical key, and the lossy-warning contract that goes
 * with it (a key that travels must not warn; one that is dropped must).
 */

const slide = (type, content) => ({
  id: `slide-${type}`,
  type,
  content: { ...structuredClone(SLIDE_TYPES[type].defaults), ...content },
});

test('list -> content carries the subheading as itself, not as a body line', () => {
  const next = convertSlideToType(
    slide('list-slide', {
      title: 'Agenda',
      subheading: 'Wat we vandaag doen',
      items: [{ title: 'Intro' }, { title: 'Demo', text: 'live' }],
    }),
    'content-slide',
  );
  assert.equal(next.content.subheading, 'Wat we vandaag doen');
  assert.equal(next.content.body, '- Intro\n- Demo\nlive');
  // Both types declare `subheading`, so the seam must not warn about it.
  const lossy = getConversionLossyKeys(
    slide('list-slide', { subheading: 'Wat we vandaag doen' }),
    'content-slide',
  );
  assert.equal(lossy.includes('subheading'), false);
});

test('image -> image-text folds the subheading into title/body and stays quiet', () => {
  // image-text has no subheading field, so the value moves into the body (and
  // seeds the required title when nothing better is there).
  const next = convertSlideToType(
    slide('image-slide', { subheading: 'Onze cijfers', image: '/x.png' }),
    'image-text-slide',
  );
  assert.equal(next.content.title, 'Onze cijfers');
  assert.equal(next.content.body, 'Onze cijfers');
  assert.equal('subheading' in next.content, false);
  // It travels, so it is consumed rather than reported as data loss. (Neither
  // list is asserted empty: source types whose OWN defaults are non-empty
  // (`zoomLevel`, `headerAlign`) warn on every conversion — pre-existing noise
  // of the kind the image-text entry in CONSUMED_SOURCE_KEYS documents, and
  // not this seam's concern.)
  const lossy = getConversionLossyKeys(
    slide('image-slide', { subheading: 'Onze cijfers', image: '/x.png' }),
    'image-text-slide',
  );
  assert.equal(lossy.includes('subheading'), false);
});

test('image -> image-text prefers a real title over the subheading', () => {
  const next = convertSlideToType(
    slide('image-slide', {
      title: 'Kwartaalcijfers',
      subheading: 'Onze cijfers',
      image: '/x.png',
    }),
    'image-text-slide',
  );
  assert.equal(next.content.title, 'Kwartaalcijfers');
  assert.equal(next.content.body, 'Onze cijfers');
});

test('image-slide alt text falls back to the subheading', () => {
  const html = SLIDE_TYPES['image-slide'].renderHtml({
    image: '/x.png',
    subheading: 'Twee collegas achter een laptop',
  });
  assert.match(html, /alt="Twee collegas achter een laptop"/);
});
