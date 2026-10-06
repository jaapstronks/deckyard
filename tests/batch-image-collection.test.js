import test from 'node:test';
import assert from 'node:assert/strict';
import gallery from '../shared/slide-types/types/gallery-slide.js';
import logoWall from '../shared/slide-types/types/logo-wall-slide.js';
import imageSet from '../shared/slide-types/types/image-set-slide.js';
import {
  applyBatchToCollection,
  collectionCapacity,
  collectionDestinationCapacity,
  imageCollectionSpec,
  snapshotCollectionDestination,
} from '../client/views/editor/media/batch-collection.js';
import { runBatchTasks } from '../client/views/editor/media/batch-runner.js';

const fieldFor = (def, key) => def.fields.find((field) => field.key === key);

function deckWithVersions(items, fieldKey = 'images') {
  const slide = {
    id: 's1',
    type: 'test',
    content: { [fieldKey]: structuredClone(items) },
  };
  const enSlide = {
    id: 's1',
    type: 'test',
    content: { [fieldKey]: structuredClone(items) },
  };
  const deSlide = {
    id: 's1',
    type: 'test',
    content: { [fieldKey]: structuredClone(items) },
  };
  const pres = {
    slides: [slide],
    i18n: {
      active: 'nl',
      versions: {
        nl: { slides: [slide] },
        'en-GB': { slides: [enSlide] },
        de: { slides: [deSlide] },
      },
    },
  };
  return { slide, enSlide, deSlide, pres };
}

test('declared collections count empty cells and array room, including the existing default cells', () => {
  const logos = fieldFor(logoWall, 'logos');
  const galleryImages = fieldFor(gallery, 'images');
  const setImages = fieldFor(imageSet, 'images');
  assert.deepEqual(imageCollectionSpec(logos), {
    fieldKey: 'logos',
    imageKey: 'image',
    nameKey: 'name',
    maxItems: 30,
    altMaxLength: 180,
    nameMaxLength: 80,
  });
  assert.equal(collectionCapacity(logos, [{ image: '' }]), 30);
  assert.equal(collectionCapacity(logos, [{ image: '/existing.png' }]), 29);
  assert.equal(
    collectionCapacity(galleryImages, [{ src: '' }, { src: '' }]),
    6,
  );
  assert.equal(collectionCapacity(setImages, [{ src: '' }, { src: '' }]), 3);
  assert.equal(
    collectionCapacity(setImages, [{ src: '/a' }, { src: '/b' }]),
    1,
  );
});

test('one apply fills empty slots then appends, preserving per-language metadata and alt', () => {
  const field = fieldFor(gallery, 'images');
  const { slide, enSlide, deSlide, pres } = deckWithVersions([
    { src: '/existing', alt: 'old', caption: 'keep' },
    { src: '', alt: '', caption: 'reserved', focusX: 42 },
  ]);
  const snapshot = snapshotCollectionDestination({
    slide,
    field,
    pres,
    activeLang: 'nl',
  });
  const result = applyBatchToCollection({
    slide,
    field,
    pres,
    activeLang: 'nl',
    snapshot,
    picks: [
      { url: '/new-1', alts: { nl: 'een', 'en-GB': 'one', de: 'eins' } },
      { url: '/new-2', alts: { nl: 'twee', 'en-GB': 'two', de: 'zwei' } },
    ],
  });
  assert.deepEqual(result, { ok: true, count: 2 });
  for (const [target, lang, alt1, alt2] of [
    [slide, 'nl', 'een', 'twee'],
    [enSlide, 'en-GB', 'one', 'two'],
    [deSlide, 'de', 'eins', 'zwei'],
  ]) {
    assert.equal(target.content.images.length, 3, lang);
    assert.deepEqual(target.content.images[0], {
      src: '/existing',
      alt: 'old',
      caption: 'keep',
    });
    assert.deepEqual(target.content.images[1], {
      src: '/new-1',
      alt: alt1,
      caption: 'reserved',
      focusX: 42,
    });
    assert.deepEqual(target.content.images[2], {
      src: '/new-2',
      alt: alt2,
      caption: '',
    });
  }
});

test('occupied variant cells are protected and a changed destination applies nothing', () => {
  const field = fieldFor(imageSet, 'images');
  const { slide, enSlide, deSlide, pres } = deckWithVersions([
    { src: '', alt: '' },
    { src: '', alt: '' },
  ]);
  enSlide.content.images[0].src = '/english-only';
  assert.equal(
    collectionDestinationCapacity({ slide, field, pres, activeLang: 'nl' }),
    2,
  );
  const snapshot = snapshotCollectionDestination({
    slide,
    field,
    pres,
    activeLang: 'nl',
  });
  const picks = [{ url: '/new', alts: { nl: 'nieuw', 'en-GB': 'new' } }];
  assert.deepEqual(
    applyBatchToCollection({
      slide,
      field,
      pres,
      activeLang: 'nl',
      snapshot,
      picks,
      currentSlideId: 'other',
    }),
    { ok: false, reason: 'stale' },
  );
  deSlide.content.images[1].alt = 'edited while uploading';
  assert.deepEqual(
    applyBatchToCollection({
      slide,
      field,
      pres,
      activeLang: 'nl',
      snapshot,
      picks,
    }),
    { ok: false, reason: 'stale' },
  );
  assert.equal(slide.content.images[1].src, '');
  assert.equal(enSlide.content.images[0].src, '/english-only');
});

test('an over-capacity or overlong logo batch is rejected atomically', () => {
  const field = fieldFor(logoWall, 'logos');
  const { slide, enSlide, pres } = deckWithVersions(
    [{ image: '/existing', name: 'Existing', alt: 'keep' }],
    'logos',
  );
  const snapshot = snapshotCollectionDestination({
    slide,
    field,
    pres,
    activeLang: 'nl',
  });
  const tooMany = Array.from({ length: 30 }, (_, index) => ({
    url: `/image-${index}`,
    name: `Logo ${index}`,
  }));
  assert.deepEqual(
    applyBatchToCollection({
      slide,
      field,
      pres,
      activeLang: 'nl',
      snapshot,
      picks: tooMany,
    }),
    { ok: false, reason: 'capacity', capacity: 29 },
  );
  assert.deepEqual(
    applyBatchToCollection({
      slide,
      field,
      pres,
      activeLang: 'nl',
      snapshot,
      picks: [{ url: '/new', name: 'x'.repeat(81) }],
    }),
    { ok: false, reason: 'invalid' },
  );
  assert.deepEqual(slide.content.logos, [
    { image: '/existing', name: 'Existing', alt: 'keep' },
  ]);
  assert.deepEqual(enSlide.content.logos, slide.content.logos);
});

test('runner caps concurrency, preserves result order, and stops starting after cancellation', async () => {
  let active = 0;
  let peak = 0;
  const resolvers = [];
  const running = runBatchTasks(
    [0, 1, 2, 3],
    async (row) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => {
        resolvers[row] = resolve;
      });
      active -= 1;
      if (row === 1) throw new Error('row 1');
      return row * 10;
    },
    { concurrency: 2 },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peak, 2);
  resolvers[1]();
  await new Promise((resolve) => setImmediate(resolve));
  resolvers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  resolvers[3]();
  resolvers[2]();
  const results = await running;
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected', 'fulfilled', 'fulfilled'],
  );
  assert.equal(results[2].value, 20);

  let keepGoing = true;
  let started = 0;
  const stopped = await runBatchTasks(
    [1, 2, 3],
    async () => {
      started += 1;
      keepGoing = false;
    },
    { concurrency: 1, shouldContinue: () => keepGoing },
  );
  assert.equal(started, 1);
  assert.equal(stopped[1], undefined);
  assert.equal(stopped[2], undefined);
});
