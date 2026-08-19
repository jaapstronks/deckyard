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
 * declaration (shared/slide-types/clone.js, read off the type) and the helper
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
const { CLONE_REKEY_SOURCE_NAMES, applyCloneRekey, slideRekeyOnClone } =
  await import('../shared/slide-types/clone.js');
const { cloneSlidesForInsert, pasteSlidesFromClipboard } =
  await import('../client/lib/slide-authoring/clone-slides.js');
const { copySlides } =
  await import('../client/lib/slide-authoring/slide-clipboard.js');

/** Types that declare instance-bound content keys, from the registry. */
function declaringTypes() {
  return Object.entries(SLIDE_TYPES)
    .map(([name, def]) => [name, slideRekeyOnClone(def)])
    .filter(([, rekey]) => Object.keys(rekey).length > 0);
}

test('the declaration is read off the type, and only in the vocabulary', () => {
  assert.deepEqual(slideRekeyOnClone(undefined), {});
  assert.deepEqual(slideRekeyOnClone({}), {});
  assert.deepEqual(slideRekeyOnClone({ rekeyOnClone: ['pollId'] }), {});
  // An unknown source is dropped rather than applied: a fork cannot land a
  // source the clone helper has no way to satisfy.
  assert.deepEqual(
    slideRekeyOnClone({
      rekeyOnClone: { pollId: 'fresh-id', other: 'whatever-the-fork-wants' },
    }),
    { pollId: 'fresh-id' },
  );
});

test('every declared key is a real content key of its type', () => {
  const declaring = declaringTypes();
  assert.ok(declaring.length > 0, 'no type declares rekeyOnClone');
  for (const [name, rekey] of declaring) {
    const def = SLIDE_TYPES[name];
    const known = new Set([
      ...Object.keys(def?.defaults || {}),
      ...(def?.fields || []).map((f) => String(f?.key || '')),
    ]);
    for (const key of Object.keys(rekey)) {
      assert.ok(
        known.has(key),
        `${name}: rekeyOnClone names '${key}', which is neither a field nor a default`,
      );
      assert.ok(
        CLONE_REKEY_SOURCE_NAMES.includes(rekey[key]),
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

test('applyCloneRekey writes each source and reports what it wrote', () => {
  let n = 0;
  const slide = { type: 'poll-slide', content: { pollId: 'old', q: 'keep' } };
  const written = applyCloneRekey(slide, {
    def: SLIDE_TYPES['poll-slide'],
    presentationId: 'deck-9',
    newId: () => `id-${++n}`,
  });
  assert.deepEqual(written, ['pollId']);
  assert.equal(slide.content.pollId, 'id-1');
  assert.equal(slide.content.q, 'keep');

  const invite = { type: 'follow-invite-slide', content: {} };
  applyCloneRekey(invite, {
    def: SLIDE_TYPES['follow-invite-slide'],
    presentationId: 'deck-9',
    newId: () => 'unused',
  });
  assert.equal(invite.content.presentationId, 'deck-9');

  // A type that declares nothing is left alone, content object and all.
  const plain = { type: 'content-slide', content: { title: 'x' } };
  assert.deepEqual(
    applyCloneRekey(plain, {
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

test('pasteSlidesFromClipboard: one routine for the paste bar and Ctrl+V', () => {
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
