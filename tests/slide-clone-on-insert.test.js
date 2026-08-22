/**
 * The clone-on-insert recipe: one helper, one declaration.
 *
 * Five editor paths copy a slide into a deck (duplicate from the list, duplicate
 * from the ⋯ menu, the paste bar, Ctrl+V, insert from the slide library) and
 * each used to carry its own copy of "fresh ids, re-point nested children,
 * re-mint the instance-bound content keys". Two type names per copy is below the
 * three-name threshold of tests/slide-type-name-branching.test.js, so the
 * duplication was invisible to that gate — and it had already drifted: the ⋯
 * menu re-minted the poll id but not the follow-invite's presentation id.
 *
 * So this file gates the two halves the drift is now impossible in: the
 * declaration (shared/slide-types/instance-keys.js, read off the type) and the helper
 * (client/lib/slide-authoring/clone-slides.js, the only implementation).
 *
 * Run with: node --test tests/slide-clone-on-insert.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { INSTANCE_KEY_SOURCE_NAMES, applyInstanceKeyRekey, slideInstanceKeys } =
  await import('../shared/slide-types/instance-keys.js');
const {
  cloneSlidesForInsert,
  insertIndexAfterSubtree,
  pasteSlidesFromClipboard,
} = await import('../client/lib/slide-authoring/clone-slides.js');
const { copySlides, getClipboardSlides, getClipboardCount } =
  await import('../client/lib/slide-authoring/slide-clipboard.js');

/** Types that declare instance-bound content keys, from the registry. */
function declaringTypes() {
  return Object.entries(SLIDE_TYPES)
    .map(([name, def]) => [name, slideInstanceKeys(def)])
    .filter(([, rekey]) => Object.keys(rekey).length > 0);
}

test('the declaration is read off the type, and only in the vocabulary', () => {
  assert.deepEqual(slideInstanceKeys(undefined), {});
  assert.deepEqual(slideInstanceKeys({}), {});
  assert.deepEqual(slideInstanceKeys({ instanceKeys: ['pollId'] }), {});
  // An unknown source is dropped rather than applied: a fork cannot land a
  // source the clone helper has no way to satisfy.
  assert.deepEqual(
    slideInstanceKeys({
      instanceKeys: { pollId: 'fresh-id', other: 'whatever-the-fork-wants' },
    }),
    { pollId: 'fresh-id' },
  );
});

test('every declared key is a real content key of its type', () => {
  const declaring = declaringTypes();
  assert.ok(declaring.length > 0, 'no type declares instanceKeys');
  for (const [name, rekey] of declaring) {
    const def = SLIDE_TYPES[name];
    const known = new Set([
      ...Object.keys(def?.defaults || {}),
      ...(def?.fields || []).map((f) => String(f?.key || '')),
    ]);
    for (const key of Object.keys(rekey)) {
      assert.ok(
        known.has(key),
        `${name}: instanceKeys names '${key}', which is neither a field nor a default`,
      );
      assert.ok(
        INSTANCE_KEY_SOURCE_NAMES.includes(rekey[key]),
        `${name}.${key}: '${rekey[key]}' is not a declared source`,
      );
    }
  }
});

test('the two live cases are declared, not hard-coded', () => {
  const byType = Object.fromEntries(declaringTypes());
  assert.deepEqual(byType['poll-slide'], { pollId: 'fresh-id' });
  assert.deepEqual(byType['follow-invite-slide'], {
    presentationId: 'presentation-id',
  });
});

test('applyInstanceKeyRekey writes each source and reports what it wrote', () => {
  let n = 0;
  const slide = { type: 'poll-slide', content: { pollId: 'old', q: 'keep' } };
  const written = applyInstanceKeyRekey(slide, {
    def: SLIDE_TYPES['poll-slide'],
    presentationId: 'deck-9',
    newId: () => `id-${++n}`,
  });
  assert.deepEqual(written, ['pollId']);
  assert.equal(slide.content.pollId, 'id-1');
  assert.equal(slide.content.q, 'keep');

  const invite = { type: 'follow-invite-slide', content: {} };
  applyInstanceKeyRekey(invite, {
    def: SLIDE_TYPES['follow-invite-slide'],
    presentationId: 'deck-9',
    newId: () => 'unused',
  });
  assert.equal(invite.content.presentationId, 'deck-9');

  // A type that declares nothing is left alone, content object and all.
  const plain = { type: 'content-slide', content: { title: 'x' } };
  assert.deepEqual(
    applyInstanceKeyRekey(plain, {
      def: SLIDE_TYPES['content-slide'],
      presentationId: 'deck-9',
      newId: () => 'unused',
    }),
    [],
  );
  assert.deepEqual(plain.content, { title: 'x' });
});

test('cloneSlidesForInsert: fresh ids, nesting kept inside the cloned set', () => {
  const parent = { id: 'p', type: 'content-slide', content: { title: 'P' } };
  const child = {
    id: 'c',
    parentId: 'p',
    type: 'content-slide',
    content: { title: 'C' },
  };
  const clones = cloneSlidesForInsert([parent, child], {
    slideTypes: SLIDE_TYPES,
    presentationId: 'deck-1',
  });

  assert.equal(clones.length, 2);
  assert.notEqual(clones[0].id, 'p');
  assert.notEqual(clones[1].id, 'c');
  assert.equal(clones[1].parentId, clones[0].id, 'child follows its clone');
  // The sources are untouched.
  assert.equal(parent.id, 'p');
  assert.equal(child.parentId, 'p');
});

test('cloneSlidesForInsert: a parent outside the set is kept, or detached', () => {
  const child = {
    id: 'c',
    parentId: 'p',
    type: 'content-slide',
    content: {},
  };
  const [kept] = cloneSlidesForInsert([child], { slideTypes: SLIDE_TYPES });
  assert.equal(kept.parentId, 'p', 'duplicate stays under the same parent');

  const [detached] = cloneSlidesForInsert([child], {
    slideTypes: SLIDE_TYPES,
    detachOrphans: true,
  });
  assert.equal(detached.parentId, null, 'paste lands at the top level');
});

test('cloneSlidesForInsert: content is deep-copied, then rekeyed per type', () => {
  const poll = {
    id: 'a',
    type: 'poll-slide',
    content: { pollId: 'shared', question: 'Q', nested: { deep: [1] } },
  };
  const invite = {
    id: 'b',
    type: 'follow-invite-slide',
    content: { presentationId: 'old-deck' },
  };
  const [pollClone, inviteClone] = cloneSlidesForInsert([poll, invite], {
    slideTypes: SLIDE_TYPES,
    presentationId: 'deck-2',
  });

  assert.notEqual(pollClone.content.pollId, 'shared');
  assert.ok(pollClone.content.pollId, 'a fresh id, not an empty one');
  assert.equal(poll.content.pollId, 'shared', 'source untouched');
  assert.equal(pollClone.content.question, 'Q');
  pollClone.content.nested.deep.push(2);
  assert.deepEqual(poll.content.nested.deep, [1], 'no shared substructure');

  assert.equal(inviteClone.content.presentationId, 'deck-2');
  assert.equal(invite.content.presentationId, 'old-deck');
});

test('cloneSlidesForInsert: two clones of one poll never share the id', () => {
  const poll = { id: 'a', type: 'poll-slide', content: { pollId: 'x' } };
  const [one] = cloneSlidesForInsert([poll], { slideTypes: SLIDE_TYPES });
  const [two] = cloneSlidesForInsert([poll], { slideTypes: SLIDE_TYPES });
  assert.notEqual(one.content.pollId, two.content.pollId);
  assert.notEqual(one.id, two.id);
});

test('the clipboard carries the nesting a copy path collected', () => {
  globalThis.localStorage.clear();
  copySlides([
    { id: 'p', type: 'content-slide', content: { title: 'P' } },
    { id: 'c', parentId: 'p', type: 'content-slide', content: { title: 'C' } },
  ]);
  const round = getClipboardSlides();
  assert.equal(round.length, 2);
  assert.equal(round[0].id, 'p');
  assert.equal(round[1].parentId, 'p', 'the parent link survives the store');
  assert.equal(round[0].parentId, null, 'a top-level slide says so');
});

test('a clipboard in the previous shape reads as no clipboard', () => {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(
    'ps:slide-clipboard',
    JSON.stringify({
      version: 1,
      timestamp: Date.now(),
      slides: [{ type: 'content-slide', content: {}, notes: '' }],
    }),
  );
  // A second accepted shape is what the beta stance rules out: the older entry
  // is simply not a clipboard, and the paste bar hides itself.
  assert.equal(getClipboardSlides(), null);
  assert.equal(getClipboardCount(), 0);
});

test('pasteSlidesFromClipboard: parent and child land nested, with fresh ids', () => {
  globalThis.localStorage.clear();
  copySlides([
    { id: 'p', type: 'content-slide', content: { title: 'P' } },
    { id: 'c', parentId: 'p', type: 'content-slide', content: { title: 'C' } },
  ]);

  const pres = { id: 'deck-5', slides: [] };
  const n = pasteSlidesFromClipboard({
    pres,
    slideTypes: SLIDE_TYPES,
    editorState: { dirtyRefreshAll: () => {} },
    t: (_key, fallback) => fallback,
  });

  assert.equal(n, 2);
  const [parent, child] = pres.slides;
  assert.notEqual(parent.id, 'p', 'fresh id');
  assert.notEqual(child.id, 'c', 'fresh id');
  assert.equal(parent.parentId, null);
  assert.equal(child.parentId, parent.id, 'nesting restored on paste');
});

test('pasteSlidesFromClipboard: a child copied without its parent goes top-level', () => {
  globalThis.localStorage.clear();
  copySlides([
    { id: 'c', parentId: 'p', type: 'content-slide', content: { title: 'C' } },
  ]);

  const pres = { id: 'deck-6', slides: [] };
  pasteSlidesFromClipboard({
    pres,
    slideTypes: SLIDE_TYPES,
    editorState: { dirtyRefreshAll: () => {} },
    t: (_key, fallback) => fallback,
  });

  assert.equal(pres.slides.length, 1);
  assert.equal(
    pres.slides[0].parentId,
    null,
    'the parent lives in the source deck, so the copy detaches',
  );
});

test('pasteSlidesFromClipboard: one routine for the paste bar and Ctrl+V', () => {
  globalThis.localStorage.clear();
  copySlides([
    { id: 'src', type: 'poll-slide', content: { pollId: 'x', question: 'Q' } },
  ]);

  const pres = {
    id: 'deck-3',
    slides: [
      { id: 's1', type: 'content-slide', content: {} },
      { id: 's2', type: 'content-slide', content: {} },
    ],
  };
  const calls = [];
  const n = pasteSlidesFromClipboard({
    pres,
    slideTypes: SLIDE_TYPES,
    getSelectedSlideId: () => 's1',
    setSelectedSlideId: (id) => calls.push(['select', id]),
    clearMultiSelection: () => calls.push(['clearMulti']),
    onMultiSelectionChange: () => calls.push(['multiChanged']),
    editorState: { dirtyRefreshAll: () => calls.push(['dirtyRefreshAll']) },
    toast: { success: () => calls.push(['toast']) },
    t: (_key, fallback) => fallback,
  });

  assert.equal(n, 1);
  assert.equal(pres.slides.length, 3);
  assert.equal(
    pres.slides[1].type,
    'poll-slide',
    'inserted after the selection',
  );
  assert.notEqual(pres.slides[1].content.pollId, 'x', 'rekeyed on paste');
  assert.equal(pres.slides[1].parentId, null);
  assert.deepEqual(
    calls.map(([name]) => name),
    ['clearMulti', 'select', 'dirtyRefreshAll', 'multiChanged', 'toast'],
  );
});

test('pasteSlidesFromClipboard: a paste under a parent lands after its children', () => {
  // The insert-after-selection rule used to be `afterIdx + 1`, which put the
  // pasted slides *between* a parent and its own children: the nesting still
  // rendered (the parent link is what makes a child a child), but the deck
  // order — and the numbering the author reads — interleaved.
  globalThis.localStorage.clear();
  copySlides([{ id: 'x', type: 'content-slide', content: { title: 'X' } }]);

  const pres = {
    id: 'deck-7',
    slides: [
      { id: 'p', type: 'content-slide', content: {} },
      { id: 'c1', parentId: 'p', type: 'content-slide', content: {} },
      { id: 'c2', parentId: 'p', type: 'content-slide', content: {} },
      { id: 'after', type: 'content-slide', content: {} },
    ],
  };
  pasteSlidesFromClipboard({
    pres,
    slideTypes: SLIDE_TYPES,
    getSelectedSlideId: () => 'p',
    editorState: { dirtyRefreshAll: () => {} },
    t: (_key, fallback) => fallback,
  });

  const pasted = pres.slides.find((s) => s.content?.title === 'X');
  assert.deepEqual(
    pres.slides.map((s) => s.id),
    ['p', 'c1', 'c2', pasted.id, 'after'],
    'the copy lands after the whole group, not inside it',
  );
  assert.equal(pasted.parentId, null, 'and as a sibling of the parent');
});

test('insertIndexAfterSubtree: the walk is the subtree, not the next row', () => {
  const flat = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(
    insertIndexAfterSubtree(flat, 0),
    1,
    'a leaf inserts right after',
  );
  assert.equal(
    insertIndexAfterSubtree(flat, 2),
    3,
    'the last slide inserts at the end',
  );

  const nested = [
    { id: 'p' },
    { id: 'c1', parentId: 'p' },
    { id: 'g1', parentId: 'c1' },
    { id: 'c2', parentId: 'p' },
    { id: 'next' },
  ];
  // The editor caps nesting at one level, but an API-built or imported deck is
  // not bound by that, so a grandchild has to extend the block as well.
  assert.equal(
    insertIndexAfterSubtree(nested, 0),
    4,
    'past children and grandchildren',
  );
  assert.equal(
    insertIndexAfterSubtree(nested, 1),
    3,
    'a child takes its own grandchild with it',
  );
  assert.equal(
    insertIndexAfterSubtree(nested, 3),
    4,
    'a childless child inserts right after',
  );

  // Degenerate anchors must not swallow the deck: an id-less row can be named
  // by no child, so nothing is nested under it.
  assert.equal(insertIndexAfterSubtree(nested, 99), 5);
  assert.equal(insertIndexAfterSubtree([{}, { id: 'x' }], 0), 1);
  assert.equal(insertIndexAfterSubtree(null, 0), 0);
});

test('pasteSlidesFromClipboard: an empty clipboard changes nothing', () => {
  globalThis.localStorage.clear();
  const pres = { id: 'deck-4', slides: [] };
  const n = pasteSlidesFromClipboard({
    pres,
    slideTypes: SLIDE_TYPES,
    editorState: {
      dirtyRefreshAll: () => assert.fail('must not refresh'),
    },
    t: (_key, fallback) => fallback,
  });
  assert.equal(n, 0);
  assert.deepEqual(pres.slides, []);
});
