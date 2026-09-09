import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  resolveImageSetCell,
  IMAGE_SET_IMAGE_DEFAULTS,
} from '../shared/slide-types/types/image-set-slide/images.js';
import {
  resolveImageTextImage,
  IMAGE_TEXT_IMAGE_DEFAULTS,
} from '../shared/slide-types/types/image-text-slide/image.js';
import {
  convertSlideToType,
  getConversionLossyKeys,
} from '../shared/slide-types/convert.js';

/**
 * The write -> render -> re-read round-trip over an ImageRef, on both types
 * that own one: image-set's `images[i]` and image-text's flat `image`/`alt`/
 * `fit`/`focusX`/`focusY`.
 *
 * The harness pins a whole class of baseline / stale-read bugs at once: the
 * value a user writes on the single write seam must appear in the render AND be
 * re-read identically by both editor read seams - the resolver (canvas focal
 * drag + render) and the raw stored value (what the inspector's focus grid
 * seeds from). If any surface drifts, one of these assertions fails. The
 * display-baseline bug was exactly this: the grid seeded from the raw record
 * while the render used a slide-level fallback, so the grid showed the wrong
 * crop start. Neither type has such a fallback any more (D100), which is what
 * the second half of this file - the convert seam - keeps true across a type
 * switch.
 */

const SET = SLIDE_TYPES['image-set-slide'];
const TEXT = SLIDE_TYPES['image-text-slide'];

const setContent = (content = {}) => ({
  ...structuredClone(SET.defaults),
  ...content,
});
const textContent = (content = {}) => ({
  ...structuredClone(TEXT.defaults),
  ...content,
});

// ---- image-set: write on images[i] -> render + both read seams agree ------

/**
 * Each ImageRef field: a distinctive value, how it shows up in the render, and
 * how each read seam reports it. `reRead` returns [resolveValue, rawItemValue];
 * both must equal the written value (the two must never disagree).
 */
const SET_IMAGE_REF_FIELDS = [
  {
    key: 'src',
    value: '/round-trip-src.png',
    inRender: (html, v) =>
      html.includes(`src="${v}"`) && html.includes('data-inline-photo="0"'),
    reRead: (content) => [
      resolveImageSetCell(content, 0).item.src,
      content.images[0].src,
    ],
  },
  {
    key: 'alt',
    value: 'A precise description',
    inRender: (html, v) => html.includes(`alt="${v}"`),
    reRead: (content) => [
      resolveImageSetCell(content, 0).altExplicit,
      content.images[0].alt,
    ],
  },
  {
    key: 'fit',
    value: 'contain',
    inRender: (html) => /frame is-fit-contain/.test(html),
    reRead: (content) => [
      resolveImageSetCell(content, 0).fit,
      content.images[0].fit,
    ],
  },
  {
    key: 'focusX',
    value: 30,
    // Focus needs both axes to render a deterministic object-position; the
    // fixture sets focusY too, so assert the X we vary lands as the first %.
    inRender: (html) => /object-position:30% \d+%/.test(html),
    reRead: (content) => [
      resolveImageSetCell(content, 0).focusSource.focusX,
      content.images[0].focusX,
    ],
  },
  {
    key: 'focusY',
    value: 80,
    inRender: (html) => /object-position:\d+% 80%/.test(html),
    reRead: (content) => [
      resolveImageSetCell(content, 0).focusSource.focusY,
      content.images[0].focusY,
    ],
  },
];

for (const field of SET_IMAGE_REF_FIELDS) {
  test(`round-trip: image-set images[0].${field.key} - write reflects in render and both read seams`, () => {
    const content = setContent({
      images: [
        { src: '/base.png', alt: '', focusX: 50, focusY: 50 },
        { src: '/second.png' },
      ],
    });
    // Write on the single seam.
    content.images[0][field.key] = field.value;
    // Render reflects it.
    assert.ok(
      field.inRender(SET.renderHtml(content), field.value),
      `render reflects images[0].${field.key} = ${field.value}`,
    );
    // Both editor read seams re-read the same value.
    const [resolved, rawItem] = field.reRead(content);
    assert.equal(
      resolved,
      field.value,
      `resolveImageSetCell re-reads ${field.key}`,
    );
    assert.equal(
      rawItem,
      field.value,
      `the raw item (grid seed) re-reads ${field.key}`,
    );
    assert.equal(
      resolved,
      rawItem,
      `${field.key}: the two read seams agree (no drift)`,
    );
  });
}

/**
 * The same harness on image-text's flat ImageRef. The read seams here are the
 * resolver and the raw content key.
 */
const TEXT_IMAGE_REF_FIELDS = [
  {
    key: 'image',
    value: '/round-trip-src.png',
    resolved: 'src',
    inRender: (html, v) =>
      html.includes(`src="${v}"`) && html.includes('data-inline-photo="0"'),
  },
  {
    key: 'alt',
    value: 'A precise description',
    resolved: 'alt',
    inRender: (html, v) => html.includes(`alt="${v}"`),
  },
  {
    key: 'fit',
    value: 'contain',
    resolved: 'fit',
    inRender: (html) => /frame is-fit-contain/.test(html),
  },
  {
    key: 'focusX',
    value: 30,
    resolved: 'focusX',
    inRender: (html) => /object-position:30% \d+%/.test(html),
  },
  {
    key: 'focusY',
    value: 80,
    resolved: 'focusY',
    inRender: (html) => /object-position:\d+% 80%/.test(html),
  },
];

for (const field of TEXT_IMAGE_REF_FIELDS) {
  test(`round-trip: image-text ${field.key} - write reflects in render and both read seams`, () => {
    const content = textContent({
      image: '/base.png',
      focusX: 50,
      focusY: 50,
    });
    content[field.key] = field.value;
    assert.ok(
      field.inRender(TEXT.renderHtml(content), field.value),
      `render reflects ${field.key} = ${field.value}`,
    );
    assert.equal(
      resolveImageTextImage(content)[field.resolved],
      field.value,
      `resolveImageTextImage re-reads ${field.key}`,
    );
    assert.equal(
      content[field.key],
      field.value,
      `the raw content (grid seed) re-reads ${field.key}`,
    );
  });
}

test('round-trip: an empty focus resolves to the type default focus (config, 50/50)', () => {
  // The renderer emits no object-position for an empty focus; the effective
  // crop point is the type default, so the config anchor states it explicitly.
  assert.equal(
    resolveImageSetCell(setContent({ images: [{ src: '/a.png' }] }), 0)
      .focusSource.focusX,
    '',
  );
  assert.equal(resolveImageTextImage(textContent()).focusX, '');
  for (const defaults of [
    IMAGE_SET_IMAGE_DEFAULTS,
    IMAGE_TEXT_IMAGE_DEFAULTS,
  ]) {
    assert.equal(defaults.focus.x, 50);
    assert.equal(defaults.focus.y, 50);
  }
});

// ---- Fit class snapshots: the unified, frame-based mechanism --------------

/**
 * There is ONE fit mechanism: every frame carries its *effective* fit as an
 * is-fit-* class (item/slide override -> type default), and no container-level
 * is-image-cover/contain class exists. Because the emitted HTML no longer
 * distinguishes where the fit came from, a data move between the two types is
 * render-neutral by construction. These snapshots pin that contract: a
 * container fit class reappearing, or a frame rendering without an explicit fit
 * class, is a regression toward the old two-mechanism split.
 */
const fitClasses = (def, content) => {
  const html = def.renderHtml(content);
  const container = (html.match(/is-image-(?:cover|contain)/g) || []).slice(
    0,
    1,
  );
  const frames = html.match(/frame(?: is-fit-(?:cover|contain))?/g) || [];
  return { container: container[0] || null, frames };
};

test('fit class snapshot: image-text rides the frame, no container class', () => {
  assert.deepEqual(
    fitClasses(TEXT, textContent({ image: '/a.png', fit: 'contain' })),
    { container: null, frames: ['frame is-fit-contain'] },
  );
  assert.deepEqual(
    fitClasses(TEXT, textContent({ image: '/a.png', fit: 'cover' })),
    { container: null, frames: ['frame is-fit-cover'] },
  );
  // An absent fit resolves to the type default and still renders explicitly:
  // the render never betrays whether the value was stored or defaulted.
  assert.deepEqual(fitClasses(TEXT, textContent({ image: '/a.png' })), {
    container: null,
    frames: ['frame is-fit-cover'],
  });
});

test('fit class snapshot: each image-set frame carries its own effective fit', () => {
  assert.deepEqual(
    fitClasses(
      SET,
      setContent({
        images: [
          { src: '/a.png', fit: 'contain' },
          { src: '/b.png', fit: 'contain' },
        ],
      }),
    ),
    {
      container: null,
      frames: ['frame is-fit-contain', 'frame is-fit-contain'],
    },
  );
  assert.deepEqual(
    fitClasses(
      SET,
      setContent({
        images: [{ src: '/a.png', fit: 'contain' }, { src: '/b.png' }],
      }),
    ),
    { container: null, frames: ['frame is-fit-contain', 'frame is-fit-cover'] },
  );
});

// ---- The convert seam: an ImageRef survives a type switch -----------------

const slideOf = (type, content = {}) => ({
  id: 's1',
  type,
  notes: '',
  content: { ...structuredClone(SLIDE_TYPES[type].defaults), ...content },
});

test('convert: image-slide -> image-text writes the flat keys, not a collection', () => {
  const next = convertSlideToType(
    slideOf('image-slide', {
      image: '/photo.png',
      alt: 'A photo',
      focusX: 25,
      focusY: 75,
      title: 'T',
    }),
    'image-text-slide',
    { lang: 'nl' },
  );
  assert.equal(next.content.image, '/photo.png');
  assert.equal(next.content.alt, 'A photo');
  assert.equal(next.content.focusX, 25);
  assert.equal(next.content.focusY, 75);
  assert.equal(next.content.images, undefined, 'no images[] on a singleton');
  // full/bleed map to cover = the type default, so no fit is written (empty
  // keeps meaning "follow the type").
  assert.equal(next.content.fit ?? '', '');
});

test('convert: a centered image-slide lands as an explicit contain', () => {
  const next = convertSlideToType(
    slideOf('image-slide', {
      image: '/diagram.png',
      layout: 'centered',
      title: 'T',
    }),
    'image-text-slide',
    { lang: 'nl' },
  );
  assert.equal(next.content.fit, 'contain');
});

test('convert: the deliberate drops stay quiet — bleed and the subheading', () => {
  // image-text renders no edge-to-edge frame and has no subheading field. Both
  // are declared consumed, so the seam does not warn about them: a warning
  // means content is lost, and neither ever had a home here (D100). What
  // happens to the values themselves is pinned in
  // tests/image-slide-fit-bleed.test.js.
  const src = slideOf('image-slide', {
    image: '/photo.png',
    bleed: true,
    subheading: 'Sub',
    title: 'T',
  });
  const lossy = getConversionLossyKeys(src, 'image-text-slide');
  assert.ok(!lossy.includes('bleed'));
  assert.ok(!lossy.includes('subheading'));
});

test('convert: image-text -> image-set moves the flat ImageRef into images[0]', () => {
  const src = slideOf('image-text-slide', {
    image: '/a.png',
    alt: 'Own alt',
    fit: 'contain',
    focusX: 10,
    focusY: 90,
    caption: 'Cap',
    imageSide: 'right',
    imageWidth: 'wide',
  });
  const next = convertSlideToType(src, 'image-set-slide', { lang: 'nl' });
  assert.deepEqual(next.content.images[0], {
    src: '/a.png',
    alt: 'Own alt',
    fit: 'contain',
    focusX: 10,
    focusY: 90,
  });
  // A set holds at least two, so the second cell is opened empty.
  assert.equal(next.content.images.length, 2);
  assert.equal(next.content.images[1].src, '');
  // The image AREA scalars mean the same on both types and travel as themselves.
  assert.equal(next.content.caption, 'Cap');
  assert.equal(next.content.imageSide, 'right');
  assert.equal(next.content.imageWidth, 'wide');
  // Nothing of the flat spelling is left behind to be read twice.
  assert.equal(next.content.image, undefined);
  assert.equal(next.content.fit, undefined);
});

test('convert: image-text -> image-set writes no fit when it equals the type default', () => {
  const next = convertSlideToType(
    slideOf('image-text-slide', { image: '/a.png' }),
    'image-set-slide',
    { lang: 'nl' },
  );
  assert.equal(next.content.images[0].fit, undefined);
  assert.equal(next.content.images[0].focusX, undefined);
});

test('convert: image-set -> image-text flattens images[0] and keeps the area', () => {
  const src = slideOf('image-set-slide', {
    images: [
      { src: '/a.png', alt: 'First', fit: 'contain', focusX: 10, focusY: 90 },
      { src: '/b.png' },
    ],
    caption: 'Cap',
    imageBackground: 'match',
  });
  const next = convertSlideToType(src, 'image-text-slide', { lang: 'nl' });
  assert.equal(next.content.image, '/a.png');
  assert.equal(next.content.alt, 'First');
  assert.equal(next.content.fit, 'contain');
  assert.equal(next.content.focusX, 10);
  assert.equal(next.content.focusY, 90);
  assert.equal(next.content.caption, 'Cap');
  assert.equal(next.content.imageBackground, 'match');
  assert.equal(next.content.images, undefined);
});

test('convert: the round trip is value-preserving for the first image', () => {
  const start = slideOf('image-text-slide', {
    image: '/a.png',
    alt: 'Own alt',
    fit: 'contain',
    focusX: 10,
    focusY: 90,
  });
  const back = convertSlideToType(
    convertSlideToType(start, 'image-set-slide', { lang: 'nl' }),
    'image-text-slide',
    { lang: 'nl' },
  );
  for (const key of ['image', 'alt', 'fit', 'focusX', 'focusY']) {
    assert.equal(back.content[key], start.content[key], `${key} survives`);
  }
});

test('convert: image-set -> image-text warns about images[1..] only when filled', () => {
  // `images` is only PARTIALLY consumed on this route: images[0] becomes the
  // single image, so the leftover IS the loss. An empty second cell is not
  // content and must not raise a confirm on every conversion.
  const empty = slideOf('image-set-slide', {
    images: [
      { src: '/a.png', alt: 'First' },
      { src: '', alt: '' },
    ],
  });
  assert.ok(
    !getConversionLossyKeys(empty, 'image-text-slide').includes('images'),
    'an empty second cell is not a loss',
  );

  const filled = slideOf('image-set-slide', {
    images: [{ src: '/a.png' }, { src: '/b.png' }],
  });
  assert.ok(
    getConversionLossyKeys(filled, 'image-text-slide').includes('images'),
    'a filled second cell is the boundary this seam exists to name',
  );

  // A third image alone counts too - the leftover is the whole tail.
  const third = slideOf('image-set-slide', {
    images: [{ src: '/a.png' }, { src: '' }, { src: '/c.png' }],
  });
  assert.ok(
    getConversionLossyKeys(third, 'image-text-slide').includes('images'),
  );
});

test('convert: the image-area enums never warn on either route', () => {
  // They ship as non-empty defaults on both types, so without the consumed
  // declarations every conversion would raise a confirm about housekeeping.
  const quiet = ['imageRole', 'imageSide', 'imageWidth', 'imageBackground'];
  for (const [from, to] of [
    ['image-text-slide', 'image-set-slide'],
    ['image-set-slide', 'image-text-slide'],
    ['image-text-slide', 'content-slide'],
    ['image-set-slide', 'content-slide'],
  ]) {
    const lossy = getConversionLossyKeys(slideOf(from), to);
    for (const key of quiet) {
      assert.ok(!lossy.includes(key), `${from} -> ${to}: ${key} stays quiet`);
    }
  }
});
