/**
 * The publish gate for pictures without a name (D137, B297): which pictures a
 * publish refuses, across language versions, hidden slides, items and an
 * organisation's own types. The route-level refusal (422 `missing_alt`, nothing
 * written) is pinned in `publish-convergence.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { SLIDE_TYPES } = await import('../shared/slide-types/registry.js');
const { findUnnamedImages, assertImagesNamed } =
  await import('../server/services/publish-alt-check.js');

const deck = (slides, extra = {}) => ({ id: 'd', slides, ...extra });

test('a content picture without alt is found; alt or decorative clears it', () => {
  const slides = [
    { id: 'a', type: 'image-slide', content: { image: '/x.png' } },
    { id: 'b', type: 'image-slide', content: { image: '/x.png', alt: 'A' } },
    {
      id: 'c',
      type: 'image-slide',
      content: { image: '/x.png', imageRole: 'decorative' },
    },
    { id: 'd', type: 'image-slide', content: { image: '' } },
  ];
  assert.deepEqual(findUnnamedImages(deck(slides), SLIDE_TYPES), [
    { lang: null, slideIndex: 0, slideId: 'a', field: 'image' },
  ]);
});

test('a caption is no alt: a gallery picture with only a caption is refused', () => {
  const slides = [
    {
      id: 'g',
      type: 'gallery-slide',
      content: {
        images: [
          { src: '/1.png', caption: 'Project Alpha', alt: '' },
          { src: '/2.png', caption: 'Project Beta', alt: 'Two people' },
        ],
      },
    },
  ];
  assert.deepEqual(findUnnamedImages(deck(slides), SLIDE_TYPES), [
    {
      lang: null,
      slideIndex: 0,
      slideId: 'g',
      field: 'images',
      itemIndex: 0,
      itemField: 'src',
    },
  ]);
});

test('an image set decorative as a whole needs no alt per picture', () => {
  const content = {
    images: [{ src: '/1.png' }, { src: '/2.png' }],
    imageRole: 'decorative',
  };
  const slides = [{ id: 's', type: 'image-set-slide', content }];
  assert.deepEqual(findUnnamedImages(deck(slides), SLIDE_TYPES), []);
  content.imageRole = 'content';
  assert.equal(findUnnamedImages(deck(slides), SLIDE_TYPES).length, 2);
});

test('a declared name or an item heading names the picture', () => {
  const slides = [
    {
      id: 'l',
      type: 'logo-wall-slide',
      content: { logos: [{ image: '/acme.png', name: 'Acme' }] },
    },
    {
      id: 't',
      type: 'team-cards-slide',
      content: { members: [{ image: '/ada.png', name: 'Ada', byline: 'CEO' }] },
    },
    {
      id: 'q',
      type: 'quote-slide',
      content: { quote: 'Hi', authorName: 'Grace', authorImage1: '/g.png' },
    },
    // A byline is a caption, not a name: a card with only that is refused.
    {
      id: 'u',
      type: 'team-cards-slide',
      content: { members: [{ image: '/x.png', name: '', byline: 'CTO' }] },
    },
  ];
  assert.deepEqual(
    findUnnamedImages(deck(slides), SLIDE_TYPES).map((m) => m.slideId),
    ['u'],
  );
});

test('slides a published page does not show are not checked', () => {
  const slides = [
    {
      id: 'h',
      type: 'image-slide',
      content: { image: '/x.png' },
      visibility: { hideInPublished: true },
    },
  ];
  assert.deepEqual(findUnnamedImages(deck(slides), SLIDE_TYPES), []);
});

test('every language version is checked, and says which', () => {
  const pres = deck([], {
    i18n: {
      versions: {
        nl: {
          slides: [
            {
              id: 'a',
              type: 'image-slide',
              content: { image: '/x.png', alt: 'Haven' },
            },
          ],
        },
        'en-GB': {
          slides: [
            { id: 'a', type: 'image-slide', content: { image: '/x.png' } },
          ],
        },
      },
    },
  });
  const found = findUnnamedImages(pres, SLIDE_TYPES);
  assert.equal(found.length, 1);
  assert.equal(found[0].slideId, 'a');
  assert.equal(found[0].lang, 'en-GB');
});

test("an organisation's own type is checked by its own declarations", () => {
  const registry = {
    ...SLIDE_TYPES,
    'acme-portrait': {
      name: 'acme-portrait',
      fields: [
        { key: 'photo', type: 'image' },
        { key: 'photoAlt', type: 'string' },
      ],
    },
  };
  const slides = [
    { id: 'p', type: 'acme-portrait', content: { photo: '/p.png' } },
  ];
  assert.deepEqual(
    findUnnamedImages(deck(slides), registry).map((m) => m.field),
    ['photo'],
  );
  slides[0].content.photoAlt = 'Our founder';
  assert.deepEqual(findUnnamedImages(deck(slides), registry), []);
});

test('the refusal names the first picture and counts the rest', () => {
  const slides = [
    { id: 'a', type: 'image-slide', content: { title: 'x', image: '/x.png' } },
    { id: 'b', type: 'image-slide', content: { title: 'y', image: '/y.png' } },
  ];
  assert.throws(
    () => assertImagesNamed(deck(slides), SLIDE_TYPES),
    (err) => {
      assert.equal(err.code, 'missing_alt');
      assert.equal(err.statusCode, 422);
      assert.deepEqual(err.toJSON().details, {
        lang: null,
        slideIndex: 0,
        slideId: 'a',
        field: 'image',
        count: 2,
      });
      assert.match(err.message, /Slide 1 .*1 more need one too\./);
      return true;
    },
  );
});
