import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types.js';
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

  // Alt + focus + fit are now canonical on the item.
  assert.equal(legacy.images[0].src, '/legacy.png');
  assert.equal(legacy.images[0].alt, 'Legacy alt');
  assert.equal(legacy.images[0].focusX, 25);
  assert.equal(legacy.images[0].focusY, 75);
  assert.equal(legacy.images[0].fit, 'contain');
  // Slide-level alt/focus/fit are cleared.
  assert.equal(legacy.alt, '');
  assert.equal(legacy.focusX, '');
  assert.equal(legacy.focusY, '');
  assert.equal(legacy.imageFit, '');
  // Render is byte-identical - the resolver already folded the same values.
  assert.equal(render(legacy), before);
});

// ---- Step-2b fold: fit becomes an ImageRef property -------------------------

test('migration: a default base fit is dropped, never stamped onto the items', () => {
  // imageFit equal to the type default carries no information: the fold drops
  // the field and leaves every item fit empty, so the empty-means-follow-the-
  // type signal survives and a future default change still reaches this deck.
  const content = slide({ layout: 'duo', imageFit: 'cover', images: [{ src: '/a.png' }, { src: '/b.png' }] });
  const before = render(structuredClone(content));
  ensureImageTextImages(content);
  assert.equal(content.imageFit, '');
  assert.equal(content.images[0].fit ?? '', '');
  assert.equal(content.images[1].fit ?? '', '');
  assert.equal(render(content), before, 'render-identical (both resolve to the default)');
});

test('migration: a deviating base fit fans out to every item without its own fit', () => {
  const content = slide({
    layout: 'duo',
    imageFit: 'contain',
    images: [{ src: '/a.png' }, { src: '/b.png', fit: 'cover' }, { src: '/extra.png' }],
  });
  const before = render(structuredClone(content));
  ensureImageTextImages(content);
  assert.equal(content.imageFit, '');
  assert.equal(content.images[0].fit, 'contain');
  assert.equal(content.images[1].fit, 'cover', 'an item fit is never clobbered');
  // The remembered extra beyond the duo cell count keeps its look too, so
  // switching to a 3-image row later still renders it contained.
  assert.equal(content.images[2].fit, 'contain');
  assert.equal(render(content), before, 'the fan-out is render-neutral');
});

test('migration: single-cell deviating base fit is render-neutral (the old double-pad shape)', () => {
  // Pre-unification this was the shape a blind fan-out would double-pad
  // (slide contain via `.media` padding + item contain via `.frame` padding).
  // With one frame-based mechanism the fold is byte-identical.
  const content = slide({ layout: 'split', imageFit: 'contain', images: [{ src: '/a.png' }] });
  const before = render(structuredClone(content));
  ensureImageTextImages(content);
  assert.equal(content.images[0].fit, 'contain');
  assert.equal(content.imageFit, '');
  assert.equal(render(content), before);
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

// ---- Fit class snapshots: the unified, frame-based mechanism (step 2b) ------

/**
 * Since step 2b there is ONE fit mechanism: every frame carries its *effective*
 * fit as an is-fit-* class (resolved item override -> slide base -> type
 * default), and no container-level is-image-cover/contain class exists any
 * more. Because the emitted HTML no longer distinguishes where the fit came
 * from, the data fan-out (slide `imageFit` -> images[i].fit) is render-neutral
 * by construction. These snapshots pin that contract: a container fit class
 * reappearing, or a frame rendering without an explicit fit class, is a
 * regression toward the old two-mechanism split.
 */
const fitClasses = (content) => {
  const html = render(content);
  const container = (html.match(/is-image-(?:cover|contain)/g) || []).slice(0, 1);
  const frames = html.match(/frame(?: is-fit-(?:cover|contain))?/g) || [];
  return { container: container[0] || null, frames };
};

test('fit class snapshot: single-cell base fit rides the frame, no container class', () => {
  // split + slide-level contain: the frame carries the effective fit; the
  // container carries no fit class at all (the old `.media` mechanism is gone).
  assert.deepEqual(fitClasses(slide({ layout: 'split', imageFit: 'contain', images: [{ src: '/a.png' }] })), {
    container: null,
    frames: ['frame is-fit-contain'],
  });
  assert.deepEqual(fitClasses(slide({ layout: 'split', imageFit: 'cover', images: [{ src: '/a.png' }] })), {
    container: null,
    frames: ['frame is-fit-cover'],
  });
});

test('fit class snapshot: a per-image override renders identically to a slide base', () => {
  // split + per-image contain: byte-for-byte the same fit classes as the
  // slide-level contain above - the render no longer betrays the record level,
  // which is exactly what makes the step-2b fan-out render-neutral.
  assert.deepEqual(fitClasses(slide({ layout: 'split', images: [{ src: '/a.png', fit: 'contain' }] })), {
    container: null,
    frames: ['frame is-fit-contain'],
  });
});

test('fit class snapshot: multi-cell base fit lands on every frame', () => {
  assert.deepEqual(
    fitClasses(slide({ layout: 'duo', imageFit: 'contain', images: [{ src: '/a.png' }, { src: '/b.png' }] })),
    { container: null, frames: ['frame is-fit-contain', 'frame is-fit-contain'] }
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
    { container: null, frames: ['frame is-fit-contain', 'frame is-fit-cover'] }
  );
});
