/**
 * The deck import drops a content key the slide type does not declare, and it
 * asks the same predicate strict validation refuses against:
 * `declaredContentKeys()` in `shared/slide-types/declared-keys.js` (D121,
 * B257 B2). Before, `normalizeDeckSlide` let every unknown key through
 * "forward-compatible", which kept each retired key alive in every deck that
 * once carried it.
 *
 * Pinned here: what goes (an undeclared key), what stays (the four
 * declarations: fields incl. the global ones, instance keys, `textStyles`,
 * the derived contrast keys), that a legacy key the funnel folds arrives
 * folded rather than dropped, and that strict and the import read one list.
 *
 * Run with: node --test tests/deck-import-undeclared-keys.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deckToPresentationParts } from '../shared/slide-types/deck.js';
import { declaredContentKeys } from '../shared/slide-types/declared-keys.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { contentSchemaFor } from '../server/utils/ai/schemas/content-schema.js';

const importOne = (slide, options) =>
  deckToPresentationParts(
    { title: 'T', slides: [slide] },
    { slideTypes: SLIDE_TYPES, ...options },
  ).slides[0];

test('an undeclared key is dropped, the declared content is kept', () => {
  const slide = importOne({
    type: 'content-slide',
    content: {
      title: 'Kept',
      body: 'Also kept',
      retiredKey: 'nothing reads this',
      step1Body: 'a stray from another type',
    },
  });
  assert.equal(slide.content.title, 'Kept');
  assert.equal(slide.content.body, 'Also kept');
  assert.equal('retiredKey' in slide.content, false);
  assert.equal('step1Body' in slide.content, false);
});

test('global, derived and text-style keys survive the import', () => {
  const slide = importOne({
    type: 'content-slide',
    content: {
      title: 'T',
      a11yTitle: 'Announced',
      slideBgImage: '/uploads/bg.jpg',
      slideBgAutoFor: '/uploads/bg.jpg',
      slideBgTextAuto: 'light',
      slideBgNeedsScrim: true,
      textStyles: { title: { align: 'center' } },
    },
  });
  assert.equal(slide.content.a11yTitle, 'Announced');
  assert.equal(slide.content.slideBgImage, '/uploads/bg.jpg');
  assert.equal(slide.content.slideBgAutoFor, '/uploads/bg.jpg');
  assert.equal(slide.content.slideBgTextAuto, 'light');
  assert.equal(slide.content.slideBgNeedsScrim, true);
  assert.deepEqual(slide.content.textStyles, { title: { align: 'center' } });
});

test("an instance key and the invite's own form keys survive the import", () => {
  const poll = importOne({
    type: 'poll-slide',
    content: { question: 'Q?', pollId: 'poll-123' },
  });
  assert.equal(poll.content.pollId, 'poll-123');

  const invite = importOne({
    type: 'follow-invite-slide',
    content: {
      enabled: false,
      presentationId: 'p-1',
      customTitle: 'Join in',
      customBody: 'Scan the code',
    },
  });
  assert.equal(invite.content.enabled, false);
  assert.equal(invite.content.customTitle, 'Join in');
  assert.equal(invite.content.customBody, 'Scan the code');
});

test('a legacy key the funnel folds arrives under its current name', () => {
  const slide = importOne({
    type: 'title-slide',
    content: { title: 'T', bgImage: '/uploads/legacy.jpg', bgAlt: 'x' },
  });
  assert.equal(slide.content.slideBgImage, '/uploads/legacy.jpg');
  assert.equal('bgImage' in slide.content, false);
  assert.equal('bgAlt' in slide.content, false);
});

test('an uncomposed custom type keeps the global slide fields', () => {
  // A DB-record type (`toRuntimeSlideType()`) is not run through
  // `withGlobalSlideFields()`, yet renders the shared background layer.
  const custom = {
    label: 'Custom',
    fields: [{ key: 'headline', type: 'string', required: false }],
    defaults: {},
    renderHtml: () => '',
  };
  const slide = importOne(
    {
      type: 'my-custom',
      content: { headline: 'H', slideBgImage: '/uploads/a.jpg', junk: 1 },
    },
    { slideTypes: { ...SLIDE_TYPES, 'my-custom': custom } },
  );
  assert.equal(slide.content.headline, 'H');
  assert.equal(slide.content.slideBgImage, '/uploads/a.jpg');
  assert.equal('junk' in slide.content, false);
});

test('strict validation and the import read one list of declared keys', () => {
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    const strictKeys = Object.keys(contentSchemaFor(def).shape).sort();
    const importKeys = [...declaredContentKeys(def)].sort();
    assert.deepEqual(strictKeys, importKeys, name);
  }
});
