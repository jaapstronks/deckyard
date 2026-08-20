/**
 * The save half of the `instanceKeys` declaration (A7.23).
 *
 * Copying a slide re-derives its instance-bound content keys — that half is
 * gated by tests/slide-clone-on-insert.test.js. *Saving* one writes the same
 * keys at a different moment, and the two write seams used to spell out by hand
 * what the type already declares: `normalizeSlides` minted a missing
 * `poll-slide.pollId` behind a `type === 'poll-slide'` check, and
 * `normalizeFollowInviteSlides` set `presentationId` behind a
 * `type === 'follow-invite-slide'` check. Two more places for the same fact to
 * drift, both below the three-name threshold of the name-branching gate.
 *
 * So the save seam reads the declaration too, and the *source* — not the type
 * name — decides how each key is written: `fresh-id` is minted only when
 * missing (the value addresses state kept outside the deck, so reminting it on
 * a save would abandon the answers collected under it), `presentation-id` is
 * re-derived every time (it caches something the writer knows for certain).
 *
 * This file gates that rule, both directly on the helper and end-to-end through
 * the write seams.
 *
 * Run with: node --test tests/slide-instance-keys-on-save.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyInstanceKeyDefaults } from '../shared/slide-types/instance-keys.js';
import { normalizeSlides } from '../server/storage/presentations/slides.js';
import { normalizeI18n } from '../server/storage/presentations/i18n.js';

const NEW_ID = () => 'minted-id';

test('fresh-id is minted only when the key holds nothing', () => {
  const def = { instanceKeys: { someId: 'fresh-id' } };

  const empty = { type: 'x', content: {} };
  assert.deepEqual(applyInstanceKeyDefaults(empty, { def, newId: NEW_ID }), [
    'someId',
  ]);
  assert.equal(empty.content.someId, 'minted-id');

  // An existing value survives: it is the address of state outside the deck.
  const held = { type: 'x', content: { someId: 'already-here' } };
  applyInstanceKeyDefaults(held, { def, newId: NEW_ID });
  assert.equal(held.content.someId, 'already-here');

  // Blank and whitespace-only count as nothing; a padded value is trimmed.
  const blank = { type: 'x', content: { someId: '   ' } };
  applyInstanceKeyDefaults(blank, { def, newId: NEW_ID });
  assert.equal(blank.content.someId, 'minted-id');

  const padded = { type: 'x', content: { someId: ' spaced ' } };
  applyInstanceKeyDefaults(padded, { def, newId: NEW_ID });
  assert.equal(padded.content.someId, 'spaced');
});

test('presentation-id is re-derived every save, and skipped without a deck', () => {
  const def = { instanceKeys: { deckId: 'presentation-id' } };

  const stale = { type: 'x', content: { deckId: 'some-other-deck' } };
  assert.deepEqual(
    applyInstanceKeyDefaults(stale, {
      def,
      presentationId: 'deck-1',
      newId: NEW_ID,
    }),
    ['deckId'],
  );
  assert.equal(stale.content.deckId, 'deck-1');

  // A writer that does not know which deck it is writing leaves the cache
  // alone rather than blanking it.
  const unknownDeck = { type: 'x', content: { deckId: 'some-other-deck' } };
  assert.deepEqual(
    applyInstanceKeyDefaults(unknownDeck, { def, newId: NEW_ID }),
    [],
  );
  assert.equal(unknownDeck.content.deckId, 'some-other-deck');
});

test('the save rule follows the declaration, not a type name', () => {
  // A type the seam has never heard of, declaring both sources.
  const def = {
    instanceKeys: { forkId: 'fresh-id', forkDeck: 'presentation-id' },
  };
  const slide = { type: 'fork-slide' };
  const written = applyInstanceKeyDefaults(slide, {
    def,
    presentationId: 'deck-1',
    newId: NEW_ID,
  });
  assert.deepEqual(written.sort(), ['forkDeck', 'forkId']);
  // Content is created when the slide arrived without any.
  assert.deepEqual(slide.content, { forkId: 'minted-id', forkDeck: 'deck-1' });

  // A source outside the closed vocabulary is ignored, not applied.
  const bogus = { type: 'fork-slide', content: {} };
  assert.deepEqual(
    applyInstanceKeyDefaults(bogus, {
      def: { instanceKeys: { nope: 'whatever-the-fork-wants' } },
      presentationId: 'deck-1',
      newId: NEW_ID,
    }),
    [],
  );
  assert.deepEqual(bogus.content, {});

  // A type that declares nothing is left exactly as it came in.
  const plain = { type: 'content-slide', content: { title: 'T' } };
  assert.deepEqual(
    applyInstanceKeyDefaults(plain, {
      def: {},
      presentationId: 'deck-1',
      newId: NEW_ID,
    }),
    [],
  );
  assert.deepEqual(plain.content, { title: 'T' });
});

test('normalizeSlides fills the declared keys of the core types', () => {
  const [poll, invite, plain] = normalizeSlides(
    [
      { id: 's1', type: 'poll-slide', content: { question: 'Q' } },
      {
        id: 's2',
        type: 'follow-invite-slide',
        content: { presentationId: 'an-older-deck' },
      },
      { id: 's3', type: 'content-slide', content: { title: 'T' } },
    ],
    { presentationId: 'deck-1' },
  );

  assert.match(poll.content.pollId, /[0-9a-f-]{36}/);
  assert.equal(invite.content.presentationId, 'deck-1');
  assert.deepEqual(plain.content, { title: 'T' });
});

test('normalizeSlides keeps a poll id across saves', () => {
  const stored = { id: 's1', type: 'poll-slide', content: { pollId: 'p-1' } };
  const once = normalizeSlides([stored], { presentationId: 'deck-1' });
  const twice = normalizeSlides(once, { presentationId: 'deck-1' });
  assert.equal(once[0].content.pollId, 'p-1');
  assert.equal(twice[0].content.pollId, 'p-1');
});

test('normalizeSlides leaves the deck cache alone when it is not told the deck', () => {
  const [invite] = normalizeSlides([
    {
      id: 's1',
      type: 'follow-invite-slide',
      content: { presentationId: 'an-older-deck' },
    },
  ]);
  assert.equal(invite.content.presentationId, 'an-older-deck');
});

test('a saved deck carries the same instance keys in every language version', () => {
  const pres = {
    id: 'deck-1',
    title: 'T',
    slides: [
      {
        id: 's1',
        type: 'follow-invite-slide',
        content: { enabled: true, presentationId: 'an-older-deck' },
      },
      { id: 's2', type: 'poll-slide', content: { question: 'Q' } },
    ],
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: { nl: { title: 'T', slides: [] } },
    },
  };
  normalizeI18n(pres);

  const nl = pres.i18n.versions.nl.slides;
  assert.equal(nl[0].content.presentationId, 'deck-1');
  assert.match(nl[1].content.pollId, /[0-9a-f-]{36}/);
  // Top-level is realigned to the dominant version, so it holds the same values.
  assert.equal(pres.slides[0].content.presentationId, 'deck-1');
  assert.equal(pres.slides[1].content.pollId, nl[1].content.pollId);

  // Saving again keeps the poll's address rather than minting a new one.
  const pollId = nl[1].content.pollId;
  normalizeI18n(pres);
  assert.equal(pres.i18n.versions.nl.slides[1].content.pollId, pollId);
});
