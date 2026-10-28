/**
 * Incomplete slides (B590): one predicate for "an essential picture is still
 * empty", asked through the visibility seam, so every output leaves the slide
 * out while the editor keeps it.
 *
 * This file pins the predicate, the seam, the export and audience filters
 * (every language version, jumps pinned first), the thumbnail and presenter
 * selection, the editor's notice numbers, the publish numbers and the MCP
 * preview mark. Route-level proofs live beside their routes:
 * `incomplete-slides-outputs.test.js` (every export and read route) and
 * `publish-convergence.test.js` (the 422).
 *
 * Run with: node --test tests/incomplete-slides.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { SLIDE_TYPES } = await import('../shared/slide-types/registry.js');
const { isSlideIncomplete, findIncompleteSlides } =
  await import('../shared/incomplete-slides.js');
const { isSlideVisibleIn, filterSlidesForContext } =
  await import('../shared/slide-visibility.js');
const { filterForExport, projectPresentationForAudience, firstPublicSlide } =
  await import('../server/utils/public-output.js');
const { thumbnailSlide, firstSlideSignature } =
  await import('../server/render/deck-thumbnail.js');
const { filterPresentSlides } =
  await import('../client/views/presenter/deck-controller.js');
const { incompletePublishedSlideNumbers } =
  await import('../server/services/publish-complete-check.js');
const { buildSlidePreviewHtml, buildSingleSlidePreviewHtml } =
  await import('../server/mcp/preview.js');

const slide = (id, type, content = {}, extra = {}) => ({
  id,
  type,
  content,
  ...extra,
});
const incomplete = (s, types) => isSlideIncomplete(s, types);

test('image-slide and image-text-slide: an empty essential image is incomplete', () => {
  for (const type of ['image-slide', 'image-text-slide']) {
    assert.equal(incomplete(slide('a', type, {})), true, `${type} absent`);
    assert.equal(incomplete(slide('a', type, { image: '' })), true, type);
    assert.equal(incomplete(slide('a', type, { image: '   ' })), true, type);
    assert.equal(
      incomplete(slide('a', type, { image: '/uploads/x.png' })),
      false,
      `${type} filled`,
    );
  }
});

test('gallery and image set: the first picture decides (D211), later ones are optional', () => {
  for (const [type, key] of [
    ['gallery-slide', 'src'],
    ['image-set-slide', 'src'],
  ]) {
    assert.equal(incomplete(slide('g', type, {})), true, `${type} no list`);
    assert.equal(incomplete(slide('g', type, { images: [] })), true, type);
    assert.equal(
      incomplete(slide('g', type, { images: [{ [key]: '', alt: 'x' }] })),
      true,
      `${type} first empty`,
    );
    assert.equal(
      incomplete(
        slide('g', type, { images: [{ [key]: '/1.png' }, { [key]: '' }] }),
      ),
      false,
      `${type} first filled, second empty`,
    );
  }
});

test('a list whose item is more than a picture is not judged: logos and team members', () => {
  assert.equal(
    incomplete(slide('l', 'logo-wall-slide', { logos: [{ name: 'Acme' }] })),
    false,
  );
  assert.equal(
    incomplete(
      slide('t', 'team-cards-slide', { members: [{ name: 'Ada', image: '' }] }),
    ),
    false,
  );
  assert.equal(incomplete(slide('q', 'quote-slide', { quote: 'Hi' })), false);
});

test('only pictures count: an empty essential text field is no incompleteness', () => {
  assert.equal(incomplete(slide('c', 'content-slide', {})), false);
  assert.equal(incomplete(slide('t', 'title-slide', {})), false);
});

test("an organisation's own type is judged by its own declarations, a field it does not draw is not", () => {
  const registry = {
    ...SLIDE_TYPES,
    'acme-hero': {
      name: 'acme-hero',
      fields: [
        { key: 'mode', type: 'enum', options: ['photo', 'text'] },
        {
          key: 'photo',
          type: 'image',
          essential: true,
          visibleWhen: { field: 'mode', in: ['photo'] },
        },
      ],
      defaults: { mode: 'photo' },
    },
  };
  const hero = (content) => slide('h', 'acme-hero', content);
  assert.equal(incomplete(hero({}), registry), true);
  assert.equal(incomplete(hero({ photo: '/p.png' }), registry), false);
  assert.equal(incomplete(hero({ mode: 'text' }), registry), false);
  // Without the organisation's registry there is nothing to ask.
  assert.equal(incomplete(hero({})), false);
  assert.equal(incomplete(hero({}), null), false);
});

test('the seam: every output context leaves it out, only an editor keeps it', () => {
  const s = slide('a', 'image-slide', { image: '' });
  for (const context of ['presentation', 'export', 'published'])
    assert.equal(isSlideVisibleIn(s, context), false, context);
  assert.equal(
    isSlideVisibleIn(s, 'viewer', { userPermission: 'read' }),
    false,
  );
  assert.equal(
    isSlideVisibleIn(s, 'viewer', { userPermission: 'write' }),
    true,
  );
  assert.equal(isSlideVisibleIn(s, 'viewer'), true);
  const filled = slide('b', 'image-slide', { image: '/x.png' });
  for (const context of ['presentation', 'export', 'published'])
    assert.equal(isSlideVisibleIn(filled, context), true, context);
  assert.deepEqual(
    filterSlidesForContext([s, filled], 'presentation').map((x) => x.id),
    ['b'],
  );
});

/** A two-language deck: an incomplete slide, an export-hidden one, and one
 *  slide incomplete only in the German version. A link jumps to slide 4. */
function deck() {
  const list = (lang) => [
    slide('first', 'content-slide', {
      title: `First ${lang}`,
      actions: [{ label: 'Go', url: '#4' }],
    }),
    slide('empty', 'image-slide', { image: '' }),
    slide(
      'hidden',
      'content-slide',
      { title: 'Hidden' },
      {
        visibility: { hideInExport: true },
      },
    ),
    slide('target', 'image-slide', {
      image: lang === 'de' ? '' : '/t.png',
      alt: 'Target',
    }),
  ];
  return {
    id: 'deck',
    slides: list('nl'),
    i18n: {
      dominant: 'nl',
      versions: {
        nl: { title: 'nl', slides: list('nl') },
        de: { title: 'de', slides: list('de') },
      },
    },
  };
}

test('filterForExport: every language version, jumps pinned before the filter', () => {
  const out = filterForExport(deck());
  assert.deepEqual(
    out.slides.map((s) => s.id),
    ['first', 'target'],
  );
  assert.deepEqual(
    out.i18n.versions.nl.slides.map((s) => s.id),
    ['first', 'target'],
  );
  assert.deepEqual(
    out.i18n.versions.de.slides.map((s) => s.id),
    ['first'],
  );
  // `#4` named the target in the stored order; after the filter it is slide 2.
  assert.equal(out.slides[0].content.actions[0].url, '#slide:target');
  // Nothing dropped, nothing touched.
  const complete = { slides: [slide('a', 'content-slide', { title: 'A' })] };
  assert.equal(filterForExport(complete), complete);
});

test('every reader channel leaves it out; the author projection keeps it', () => {
  for (const channel of ['viewer', 'share', 'follow', 'published']) {
    const out = projectPresentationForAudience(deck(), {
      audience: 'reader',
      channel,
    });
    assert.ok(
      !out.slides.some((s) => s.id === 'empty'),
      `${channel}: main list`,
    );
    assert.ok(
      !out.i18n.versions.de.slides.some((s) => s.id === 'target'),
      `${channel}: de-only incomplete`,
    );
    assert.ok(out.i18n.versions.nl.slides.some((s) => s.id === 'target'));
  }
  const author = projectPresentationForAudience(deck(), {
    audience: 'author',
    channel: 'viewer',
  });
  assert.ok(author.slides.some((s) => s.id === 'empty'));
});

test('OG and thumbnail take the first slide an audience sees', () => {
  const pres = {
    id: 'deck',
    slides: [
      slide('empty', 'image-slide', { image: '' }),
      slide(
        'draft',
        'content-slide',
        { title: 'D' },
        {
          visibility: { hideInPresentation: true, hideInPublished: true },
        },
      ),
      slide('real', 'content-slide', { title: 'Real' }),
    ],
  };
  assert.equal(firstPublicSlide(pres, { channel: 'published' }).id, 'real');
  assert.equal(thumbnailSlide(pres).id, 'real');
  assert.notEqual(
    firstSlideSignature(pres),
    firstSlideSignature({ slides: [pres.slides[0]] }),
  );
  assert.equal(thumbnailSlide({ slides: [pres.slides[0]] }), null);
});

test('the presenter filter skips it, with the organisation registry when given', () => {
  const registry = {
    ...SLIDE_TYPES,
    'acme-photo': {
      name: 'acme-photo',
      fields: [{ key: 'photo', type: 'image', essential: true }],
    },
  };
  const pres = {
    slides: [
      slide('a', 'content-slide', { title: 'A' }),
      slide('b', 'image-slide', {}),
      slide('c', 'acme-photo', {}),
    ],
  };
  assert.deepEqual(
    filterPresentSlides(pres).map((s) => s.id),
    ['a', 'c'],
  );
  assert.deepEqual(
    filterPresentSlides(pres, registry).map((s) => s.id),
    ['a'],
  );
});

test('findIncompleteSlides reads each language version; publish numbers skip slides the page hides', () => {
  const pres = deck();
  assert.deepEqual(
    findIncompleteSlides(pres, SLIDE_TYPES).map((h) => [h.lang, h.slideId]),
    [
      ['nl', 'empty'],
      ['de', 'empty'],
      ['de', 'target'],
    ],
  );
  assert.deepEqual(incompletePublishedSlideNumbers(pres, SLIDE_TYPES), [2, 4]);
  pres.i18n.versions.de.slides[3].visibility = { hideInPublished: true };
  assert.deepEqual(incompletePublishedSlideNumbers(pres, SLIDE_TYPES), [2]);
});

test('the MCP previews mark it and keep every slide, so indices still address the stored list', async () => {
  const slides = [
    slide('a', 'content-slide', { title: 'A' }),
    slide('b', 'image-slide', { image: '' }),
  ];
  const list = await buildSlidePreviewHtml(slides, {
    isIncomplete: (s) => isSlideIncomplete(s),
  });
  assert.equal(list.match(/class="preview-item"/g).length, 2);
  assert.equal(list.match(/data-incomplete="true"/g).length, 1);
  assert.ok(
    list.indexOf('data-incomplete') > list.indexOf('2. image-slide'),
    'the mark sits with slide 2',
  );
  const single = await buildSingleSlidePreviewHtml(slides[1], {
    incomplete: true,
  });
  assert.match(single, /data-incomplete="true"/);
  const plain = await buildSingleSlidePreviewHtml(slides[0]);
  assert.doesNotMatch(plain, /data-incomplete/);
});
