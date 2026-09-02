/**
 * Round-trip tests for the deck ⇄ Y.Doc codec (collab phase 2, step 1).
 *
 * The contract under test (ADR 001 §4): JSON → Y.Doc → JSON is lossless for
 * decks whose language versions are structurally in sync (which is what the
 * editor's language-sync guarantees), including `i18n.versions` projection;
 * structurally divergent versions are normalized to the dominant structure
 * with warnings instead of silently corrupting.
 *
 * Run with: node --test tests/collab-deck-ydoc.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import * as Y from 'yjs';
import { createDeckYdocCodec } from '../shared/collab/deck-ydoc.js';
import { textFieldSpecForType } from '../shared/slide-types/text-fields.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  CURRENT_SCHEMA_VERSION,
  migratePresentation,
} from '../shared/slide-types/schema-version.js';

const codec = createDeckYdocCodec(Y);

function roundTrip(pres) {
  const doc = new Y.Doc();
  const { warnings } = codec.bootstrapPresentationToDoc(pres, doc);
  return { projected: codec.projectDocToPresentation(doc), warnings, doc };
}

/** Sync a doc into a fresh one via a real yjs update (CRDT wire format). */
function syncToFreshDoc(doc) {
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, Y.encodeStateAsUpdate(doc));
  return fresh;
}

// ── fixtures ───────────────────────────────────────────────────────────────

function singleLangDeck() {
  return {
    id: 'deck-1',
    title: 'Enkel Nederlands',
    lang: 'nl',
    theme: 'default',
    visibility: 'private',
    ownerEmail: 'owner@example.com',
    revision: 3,
    settings: { transitions: { preset: 'fade' } },
    slides: [
      {
        id: 's1',
        type: 'title-slide',
        content: { title: 'Hallo', speaker: 'Jaap' },
        notes: 'welkom iedereen',
      },
      {
        id: 's2',
        type: 'list-slide',
        content: {
          title: 'Lijstje',
          subheading: '',
          variant: 'bullets',
          layout: 'auto',
          items: [
            { title: 'Een', text: 'eerste punt' },
            { title: 'Twee', text: '' },
          ],
        },
        notes: '',
      },
    ],
  };
}

function twoLangDeck() {
  return {
    id: 'deck-2',
    title: 'Tweetalig deck',
    lang: 'nl',
    theme: 'default',
    visibility: 'organization',
    revision: 12,
    slides: [], // filled from dominant below, mirrors normalizeI18n
    i18n: {
      dominant: 'nl',
      active: 'nl',
      progress: { updatedAt: '2026-07-01T10:00:00.000Z', hasIncomplete: false },
      versions: {
        nl: {
          title: 'Tweetalig deck',
          slides: [
            {
              id: 's1',
              type: 'list-slide',
              content: {
                title: 'Punten',
                subheading: 'onderkop',
                variant: 'numbers',
                layout: 'two-column',
                items: [
                  { title: 'Eén', text: 'eerste' },
                  { title: 'Twee', text: 'tweede' },
                ],
              },
              notes: 'nl notities',
            },
            {
              id: 's2',
              type: 'quote-slide',
              content: { quote: 'Doe maar gewoon', attribution: 'Iemand' },
              notes: '',
            },
          ],
        },
        'en-GB': {
          title: 'Bilingual deck',
          slides: [
            {
              id: 's1',
              type: 'list-slide',
              content: {
                title: 'Points',
                subheading: 'subheading',
                variant: 'numbers',
                layout: 'two-column',
                items: [
                  { title: 'One', text: 'first' },
                  { title: 'Two', text: '' },
                ],
              },
              notes: 'en notes',
            },
            {
              id: 's2',
              type: 'quote-slide',
              content: { quote: 'Just act normal', attribution: 'Iemand' },
              notes: '',
            },
          ],
        },
      },
    },
  };
}

/**
 * The prose a legacy bilingual deck carries, per language. Every string here is
 * translated — if one of them projects back empty, a translation was lost.
 */
const LEGACY_PROSE = {
  nl: {
    title: 'Oude vormen',
    processTitle: 'Zo werkt het',
    stepTitle: 'Verkennen',
    stepText: 'Eerst kijken we rond.',
    teamTitle: 'Ons team',
    cardName: 'Ferry Hogeboom',
    cardByline: 'Projectleider community & events',
    cardAlt: 'Ferry kijkt lachend in de camera.',
    logoTitle: 'Onze partners',
    logoName: 'Hogeschool',
    logoAlt: 'Het logo van de hogeschool.',
    controlName: 'Ada Lovelace',
    controlByline: 'Rekenkundige',
    controlAlt: 'Ada in profiel.',
    chapterTitle: 'Hoofdstuk twee',
    chapterSub: 'Waar we nu staan',
    pollQuestion: 'Wat vind je ervan?',
    pollYes: 'Eens',
    pollNo: 'Oneens',
    stackTitle: 'Drie kaarten',
    stackCardTitle: 'Eerste kaart',
    stackCardBody: 'De kaart met het langste verhaal.',
    quoteText: 'Wie het weet mag het zeggen.',
    quoteSubtitle: 'Uit het jaarverslag',
  },
  'en-GB': {
    title: 'Legacy shapes',
    processTitle: 'How it works',
    stepTitle: 'Explore',
    stepText: 'First we look around.',
    teamTitle: 'Our team',
    cardName: 'Ferry Hogeboom',
    cardByline: 'Community & events project lead',
    cardAlt: 'Ferry smiles into the camera.',
    logoTitle: 'Our partners',
    logoName: 'University',
    logoAlt: 'The university logo.',
    controlName: 'Ada Lovelace',
    controlByline: 'Mathematician',
    controlAlt: 'Ada in profile.',
    chapterTitle: 'Chapter two',
    chapterSub: 'Where we stand',
    pollQuestion: 'What do you think?',
    pollYes: 'Agree',
    pollNo: 'Disagree',
    stackTitle: 'Three cards',
    stackCardTitle: 'First card',
    stackCardBody: 'The card with the longest story.',
    quoteText: 'Whoever knows may say so.',
    quoteSubtitle: 'From the annual report',
  },
};

/** The slides of one language version of `legacyBilingualDeck()`. */
function legacySlides(lang) {
  const s = LEGACY_PROSE[lang];
  return [
    // v6 shape: the collection still lives under `steps`, never under `items`.
    {
      id: 's-process',
      type: 'process-slide',
      content: {
        title: s.processTitle,
        direction: 'horizontal',
        steps: [{ title: s.stepTitle, text: s.stepText }],
      },
      notes: '',
    },
    // v7 shape: the numbered `card*` family, bounded by `cardCount`.
    {
      id: 's-team',
      type: 'team-cards-slide',
      content: {
        title: s.teamTitle,
        cardCount: 1,
        card1Image: '/uploads/ferry.jpg',
        card1Name: s.cardName,
        card1Byline: s.cardByline,
        card1Alt: s.cardAlt,
      },
      notes: '',
    },
    // v7 shape: the numbered `logo*` family, a second family in the same deck.
    {
      id: 's-logos',
      type: 'logo-wall-slide',
      content: {
        title: s.logoTitle,
        logoCount: 1,
        logo1Image: '/uploads/hogeschool.svg',
        logo1Name: s.logoName,
        logo1Alt: s.logoAlt,
      },
      notes: '',
    },
    // Control: the same type, already folded into the canonical v8 array. The
    // migration must leave it exactly as it is.
    {
      id: 's-control',
      type: 'team-cards-slide',
      content: {
        title: s.teamTitle,
        members: [
          {
            image: '/uploads/ada.jpg',
            name: s.controlName,
            byline: s.controlByline,
            alt: s.controlAlt,
            imageFocusX: 50,
            imageFocusY: 50,
          },
        ],
      },
      notes: '',
    },
    // v8 shape: the bare `option1..` slots the v7 -> v8 regex let through.
    {
      id: 's-poll',
      type: 'poll-slide',
      content: {
        question: s.pollQuestion,
        option1: s.pollYes,
        option2: s.pollNo,
      },
      notes: '',
    },
    // v9 shape: the pre-rename `subtitle`, on a type that declares `subheading`
    // (#1040 measured 20 translated strings lost under this key).
    {
      id: 's-chapter',
      type: 'chapter-title-slide',
      content: { title: s.chapterTitle, subtitle: s.chapterSub },
      notes: '',
    },
    // A retired type: `card-stack-slide` is not in the register, so it
    // declares nothing at all — not even `title`. Every key here is
    // undeclared, and the value rule is the only thing that can tell the
    // prose (`title`, `card1Title`, `card1Body`) from the machine value
    // (`cardCount`, the same number in both versions). D79 / B211 part 2.
    {
      id: 's-stack',
      type: 'card-stack-slide',
      content: {
        title: s.stackTitle,
        cardCount: 2,
        card1Title: s.stackCardTitle,
        card1Body: s.stackCardBody,
      },
      notes: '',
    },
    // A registered type carrying `subtitle` — which it does not declare, and
    // which the v9 -> v10 fold therefore leaves alone (it is scoped to types
    // that declare `subheading`). Dead remnant, but prose. `legacyColumns`
    // beside it is the machine value the versions disagree on: it stays one
    // per deck, the dominant version wins, and that is warned about.
    {
      id: 's-quote',
      type: 'quote-slide',
      content: {
        quote: s.quoteText,
        subtitle: s.quoteSubtitle,
        legacyColumns: lang === 'nl' ? 3 : 2,
      },
      notes: '',
    },
  ];
}

/**
 * A bilingual deck as an install predating v8 actually stores it: no schema
 * stamp, both language versions in the legacy shapes, and a top-level `slides`
 * that is a *copy* of the dominant version — which is what a fresh JSON parse
 * gives you, references and all (#1040).
 */
function legacyBilingualDeck() {
  const versions = {
    nl: { title: LEGACY_PROSE.nl.title, slides: legacySlides('nl') },
    'en-GB': {
      title: LEGACY_PROSE['en-GB'].title,
      slides: legacySlides('en-GB'),
    },
  };
  return {
    id: 'deck-legacy',
    title: versions.nl.title,
    lang: 'nl',
    theme: 'default',
    visibility: 'private',
    slides: structuredClone(versions.nl.slides),
    i18n: { dominant: 'nl', active: 'nl', versions },
  };
}

// Mirror what normalizeI18n does: top-level = dominant version.
function normalizeTopLevel(pres) {
  const dom = pres.i18n?.versions?.[pres.i18n?.dominant];
  if (dom) {
    pres.title = dom.title;
    pres.slides = dom.slides;
  }
  return pres;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('textFieldSpecForType', () => {
  it('classifies top-level string/markdown fields as text', () => {
    const spec = textFieldSpecForType('list-slide');
    assert.ok(spec.textKeys.has('title'));
    assert.ok(spec.textKeys.has('subheading'));
    assert.ok(!spec.textKeys.has('variant'), 'enum stays plain');
    assert.ok(!spec.textKeys.has('items'), 'items handled separately');
  });

  it('classifies item text keys, recursively for nested items', () => {
    const list = textFieldSpecForType('list-slide');
    assert.deepEqual([...list.items.get('items').textKeys].sort(), [
      'text',
      'title',
    ]);

    const blocks = textFieldSpecForType('text-blocks-slide');
    const rows = blocks.items.get('rows');
    assert.ok(rows.textKeys.has('title'));
    assert.ok(!rows.textKeys.has('color'), 'enum stays plain');
    const nested = rows.items.get('blocks');
    assert.ok(nested.textKeys.has('title'));
    assert.ok(nested.textKeys.has('body'));
  });

  it('unknown types get an empty spec (all plain LWW)', () => {
    const spec = textFieldSpecForType('no-such-slide');
    assert.equal(spec.textKeys.size, 0);
    assert.equal(spec.items.size, 0);
  });
});

describe('round-trip: single-language deck (no i18n block)', () => {
  it('reproduces the deck exactly, without inventing an i18n block', () => {
    const pres = singleLangDeck();
    const { projected, warnings } = roundTrip(pres);
    assert.deepStrictEqual(projected, pres);
    assert.equal(warnings.length, 0);
    assert.ok(!('i18n' in projected));
  });
});

describe('round-trip: two-language deck', () => {
  it('reproduces both versions and the dominant top-level exactly', () => {
    const pres = normalizeTopLevel(twoLangDeck());
    const { projected, warnings } = roundTrip(pres);
    assert.deepStrictEqual(projected, pres);
    assert.equal(warnings.length, 0);
  });

  it('stores structure once: shared plain fields, per-language text', () => {
    const { doc } = roundTrip(normalizeTopLevel(twoLangDeck()));
    const slide = doc.getArray('slides').get(0);
    const content = slide.get('content');
    assert.equal(content.get('variant'), 'numbers', 'enum is one plain value');
    const title = content.get('title');
    assert.ok(title instanceof Y.Map, 'text field is a lang map');
    assert.equal(title.get('nl').toString(), 'Punten');
    assert.equal(title.get('en-GB').toString(), 'Points');
    const items = content.get('items');
    assert.ok(items instanceof Y.Array, 'items are one shared array');
    assert.equal(items.length, 2);
    assert.equal(items.get(0).get('title').get('en-GB').toString(), 'One');
  });

  it('keeps notes per language', () => {
    const { doc } = roundTrip(normalizeTopLevel(twoLangDeck()));
    const notes = doc.getArray('slides').get(0).get('notes');
    assert.equal(notes.get('nl').toString(), 'nl notities');
    assert.equal(notes.get('en-GB').toString(), 'en notes');
  });

  it('projects an empty string for a language a text lacks', () => {
    const pres = normalizeTopLevel(twoLangDeck());
    delete pres.i18n.versions['en-GB'].slides[0].content.subheading;
    const { projected } = roundTrip(pres);
    assert.equal(
      projected.i18n.versions['en-GB'].slides[0].content.subheading,
      '',
    );
    assert.equal(
      projected.i18n.versions.nl.slides[0].content.subheading,
      'onderkop',
    );
  });

  it('preserves a translation that only exists in a non-dominant version', () => {
    const pres = normalizeTopLevel(twoLangDeck());
    delete pres.i18n.versions.nl.slides[0].content.subheading;
    pres.slides = pres.i18n.versions.nl.slides;
    const { projected } = roundTrip(pres);
    assert.equal(
      projected.i18n.versions['en-GB'].slides[0].content.subheading,
      'subheading',
    );
  });
});

describe('round-trip: nested items (text-blocks rows/blocks)', () => {
  it('keeps nested block texts per language', () => {
    const pres = {
      id: 'deck-3',
      title: 'Blokken',
      lang: 'nl',
      slides: [],
      i18n: {
        active: 'nl',
        dominant: 'nl',
        versions: {
          nl: {
            title: 'Blokken',
            slides: [
              {
                id: 's1',
                type: 'text-blocks-slide',
                content: {
                  title: 'Aanpak',
                  rows: [
                    {
                      title: 'Fase 1',
                      color: 'yellow',
                      arrow: 'down',
                      blocks: [
                        { title: 'Onderzoek', body: 'We kijken rond' },
                        { title: 'Bouw', body: 'We bouwen' },
                      ],
                    },
                  ],
                },
                notes: '',
              },
            ],
          },
          'en-GB': {
            title: 'Blocks',
            slides: [
              {
                id: 's1',
                type: 'text-blocks-slide',
                content: {
                  title: 'Approach',
                  rows: [
                    {
                      title: 'Phase 1',
                      color: 'yellow',
                      arrow: 'down',
                      blocks: [
                        { title: 'Research', body: 'We look around' },
                        { title: 'Build', body: 'We build' },
                      ],
                    },
                  ],
                },
                notes: '',
              },
            ],
          },
        },
      },
    };
    normalizeTopLevel(pres);
    const { projected, warnings } = roundTrip(pres);
    assert.deepStrictEqual(projected, pres);
    assert.equal(warnings.length, 0);

    // And the doc stores the nested structure once.
    const { doc } = roundTrip(pres);
    const rows = doc.getArray('slides').get(0).get('content').get('rows');
    const blocks = rows.get(0).get('blocks');
    assert.equal(
      blocks.get(0).get('body').get('en-GB').toString(),
      'We look around',
    );
    assert.equal(
      rows.get(0).get('color'),
      'yellow',
      'enum stays a single plain value',
    );
  });
});

describe('divergent versions are normalized with warnings, not corrupted', () => {
  it('drops a slide that only exists in a non-dominant version, with a warning', () => {
    const pres = normalizeTopLevel(twoLangDeck());
    pres.i18n.versions['en-GB'].slides.push({
      id: 's-extra',
      type: 'quote-slide',
      content: { quote: 'Only in English' },
      notes: '',
    });
    const { projected, warnings } = roundTrip(pres);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /s-extra.*only exists in version 'en-GB'/);
    assert.equal(projected.i18n.versions['en-GB'].slides.length, 2);
  });

  it('warns when a plain field diverges between versions', () => {
    const pres = normalizeTopLevel(twoLangDeck());
    // `variant` is an enum (plain LWW); legacy decks can have diverged here.
    pres.i18n.versions['en-GB'].slides[0].content.variant = 'bullets';
    const { projected, warnings } = roundTrip(pres);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /plain field 'variant' differs in version 'en-GB'/,
    );
    assert.equal(
      projected.i18n.versions['en-GB'].slides[0].content.variant,
      'numbers',
      'dominant wins',
    );
  });

  it('keeps a hidden prose mirror per language instead of collapsing it', () => {
    // Regression: `hidden` used to classify a field as "machine value, one per
    // deck", which collapsed `text-blocks-slide`'s numbered mirror of
    // translatable prose to the dominant language on the first collab edit.
    // Reported by the CIIIC fork against a real bilingual deck.
    const hiddenTextKey = SLIDE_TYPES['text-blocks-slide'].fields.find(
      (f) => f.hidden === true && f.type === 'string',
    )?.key;
    assert.ok(hiddenTextKey, 'fixture assumes a hidden string field exists');

    const pres = normalizeTopLevel(twoLangDeck());
    for (const [lang, version] of Object.entries(pres.i18n.versions)) {
      version.slides.push({
        id: 's-blocks',
        type: 'text-blocks-slide',
        content: { [hiddenTextKey]: lang === 'nl' ? 'Kopje' : 'Heading' },
        notes: '',
      });
    }
    pres.slides = pres.i18n.versions.nl.slides;

    const { projected, warnings } = roundTrip(pres);
    assert.deepStrictEqual(warnings, []);
    assert.equal(
      projected.i18n.versions.nl.slides[2].content[hiddenTextKey],
      'Kopje',
    );
    assert.equal(
      projected.i18n.versions['en-GB'].slides[2].content[hiddenTextKey],
      'Heading',
      'the English mirror must survive the round-trip',
    );
  });

  it('lets the dominant type win on a type mismatch, with a warning', () => {
    const pres = normalizeTopLevel(twoLangDeck());
    pres.i18n.versions['en-GB'].slides[1].type = 'content-slide';
    const { projected, warnings } = roundTrip(pres);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /type 'content-slide' in version 'en-GB' differs/,
    );
    assert.equal(
      projected.i18n.versions['en-GB'].slides[1].type,
      'quote-slide',
    );
  });
});

describe('legacy shapes survive the read path in every language (#1040)', () => {
  // Regression, B211 part 1. `migratePresentation()` walked `pres.slides` only,
  // so the v6 -> v8 folds never reached `i18n.versions[*].slides`. The dominant
  // version came out with `items[]`/`members[]`/`logos[]`, the other one kept
  // the legacy slots — and because the type declares neither, the codec filed
  // them as "plain LWW value, one per deck" and the dominant language won. On
  // the CIIIC fork that silently emptied 465 translated strings.
  //
  // The deck below is pinned rather than read off disk: the opportunistic
  // "real local decks" check at the bottom of this file skips on CI, which is
  // why this shipped green.

  it('migrates every language version, not only the dominant one', () => {
    const deck = migratePresentation(legacyBilingualDeck());

    assert.equal(deck.schemaVersion, CURRENT_SCHEMA_VERSION);
    for (const [lang, version] of Object.entries(deck.i18n.versions)) {
      const prose = LEGACY_PROSE[lang];
      const [process, team, logos, control, poll, chapter] = version.slides;

      assert.deepStrictEqual(
        process.content.items,
        [{ title: prose.stepTitle, text: prose.stepText }],
        `${lang}: v6 steps folded into items`,
      );
      assert.ok(!('steps' in process.content), `${lang}: legacy key dropped`);

      assert.equal(team.content.members?.[0]?.name, prose.cardName);
      assert.equal(team.content.members?.[0]?.byline, prose.cardByline);
      assert.equal(team.content.members?.[0]?.alt, prose.cardAlt);
      assert.ok(!('card1Name' in team.content), `${lang}: slot keys dropped`);

      assert.equal(logos.content.logos?.[0]?.name, prose.logoName);
      assert.equal(logos.content.logos?.[0]?.alt, prose.logoAlt);
      assert.ok(!('logo1Name' in logos.content), `${lang}: slot keys dropped`);

      // The control slide was already canonical and must come out untouched.
      assert.deepStrictEqual(control.content.members, [
        {
          image: '/uploads/ada.jpg',
          name: prose.controlName,
          byline: prose.controlByline,
          alt: prose.controlAlt,
          imageFocusX: 50,
          imageFocusY: 50,
        },
      ]);

      assert.deepStrictEqual(
        poll.content.options,
        [{ text: prose.pollYes }, { text: prose.pollNo }],
        `${lang}: v8 option slots folded into options[]`,
      );
      assert.ok(!('option1' in poll.content), `${lang}: option keys dropped`);

      assert.equal(chapter.content.subheading, prose.chapterSub);
      assert.ok(!('subtitle' in chapter.content), `${lang}: subtitle renamed`);

      assert.ok(
        !('schemaVersion' in version),
        `${lang}: a version carries no stamp of its own — the deck does`,
      );
    }
  });

  // The two shapes a deck is in when it reaches the codec. As parsed from
  // storage, top-level `slides` is a separate array; after `normalizeI18n` it
  // *is* the dominant version's array. Before the fix each shape broke
  // differently: the first left both versions legacy and warned five times, the
  // second folded the dominant version only and lost the English prose in
  // silence — the case reported in #1040.
  const readShapes = {
    'as parsed from storage': () => migratePresentation(legacyBilingualDeck()),
    'as normalizeI18n leaves it in memory': () =>
      migratePresentation(normalizeTopLevel(legacyBilingualDeck())),
  };

  for (const [shape, buildDeck] of Object.entries(readShapes)) {
    it(`round-trips a migrated legacy deck losslessly, ${shape}`, () => {
      const deck = normalizeTopLevel(buildDeck());
      const { projected, warnings } = roundTrip(deck);

      // The one machine value the versions disagree on, and nothing else: not
      // the undeclared prose beside it, and not `cardCount`, which agrees.
      assert.deepStrictEqual(warnings, [
        "slide s-quote: plain field 'legacyColumns' differs in version 'en-GB' — dominant wins",
      ]);
      for (const lang of ['nl', 'en-GB']) {
        const prose = LEGACY_PROSE[lang];
        const [process, team, logos, control, poll, chapter, stack, quote] =
          projected.i18n.versions[lang].slides;

        assert.equal(process.content.items[0].title, prose.stepTitle, lang);
        assert.equal(process.content.items[0].text, prose.stepText, lang);
        assert.equal(team.content.members[0].name, prose.cardName, lang);
        assert.equal(team.content.members[0].byline, prose.cardByline, lang);
        assert.equal(team.content.members[0].alt, prose.cardAlt, lang);
        assert.equal(logos.content.logos[0].name, prose.logoName, lang);
        assert.equal(logos.content.logos[0].alt, prose.logoAlt, lang);
        assert.equal(
          control.content.members[0].byline,
          prose.controlByline,
          lang,
        );
        assert.equal(poll.content.question, prose.pollQuestion, lang);
        assert.equal(poll.content.options[0].text, prose.pollYes, lang);
        assert.equal(poll.content.options[1].text, prose.pollNo, lang);
        assert.equal(chapter.content.subheading, prose.chapterSub, lang);

        // Undeclared strings, on a retired type and on a registered one:
        // prose in every version, not one value per deck (D79).
        assert.equal(stack.content.title, prose.stackTitle, lang);
        assert.equal(stack.content.card1Title, prose.stackCardTitle, lang);
        assert.equal(stack.content.card1Body, prose.stackCardBody, lang);
        assert.equal(quote.content.subtitle, prose.quoteSubtitle, lang);
        assert.equal(quote.content.quote, prose.quoteText, lang);

        // Undeclared non-strings stay machine values: one per deck, the
        // dominant version's.
        assert.equal(stack.content.cardCount, 2, lang);
        assert.equal(quote.content.legacyColumns, 3, lang);
      }
    });
  }
});

describe('CRDT wire format', () => {
  it('a doc synced to a fresh doc via encodeStateAsUpdate projects identically', () => {
    const pres = normalizeTopLevel(twoLangDeck());
    const { doc } = roundTrip(pres);
    const fresh = syncToFreshDoc(doc);
    assert.deepStrictEqual(codec.projectDocToPresentation(fresh), pres);
  });

  it('concurrent text edits in two languages converge without clobbering', () => {
    const pres = normalizeTopLevel(twoLangDeck());
    const docA = new Y.Doc();
    codec.bootstrapPresentationToDoc(pres, docA);
    const docB = syncToFreshDoc(docA);

    // A edits the Dutch title, B edits the English title, concurrently.
    docA
      .getArray('slides')
      .get(0)
      .get('content')
      .get('title')
      .get('nl')
      .insert(0, 'Belangrijke ');
    docB
      .getArray('slides')
      .get(0)
      .get('content')
      .get('title')
      .get('en-GB')
      .insert(0, 'Key ');
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const projA = codec.projectDocToPresentation(docA);
    const projB = codec.projectDocToPresentation(docB);
    assert.deepStrictEqual(projA, projB);
    assert.equal(
      projA.i18n.versions.nl.slides[0].content.title,
      'Belangrijke Punten',
    );
    assert.equal(
      projA.i18n.versions['en-GB'].slides[0].content.title,
      'Key Points',
    );
  });
});

describe('round-trip: every registered slide type with real defaults', () => {
  // Builds one bilingual deck containing every slide type's realistic
  // default content (nl structure; en-GB texts overlaid per the same
  // classification the editor's language-sync uses). Catches content shapes
  // the hand-written fixtures miss (charts, tables, images…).
  function overlayTexts(content, spec, fn) {
    for (const k of spec.textKeys) {
      if (typeof content[k] === 'string') content[k] = fn(content[k]);
    }
    for (const [k, sub] of spec.items) {
      if (!Array.isArray(content[k])) continue;
      for (const item of content[k]) {
        if (item && typeof item === 'object' && !Array.isArray(item))
          overlayTexts(item, sub, fn);
      }
    }
  }

  it('round-trips a deck containing all slide types losslessly', () => {
    const types = Object.keys(SLIDE_TYPES);
    assert.ok(
      types.length >= 30,
      `expected the full registry, got ${types.length}`,
    );

    const nlSlides = types.map((type, i) => {
      const def = SLIDE_TYPES[type];
      const defaults = def?.defaultsByLang?.nl || def?.defaults || {};
      return {
        id: `s${i}`,
        type,
        content: JSON.parse(JSON.stringify(defaults)),
        notes: `notitie ${i}`,
      };
    });
    const enSlides = nlSlides.map((s) => {
      const clone = JSON.parse(JSON.stringify(s));
      overlayTexts(clone.content, textFieldSpecForType(s.type), (v) =>
        v ? `EN: ${v}` : v,
      );
      clone.notes = s.notes ? `EN ${s.notes}` : '';
      return clone;
    });

    const pres = normalizeTopLevel({
      id: 'deck-all-types',
      title: 'Alle types',
      lang: 'nl',
      slides: [],
      i18n: {
        active: 'nl',
        dominant: 'nl',
        versions: {
          nl: { title: 'Alle types', slides: nlSlides },
          'en-GB': { title: 'EN: Alle types', slides: enSlides },
        },
      },
    });

    const { projected, warnings } = roundTrip(pres);
    assert.equal(warnings.length, 0, warnings.join('\n'));
    assert.deepStrictEqual(projected, pres);
  });
});

describe('round-trip: real local decks (skipped when none present)', () => {
  // Opportunistic fidelity check against whatever decks exist in this
  // checkout's file storage. CI has none; locally this catches real-world
  // shapes the fixtures miss. Volatile/derived fields are ignored.
  const dir = path.join(process.cwd(), 'server', 'data', 'presentations');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    : [];

  function stripVolatile(pres) {
    const p = JSON.parse(JSON.stringify(pres));
    if (p.i18n) delete p.i18n.progress;
    // `active` is per-client editor state: the codec deliberately does not
    // round-trip it (projection emits active = dominant).
    if (p.i18n) delete p.i18n.active;
    return p;
  }

  it(
    `round-trips ${files.length} local deck(s)`,
    { skip: files.length === 0 },
    () => {
      for (const f of files) {
        const pres = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const { projected } = roundTrip(pres);
        assert.deepStrictEqual(
          stripVolatile(projected),
          stripVolatile(pres),
          `round-trip mismatch for ${f}`,
        );
      }
    },
  );
});
