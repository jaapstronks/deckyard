import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types/index.js';
import {
  resolveImageTextCell,
  ensureImageTextImages,
  IMAGE_TEXT_IMAGE_DEFAULTS,
} from '../shared/slide-types/image-text-images.js';

/**
 * Datamodel-normalisation step 2: the write -> render -> re-read round-trip
 * over the image-text ImageRef, plus the class-level fit guard that step 3
 * (the CSS-mechanism unification that must land before fit becomes an ImageRef
 * property) will lean on.
 *
 * The round-trip harness pins the whole class of baseline / stale-read bugs at
 * once: for every ImageRef field, the value a user writes on `images[i]` (the
 * single write seam) must appear in the render AND be re-read identically by
 * both editor read seams - `resolveImageTextCell` (canvas focal drag + render)
 * and the raw item (what the inspector's focus grid seeds from). If any surface
 * drifts, one of these assertions fails. The display-baseline bug was exactly
 * this: the grid seeded from the raw item while the render used a slide-level
 * fallback, so the grid showed the wrong crop start.
 */

const DEF = SLIDE_TYPES['image-text-slide'];
const render = (content) => DEF.renderHtml(content);
const slide = (content = {}) => ({
  ...structuredClone(DEF.defaults),
  ...content,
});

// ---- Round-trip: write on images[i] -> render + both read seams agree -------

/**
 * Each ImageRef field: a distinctive value, how it shows up in the render, and
 * how each read seam reports it. `reRead` returns [resolveValue, rawItemValue];
 * both must equal the written value (the two must never disagree).
 */
const IMAGE_REF_FIELDS = [
  {
    key: 'src',
    value: '/round-trip-src.png',
    inRender: (html, v) => html.includes(`src="${v}"`) && html.includes('data-inline-photo="0"'),
    reRead: (content) => [resolveImageTextCell(content, 0).item.src, content.images[0].src],
  },
  {
    key: 'alt',
    value: 'A precise description',
    inRender: (html, v) => html.includes(`alt="${v}"`),
    reRead: (content) => [resolveImageTextCell(content, 0).altExplicit, content.images[0].alt],
  },
  {
    key: 'fit',
    value: 'contain',
    inRender: (html) => /frame is-fit-contain/.test(html),
    reRead: (content) => [resolveImageTextCell(content, 0).fit, content.images[0].fit],
  },
  {
    key: 'focusX',
    value: 30,
    // Focus needs both axes to render a deterministic object-position; the
    // fixture sets focusY too, so assert the X we vary lands as the first %.
    inRender: (html) => /object-position:30% \d+%/.test(html),
    reRead: (content) => [resolveImageTextCell(content, 0).focusSource.focusX, content.images[0].focusX],
  },
  {
    key: 'focusY',
    value: 80,
    inRender: (html) => /object-position:\d+% 80%/.test(html),
    reRead: (content) => [resolveImageTextCell(content, 0).focusSource.focusY, content.images[0].focusY],
  },
];

for (const field of IMAGE_REF_FIELDS) {
  test(`round-trip: images[0].${field.key} - write reflects in render and both read seams`, () => {
    const content = slide({
      images: [{ src: '/base.png', alt: '', focusX: 50, focusY: 50 }],
    });
    // Write on the single seam.
    content.images[0][field.key] = field.value;
    // Render reflects it.
    assert.ok(
      field.inRender(render(content), field.value),
      `render reflects images[0].${field.key} = ${field.value}`
    );
    // Both editor read seams re-read the same value.
    const [resolved, rawItem] = field.reRead(content);
    assert.equal(resolved, field.value, `resolveImageTextCell re-reads ${field.key}`);
    assert.equal(rawItem, field.value, `the raw item (grid seed) re-reads ${field.key}`);
    assert.equal(resolved, rawItem, `${field.key}: the two read seams agree (no drift)`);
  });
}

test('round-trip: an empty focus resolves to the type default focus (config, 50/50)', () => {
  const content = slide({ images: [{ src: '/a.png' }] });
  const r = resolveImageTextCell(content, 0);
  // The renderer emits no object-position for an empty focus; the effective
  // crop point is the type default, so the config anchor states it explicitly.
  assert.equal(r.focusSource.focusX, '');
  assert.equal(IMAGE_TEXT_IMAGE_DEFAULTS.focus.x, 50);
  assert.equal(IMAGE_TEXT_IMAGE_DEFAULTS.focus.y, 50);
});

// ---- The display-baseline bug: focus/alt fold into images[0] ----------------

test('migration: slide-level alt + focus fold into images[0], render-equivalent', () => {
  const legacy = slide({
    layout: 'split',
    images: [],
    image: '/legacy.png',
    alt: 'Legacy alt',
    focusX: 25,
    focusY: 75,
    imageFit: 'contain',
  });
  const before = render(structuredClone(legacy));

  ensureImageTextImages(legacy);

  // Alt + focus are now canonical on the item.
  assert.equal(legacy.images[0].src, '/legacy.png');
  assert.equal(legacy.images[0].alt, 'Legacy alt');
  assert.equal(legacy.images[0].focusX, 25);
  assert.equal(legacy.images[0].focusY, 75);
  // Slide-level alt/focus are cleared...
  assert.equal(legacy.alt, '');
  assert.equal(legacy.focusX, '');
  assert.equal(legacy.focusY, '');
  // ...but imageFit is deliberately left slide-level (step 3, CSS unification).
  assert.equal(legacy.imageFit, 'contain');
  // Render is byte-identical - the resolver already folded the same values.
  assert.equal(render(legacy), before);
});

test('migration fixes the display-baseline bug: the grid seed becomes canonical', () => {
  // Before: images[0] carries no focus, so the inspector focus grid (which
  // seeds from the raw item) would show centre, while the render used the
  // slide-level 25/75 - the grid showed the wrong crop start.
  const content = slide({ layout: 'split', images: [{ src: '/x.png' }], focusX: 25, focusY: 75 });
  assert.equal(content.images[0].focusX ?? '', '', 'grid seed is empty before migration (the bug)');
  assert.equal(resolveImageTextCell(content, 0).focusSource.focusX, 25, 'render used the slide fallback');

  ensureImageTextImages(content);

  // After: the grid seed equals the rendered crop point.
  assert.equal(content.images[0].focusX, 25, 'grid seed is now the canonical value');
  assert.equal(resolveImageTextCell(content, 0).focusSource.focusX, 25);
});

test('migration preserves the alt-translation fallback (altNl/altEn untouched)', () => {
  const content = slide({ layout: 'split', images: [{ src: '/x.png' }], altNl: 'NL alt', altEn: 'EN alt' });
  ensureImageTextImages(content);
  // altNl/altEn are a read fallback we keep; the item alt stays empty so the
  // legacy per-language alt still resolves for cell 0.
  assert.equal(content.altNl, 'NL alt');
  assert.equal(content.altEn, 'EN alt');
  assert.equal(resolveImageTextCell(content, 0).altExplicit, 'NL alt');
});

test('migration does not clobber an existing item alt/focus with the slide value', () => {
  const content = slide({
    layout: 'split',
    images: [{ src: '/x.png', alt: 'Own alt', focusX: 90, focusY: 10 }],
    alt: 'Slide alt',
    focusX: 25,
    focusY: 75,
  });
  ensureImageTextImages(content);
  assert.equal(content.images[0].alt, 'Own alt', 'the item alt wins, not overwritten');
  assert.equal(content.images[0].focusX, 90, 'the item focus wins, not overwritten');
});

// ---- Step-3 guard: fit class-level snapshot over the affected shapes ---------

/**
 * Fit does NOT migrate in step 2: slide-level `imageFit` and per-image `fit`
 * render through two different CSS mechanisms (`.media` padding for the slide
 * base, `.frame.is-fit-*` for the per-image override) that only coincide for
 * multi-cell layouts. Step 3 unifies those mechanisms and only then moves fit
 * onto the ImageRef. This snapshot pins the exact fit-bearing classes each
 * shape renders today, so that CSS unification - a pure-render change with no
 * data migration - can be diffed against a concrete baseline: any class that
 * moves is a deliberate, reviewable change, not a silent regression.
 */
const fitClasses = (content) => {
  const html = render(content);
  const container = (html.match(/is-image-(?:cover|contain)/g) || []).slice(0, 1);
  const frames = html.match(/frame(?: is-fit-(?:cover|contain))?/g) || [];
  return { container: container[0] || null, frames };
};

test('fit class snapshot: single-cell base fit rides the container, not the frame', () => {
  // split + slide-level contain: container is-image-contain, frame carries NO
  // is-fit class (the `.media` mechanism). This is the shape that a blind
  // fan-out would double-pad; the snapshot is the guard for step 3.
  assert.deepEqual(fitClasses(slide({ layout: 'split', imageFit: 'contain', images: [{ src: '/a.png' }] })), {
    container: 'is-image-contain',
    frames: ['frame'],
  });
  assert.deepEqual(fitClasses(slide({ layout: 'split', imageFit: 'cover', images: [{ src: '/a.png' }] })), {
    container: 'is-image-cover',
    frames: ['frame'],
  });
});

test('fit class snapshot: a per-image override rides the frame', () => {
  // split + per-image contain (no slide-level fit): container is-image-cover,
  // frame is-fit-contain (the `.frame` mechanism). Different DOM layer than the
  // slide-level contain above - that is the mechanism split step 3 unifies.
  assert.deepEqual(fitClasses(slide({ layout: 'split', images: [{ src: '/a.png', fit: 'contain' }] })), {
    container: 'is-image-cover',
    frames: ['frame is-fit-contain'],
  });
});

test('fit class snapshot: multi-cell base fit rides the frames (mechanisms coincide)', () => {
  // duo + slide-level contain: container is-image-contain, and each frame stays
  // classless - the `.media.is-multi .frame` rule carries the padding. Because
  // the multi-cell base already lives on the frame, a per-image contain here is
  // render-equivalent (unlike single-cell); the snapshot records that.
  assert.deepEqual(
    fitClasses(slide({ layout: 'duo', imageFit: 'contain', images: [{ src: '/a.png' }, { src: '/b.png' }] })),
    { container: 'is-image-contain', frames: ['frame', 'frame'] }
  );
});

test('fit class snapshot: multi-cell with a per-image cover override deviates one frame', () => {
  assert.deepEqual(
    fitClasses(
      slide({
        layout: 'duo',
        imageFit: 'contain',
        images: [{ src: '/a.png' }, { src: '/b.png', fit: 'cover' }],
      })
    ),
    { container: 'is-image-contain', frames: ['frame', 'frame is-fit-cover'] }
  );
});
