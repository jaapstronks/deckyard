/**
 * Live edits keep every language of a collection item with that item when
 * an item is removed or moved (B875, the live-edits half of DY-773).
 *
 * The doc stores each item once, with all its languages inside it. Two
 * differs write into that array by position: the editor binder
 * (`diffItemsArray`) and the server-side apply (`applyItemsArray`). The
 * binder diffed a reorder in place, in the active language only, so the other
 * languages stayed at their old index; the server apply rewrote every item
 * after a mid-list remove, so a concurrent edit on one of them landed on its
 * neighbour. Both now name the one structural edit first (`itemsShift`) and
 * move or remove the item itself.
 *
 * Run with: node --test tests/collab-items-per-item.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { Y } = await import('../client/vendor/collab.js');
const { createDeckYdocCodec, itemsShift, patchYText } =
  await import('../shared/collab/deck-ydoc.js');
const { createLiveDocBinder } =
  await import('../client/views/editor/live-edits/live-doc-binder.js');

const NL = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun'];
const EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

function timeline(months, lang) {
  return {
    id: 'tl',
    type: 'timeline-slide',
    notes: '',
    content: {
      title: lang === 'nl' ? 'Tijdlijn' : 'Timeline',
      items: months.map((m) => ({
        date: m,
        title: `${m} ${lang} title`,
        text: `${m} ${lang} text`,
      })),
    },
  };
}

function bilingualPres() {
  const nl = [timeline(NL, 'nl')];
  return {
    id: 'p1',
    title: 'Deck',
    lang: 'nl',
    theme: 'default',
    visibility: 'private',
    slides: nl,
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: {
        nl: { title: 'Deck', slides: nl },
        'en-GB': { title: 'Deck', slides: [timeline(EN, 'en')] },
      },
    },
  };
}

const codec = createDeckYdocCodec(Y);

function bootstrapped() {
  const doc = new Y.Doc();
  codec.bootstrapPresentationToDoc(bilingualPres(), doc);
  return doc;
}

/** `[nlTitle, enTitle]` per item of the projected doc. */
function pairs(doc) {
  const out = codec.projectDocToPresentation(doc);
  const nl = out.i18n.versions.nl.slides[0].content.items;
  const en = out.i18n.versions['en-GB'].slides[0].content.items;
  return nl.map((it, i) => [it.title, en[i]?.title]);
}

function assertMatched(doc) {
  for (const [nl, en] of pairs(doc)) {
    assert.equal(
      nl.split(' ')[0].replace('Mrt', 'Mar').replace('Mei', 'May'),
      en.split(' ')[0],
      `NL "${nl}" sits next to EN "${en}"`,
    );
  }
}

test('itemsShift names a single remove, insert or move, and nothing else', () => {
  const a = ['a', 'b', 'c', 'd'];
  assert.deepEqual(itemsShift(a, ['a', 'c', 'd']), {
    kind: 'remove',
    index: 1,
  });
  assert.deepEqual(itemsShift(a, ['a', 'b', 'c']), {
    kind: 'remove',
    index: 3,
  });
  assert.deepEqual(itemsShift(a, ['a', 'x', 'b', 'c', 'd']), {
    kind: 'insert',
    index: 1,
  });
  assert.deepEqual(itemsShift(a, ['b', 'c', 'a', 'd']), {
    kind: 'move',
    from: 0,
    to: 2,
  });
  assert.deepEqual(itemsShift(a, ['a', 'd', 'b', 'c']), {
    kind: 'move',
    from: 3,
    to: 1,
  });
  assert.deepEqual(itemsShift(a, ['b', 'a', 'c', 'd']), {
    kind: 'move',
    from: 0,
    to: 1,
  });
  assert.equal(itemsShift(a, a.slice()), null, 'equal arrays');
  assert.equal(itemsShift(a, ['a', 'x', 'c', 'd']), null, 'an in-place edit');
  assert.equal(itemsShift(a, ['d', 'c', 'b', 'a']), null, 'two moves');
  assert.equal(itemsShift(a, ['a', 'd']), null, 'two removes');
});

test('binder: a reorder in NL moves the EN texts with each item', () => {
  const doc = bootstrapped();
  const pres = codec.projectDocToPresentation(doc);
  const binder = createLiveDocBinder({
    Y,
    doc,
    codec,
    pres,
    getActiveLang: () => 'nl',
  });
  binder.attach();

  // Drag "Jan" below "Mrt", the way the collection editor commits it.
  const items = pres.slides[0].content.items;
  const [moved] = items.splice(0, 1);
  items.splice(2, 0, moved);
  binder.syncLocal();

  assert.deepEqual(
    pairs(doc).map(([nl]) => nl.split(' ')[0]),
    ['Feb', 'Mrt', 'Jan', 'Apr', 'Mei', 'Jun'],
  );
  assertMatched(doc);
  binder.detach();
});

test('binder: a remove in the middle takes the EN item with it', () => {
  const doc = bootstrapped();
  const pres = codec.projectDocToPresentation(doc);
  const binder = createLiveDocBinder({
    Y,
    doc,
    codec,
    pres,
    getActiveLang: () => 'nl',
  });
  binder.attach();

  pres.slides[0].content.items.splice(3, 1);
  binder.syncLocal();

  assert.deepEqual(
    pairs(doc).map(([, en]) => en.split(' ')[0]),
    ['Jan', 'Feb', 'Mar', 'May', 'Jun'],
  );
  assertMatched(doc);
  binder.detach();
});

/** The EN text Y.Text of item `i` in the doc. */
function enText(doc, i) {
  return doc
    .getArray('slides')
    .get(0)
    .get('content')
    .get('items')
    .get(i)
    .get('text')
    .get('en-GB');
}

test('server apply: a mid-list remove spares a concurrent edit on a later item', () => {
  const doc = bootstrapped();
  const base = codec.projectDocToPresentation(doc);

  // A live client edits EN "Jun" after the base was stored.
  patchYText(enText(doc, 5), 'Jun en text (live)');

  // The API write removes "Apr" in both versions, as the editor mirrors it.
  const next = structuredClone(base);
  next.slides[0].content.items.splice(3, 1);
  next.i18n.versions.nl.slides = next.slides;
  next.i18n.versions['en-GB'].slides[0].content.items.splice(3, 1);

  codec.applyPresentationToDoc(next, doc, { base });

  assertMatched(doc);
  const out = codec.projectDocToPresentation(doc);
  const en = out.i18n.versions['en-GB'].slides[0].content.items;
  assert.deepEqual(
    en.map((it) => it.date),
    ['Jan', 'Feb', 'Mar', 'May', 'Jun'],
  );
  assert.equal(en[4].text, 'Jun en text (live)', 'the live edit stayed on Jun');
});

test('server apply: a move spares a concurrent edit on a shifted item', () => {
  const doc = bootstrapped();
  const base = codec.projectDocToPresentation(doc);

  patchYText(enText(doc, 1), 'Feb en text (live)');

  const next = structuredClone(base);
  const move = (arr) => {
    const [it] = arr.splice(0, 1);
    arr.splice(3, 0, it);
  };
  move(next.slides[0].content.items);
  next.i18n.versions.nl.slides = next.slides;
  move(next.i18n.versions['en-GB'].slides[0].content.items);

  codec.applyPresentationToDoc(next, doc, { base });

  assertMatched(doc);
  const en =
    codec.projectDocToPresentation(doc).i18n.versions['en-GB'].slides[0].content
      .items;
  assert.deepEqual(
    en.map((it) => it.date),
    ['Feb', 'Mar', 'Apr', 'Jan', 'May', 'Jun'],
  );
  assert.equal(en[0].text, 'Feb en text (live)', 'the live edit stayed on Feb');
});

test('server apply: a mid-list insert keeps the items after it whole', () => {
  const doc = bootstrapped();
  const base = codec.projectDocToPresentation(doc);

  patchYText(enText(doc, 4), 'May en text (live)');

  const next = structuredClone(base);
  next.slides[0].content.items.splice(2, 0, {
    date: 'Feb+',
    title: 'Feb+ nl title',
    text: 'Feb+ nl text',
  });
  next.i18n.versions.nl.slides = next.slides;
  next.i18n.versions['en-GB'].slides[0].content.items.splice(2, 0, {
    date: 'Feb+',
    title: 'Feb+ en title',
    text: 'Feb+ en text',
  });

  codec.applyPresentationToDoc(next, doc, { base });

  const en =
    codec.projectDocToPresentation(doc).i18n.versions['en-GB'].slides[0].content
      .items;
  assert.deepEqual(
    en.map((it) => it.date),
    ['Jan', 'Feb', 'Feb+', 'Mar', 'Apr', 'May', 'Jun'],
  );
  assert.equal(en[5].text, 'May en text (live)', 'the live edit stayed on May');
});
