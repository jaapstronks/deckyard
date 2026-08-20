/**
 * Slides entering a *new* deck re-derive their instance-bound content keys.
 *
 * `rekeyOnClone` (shared/slide-types/clone.js) says which content keys belong
 * to one slide instance — `poll-slide.pollId`, `follow-invite-slide
 * .presentationId`. The editor honoured it on every copy path; the two server
 * paths that also mint a deck full of someone else's slides did not, so a
 * library item carrying a `pollId` handed every deck composed from it the same
 * live poll, and a duplicated deck's follow-invite QR still pointed at the
 * original.
 *
 * This gates the server half: the create path (compose, and any agent posting
 * `slides[]`), one value per slide across every language version, and the
 * nesting that came with it.
 *
 * Run with: node --test tests/new-deck-slide-rekey.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSlidesFromLibraryItems } from '../client/lib/slide-library/compose.js';
import { prepareNewPresentation } from '../server/storage/presentations/crud/factory.js';
import { rekeyNewDeckSlides } from '../server/storage/presentations/crud/rekey-new-deck.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

describe('composing a deck from library items', () => {
  it('re-mints the poll id, in every language version, to one value', async () => {
    const slides = buildSlidesFromLibraryItems([
      {
        slideType: 'poll-slide',
        content: { pollId: 'from-the-library', question: 'Hoe?' },
        i18n: {
          versions: {
            nl: { content: { pollId: 'from-the-library', question: 'Hoe?' } },
            'en-GB': {
              content: { pollId: 'from-the-library', question: 'How?' },
            },
          },
        },
      },
    ]);

    const pres = await prepareNewPresentation(repoRoot, {
      title: 'Composed deck',
      slides,
      theme: 'amethyst',
      lang: 'nl',
    });

    const nl = pres.i18n.versions.nl.slides[0];
    const en = pres.i18n.versions['en-GB'].slides[0];
    assert.notEqual(nl.content.pollId, 'from-the-library', 'rekeyed');
    assert.ok(nl.content.pollId, 'a fresh id, not an empty one');
    assert.equal(
      en.content.pollId,
      nl.content.pollId,
      'one slide, one poll — the translations must not answer different polls',
    );
    assert.equal(pres.slides[0].content.pollId, nl.content.pollId);
    // Only the declared key moved.
    assert.equal(nl.content.question, 'Hoe?');
    assert.equal(en.content.question, 'How?');
  });

  it('gives two decks composed from one item two different polls', async () => {
    const items = [
      { slideType: 'poll-slide', content: { pollId: 'from-the-library' } },
    ];
    const body = {
      title: 'Composed deck',
      slides: buildSlidesFromLibraryItems(items),
      theme: 'amethyst',
      lang: 'nl',
    };
    const first = await prepareNewPresentation(repoRoot, body);
    const second = await prepareNewPresentation(repoRoot, {
      ...body,
      slides: buildSlidesFromLibraryItems(items),
    });
    assert.notEqual(
      first.slides[0].content.pollId,
      second.slides[0].content.pollId,
    );
  });

  it('leaves a type that declares nothing alone', async () => {
    const pres = await prepareNewPresentation(repoRoot, {
      title: 'Composed deck',
      slides: buildSlidesFromLibraryItems([
        { slideType: 'content-slide', content: { title: 'Solo' } },
      ]),
      theme: 'amethyst',
      lang: 'nl',
    });
    assert.deepEqual(pres.slides[0].content, { title: 'Solo' });
  });
});

describe('posting slides straight to the create path', () => {
  it('points a follow-invite slide at the deck it lands in', async () => {
    const pres = await prepareNewPresentation(repoRoot, {
      title: 'Agent deck',
      slides: [
        {
          type: 'follow-invite-slide',
          content: { presentationId: 'some-other-deck' },
        },
      ],
      theme: 'amethyst',
      lang: 'nl',
    });
    assert.equal(pres.slides[0].content.presentationId, pres.id);
  });

  it('keeps a nested slide nested, on the new ids', async () => {
    const pres = await prepareNewPresentation(repoRoot, {
      title: 'Agent deck',
      slides: [
        { id: 'p', type: 'content-slide', content: { title: 'P' } },
        {
          id: 'c',
          parentId: 'p',
          type: 'content-slide',
          content: { title: 'C' },
        },
      ],
      theme: 'amethyst',
      lang: 'nl',
    });
    const [parent, child] = pres.slides;
    assert.notEqual(parent.id, 'p', 'the deck mints its own ids');
    assert.equal(parent.parentId, null);
    assert.equal(child.parentId, parent.id, 'nesting survives the new ids');
  });

  it('detaches a child whose parent was not posted with it', async () => {
    const pres = await prepareNewPresentation(repoRoot, {
      title: 'Agent deck',
      slides: [
        { id: 'c', parentId: 'elsewhere', type: 'content-slide', content: {} },
      ],
      theme: 'amethyst',
      lang: 'nl',
    });
    assert.equal(
      pres.slides[0].parentId,
      null,
      'a parent id from another deck is not a parent',
    );
  });

  it('does not write into the posted slides', async () => {
    const posted = [{ type: 'poll-slide', content: { pollId: 'caller-owns' } }];
    await prepareNewPresentation(repoRoot, {
      title: 'Agent deck',
      slides: posted,
      theme: 'amethyst',
      lang: 'nl',
    });
    assert.equal(posted[0].content.pollId, 'caller-owns');
  });
});

describe('rekeyNewDeckSlides', () => {
  it('agrees across a deck copy that holds each slide twice', () => {
    // The shape duplicatePresentationRow hands it: top-level slides plus one
    // i18n version per language, the same slide ids in each.
    const deck = {
      id: 'the-copy',
      slides: [
        { id: 's1', type: 'poll-slide', content: { pollId: 'old' } },
        {
          id: 's2',
          type: 'follow-invite-slide',
          content: { presentationId: 'the-original' },
        },
      ],
      i18n: {
        versions: {
          nl: {
            slides: [
              { id: 's1', type: 'poll-slide', content: { pollId: 'old' } },
              {
                id: 's2',
                type: 'follow-invite-slide',
                content: { presentationId: 'the-original' },
              },
            ],
          },
          'en-GB': {
            slides: [
              { id: 's1', type: 'poll-slide', content: { pollId: 'old' } },
            ],
          },
        },
      },
    };
    rekeyNewDeckSlides(deck);

    const pollIds = new Set([
      deck.slides[0].content.pollId,
      deck.i18n.versions.nl.slides[0].content.pollId,
      deck.i18n.versions['en-GB'].slides[0].content.pollId,
    ]);
    assert.equal(pollIds.size, 1, 'one slide id, one poll id');
    assert.ok(!pollIds.has('old'), 'and not the one it was copied from');
    assert.equal(deck.slides[1].content.presentationId, 'the-copy');
    assert.equal(
      deck.i18n.versions.nl.slides[1].content.presentationId,
      'the-copy',
    );
  });

  it('accepts a deck with no i18n versions and no slides', () => {
    assert.doesNotThrow(() => rekeyNewDeckSlides({ id: 'x' }));
    const deck = { id: 'x', slides: [] };
    assert.equal(rekeyNewDeckSlides(deck), deck);
  });

  it('resolves the type through the registry, canonical id included', () => {
    const deck = {
      id: 'deck-9',
      slides: [
        {
          id: 's1',
          type: 'eu.deckyard.slide.poll',
          content: { pollId: 'old' },
        },
      ],
    };
    rekeyNewDeckSlides(deck);
    assert.notEqual(deck.slides[0].content.pollId, 'old');
  });
});
