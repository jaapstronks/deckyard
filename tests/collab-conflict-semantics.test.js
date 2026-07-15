/**
 * Conflict-behavior tests for live collaborative editing (phase 2, step 5):
 * pin down the ACCEPTED merge semantics when two editors do conflicting
 * things at the same time. These are semantics tests, not convergence tests —
 * convergence over a real mount is covered by collab-editor-binder.test.js
 * and collab-server-apply.test.js.
 *
 * Setup: two offline replicas (Y.Doc + editor-style pres + live-doc binder),
 * both edit BEFORE any update exchange, then updates are exchanged both
 * ways. This makes the concurrency deterministic instead of racing WebSocket
 * round-trips.
 *
 * The semantics pinned here (also documented in
 * docs/reference/collab-editor-binder.md):
 *
 * - delete vs edit of the same slide → the DELETE wins (the edit targeted a
 *   Y.Map that no longer exists after merge).
 * - move (reorder) vs delete of the same slide → the MOVE wins: Yjs has no
 *   move op, so a move is delete + insert of a deep clone; the concurrent
 *   delete removes the original, but the clone is a new object it never saw.
 * - move vs a concurrent edit inside the moved slide → the edit is LOST
 *   (it landed in the original, which the move deleted; the clone predates
 *   the edit). Accepted cost of clone-based moves.
 * - same text field, two discrete edits → character-level merge (Y.Text).
 * - same text field while one user stays focused → that user's next
 *   keystroke writes their input's whole value, which deletes the other's
 *   merged-in characters: field-level last-writer-wins while focused (the
 *   accepted step-3 fallback).
 * - adding a language version concurrent with content edits → both survive.
 * - a server-side translate (three-way apply with base) concurrent with a
 *   client edit → both survive.
 *
 * Run with: node --test tests/collab-conflict-semantics.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Y } from '../client/vendor/collab.js';
import { createDeckYdocCodec } from '../shared/collab/deck-ydoc.js';
import { createLiveDocBinder } from '../client/lib/collab/live-doc-binder.js';

const codec = createDeckYdocCodec(Y);

/** Fixture: three slides, one with items, single-language with i18n block. */
const fixturePres = () => {
  const slides = [
    {
      id: 's1',
      type: 'content-slide',
      notes: '',
      content: { title: 'Eerste', body: 'body een' },
    },
    {
      id: 's2',
      type: 'lijstje-slide',
      notes: '',
      content: {
        title: 'Lijstje',
        items: [
          { title: 'Een', text: 'eerste' },
          { title: 'Twee', text: 'tweede' },
        ],
      },
    },
    {
      id: 's3',
      type: 'content-slide',
      notes: '',
      content: { title: 'Derde', body: 'body drie' },
    },
  ];
  return {
    id: 'deck-conflict',
    title: 'Conflict deck',
    lang: 'nl',
    slides,
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: { nl: { title: 'Conflict deck', slides } },
    },
  };
};

/**
 * Two offline editor replicas of the same deck. Each has its own Y.Doc,
 * its own `pres` (the projection, i.e. what the editor holds) and its own
 * binder, exactly like two browser tabs before any sync traffic.
 */
function makeReplicas(pres = fixturePres()) {
  const docA = new Y.Doc();
  codec.bootstrapPresentationToDoc(structuredClone(pres), docA);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

  const mk = (doc) => {
    const p = codec.projectDocToPresentation(doc);
    const binder = createLiveDocBinder({
      Y,
      doc,
      codec,
      pres: p,
      getActiveLang: () => p?.i18n?.active || null,
    });
    binder.attach();
    return { doc, pres: p, binder };
  };
  return [mk(docA), mk(docB)];
}

/**
 * Exchange updates both ways. After this both docs hold the merged state
 * (CRDT merge is deterministic); the binders' observers have projected it
 * into each replica's `pres`.
 */
function exchange(a, b) {
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
}

function assertConverged(a, b) {
  assert.deepEqual(
    codec.projectDocToPresentation(a.doc),
    codec.projectDocToPresentation(b.doc),
    'both docs project to the same deck'
  );
  assert.deepEqual(a.pres.slides, b.pres.slides, 'both pres converge');
}

test('delete vs edit of the same slide: the delete wins', () => {
  const [a, b] = makeReplicas();

  a.pres.slides = a.pres.slides.filter((s) => s.id !== 's2');
  a.binder.syncLocal();

  const bs2 = b.pres.slides.find((s) => s.id === 's2');
  bs2.content.title = 'Bewerkt door B';
  bs2.content.items[0].text = 'ook bewerkt';
  b.binder.syncLocal();

  exchange(a, b);
  assertConverged(a, b);
  assert.equal(
    a.pres.slides.some((s) => s.id === 's2'),
    false,
    'the deleted slide stays deleted; the concurrent edit disappears with it'
  );
  assert.deepEqual(a.pres.slides.map((s) => s.id), ['s1', 's3']);
});

test('move vs delete of the same slide: the move wins (clone survives)', () => {
  const [a, b] = makeReplicas();

  // A moves s3 to the front (the slide-list drag mutation shape). The
  // binder implements this as delete + insert of a deep clone.
  const moved = a.pres.slides.find((s) => s.id === 's3');
  a.pres.slides = [moved, ...a.pres.slides.filter((s) => s !== moved)];
  a.binder.syncLocal();

  // B deletes s3 at the same time.
  b.pres.slides = b.pres.slides.filter((s) => s.id !== 's3');
  b.binder.syncLocal();

  exchange(a, b);
  assertConverged(a, b);
  const ids = a.pres.slides.map((s) => s.id);
  assert.deepEqual(
    ids,
    ['s3', 's1', 's2'],
    'the moved slide survives the concurrent delete, exactly once, at its new position'
  );
  assert.equal(
    a.pres.slides[0].content.title,
    'Derde',
    'the surviving clone carries the full content'
  );
});

test('move vs concurrent edit inside the moved slide: the edit is lost', () => {
  const [a, b] = makeReplicas();

  // A moves the lijstje slide to the front…
  const moved = a.pres.slides.find((s) => s.id === 's2');
  a.pres.slides = [moved, ...a.pres.slides.filter((s) => s !== moved)];
  a.binder.syncLocal();

  // …while B types into one of its items (and its title).
  const bs2 = b.pres.slides.find((s) => s.id === 's2');
  bs2.content.title = 'Lijstje bewerkt';
  bs2.content.items = bs2.content.items.map((it, i) =>
    i === 0 ? { ...it, text: 'eerste bewerkt' } : it
  );
  b.binder.syncLocal();

  exchange(a, b);
  assertConverged(a, b);
  const merged = a.pres.slides.find((s) => s.id === 's2');
  assert.equal(a.pres.slides[0].id, 's2', 'the move applied');
  // The accepted cost of clone-based moves: B's edits landed in the
  // original slide map, which A's move deleted. The clone predates them.
  assert.equal(merged.content.title, 'Lijstje', 'title edit lost to the move');
  assert.equal(merged.content.items[0].text, 'eerste', 'item edit lost to the move');
});

test('same field, two discrete edits: character-level merge', () => {
  const [a, b] = makeReplicas();

  a.pres.slides[0].content.title = 'Links Eerste';
  a.binder.syncLocal();
  b.pres.slides[0].content.title = 'Eerste rechts';
  b.binder.syncLocal();

  exchange(a, b);
  assertConverged(a, b);
  assert.equal(a.pres.slides[0].content.title, 'Links Eerste rechts');
});

test('same field while focused: next keystroke is field-level LWW', () => {
  const [a, b] = makeReplicas();

  // Discrete concurrent edits merge first (previous test's semantics)…
  a.pres.slides[0].content.title = 'Links Eerste';
  a.binder.syncLocal();
  b.pres.slides[0].content.title = 'Eerste rechts';
  b.binder.syncLocal();
  exchange(a, b);
  assert.equal(b.pres.slides[0].content.title, 'Links Eerste rechts');

  // …but B is still focused in the field: the input element still holds
  // B's own value ('Eerste rechts'), so B's next keystroke makes the form's
  // onChange write the input's WHOLE value. The binder diffs that against
  // the merged shadow and deletes A's characters — field-level
  // last-writer-wins while focused (the accepted step-3 fallback until a
  // caret-mapped Y.Text binding exists).
  b.pres.slides[0].content.title = 'Eerste rechts!';
  b.binder.syncLocal();

  exchange(a, b);
  assertConverged(a, b);
  assert.equal(
    a.pres.slides[0].content.title,
    'Eerste rechts!',
    "the focused user's value wins; the other user's characters are gone"
  );
});

test('adding a language version concurrent with content edits: both survive', () => {
  const [a, b] = makeReplicas();

  // A creates the en-GB version (the editor's add-language flow shape)…
  a.pres.i18n.versions['en-GB'] = { title: 'Conflict deck EN', slides: [] };
  a.binder.syncLocal();

  // …while B types in the NL content.
  b.pres.slides[0].content.title = 'Eerste (bewerkt)';
  b.binder.syncLocal();

  exchange(a, b);
  assertConverged(a, b);
  assert.ok(codec.getDocLangs(a.doc).includes('en-GB'), 'language version added');
  assert.equal(a.pres.slides[0].content.title, 'Eerste (bewerkt)', 'NL edit survives');
  const en = a.binder.projectLanguage('en-GB');
  assert.equal(en.title, 'Conflict deck EN');
  assert.deepEqual(
    en.slides.map((s) => s.id),
    a.pres.slides.map((s) => s.id),
    'the new version shares the (edited) structure'
  );
});

test('server translate (three-way apply) vs concurrent client edit: both survive', () => {
  const pres = fixturePres();
  pres.i18n.versions['en-GB'] = { title: 'Conflict deck EN', slides: [] };
  const [a, b] = makeReplicas(pres);

  // The server's write is based on the stored JSON of this moment.
  const base = codec.projectDocToPresentation(a.doc);

  // B types into an NL field before the translate lands anywhere.
  b.pres.slides[0].content.body = 'body een (bewerkt door B)';
  b.binder.syncLocal();

  // Server-side translate fills the EN texts (the translate endpoints'
  // write shape), applied to A's replica the way live-apply does: a
  // three-way diff against the base.
  const next = structuredClone(base);
  next.i18n.versions['en-GB'].slides = structuredClone(next.slides).map((s) => {
    if (typeof s?.content?.title === 'string') s.content.title = `EN ${s.content.title}`;
    if (typeof s?.content?.body === 'string') s.content.body = `EN ${s.content.body}`;
    return s;
  });
  const { warnings } = codec.applyPresentationToDoc(next, a.doc, { base });
  assert.deepEqual(warnings, []);

  exchange(a, b);
  assertConverged(a, b);
  assert.equal(
    a.pres.slides[0].content.body,
    'body een (bewerkt door B)',
    "B's concurrent NL edit survives the translate"
  );
  const en = b.binder.projectLanguage('en-GB');
  assert.equal(en.slides[0].content.title, 'EN Eerste', 'the translation landed');
  // The translate was based on the pre-edit body — the EN buffer holds the
  // translation of the base text, not of B's concurrent edit (the next
  // translate run picks that up). Pin that too.
  assert.equal(en.slides[0].content.body, 'EN body een');
});
