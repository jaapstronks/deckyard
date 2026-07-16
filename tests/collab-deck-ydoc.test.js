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
import { createDeckYdocCodec, textFieldSpecForType } from '../shared/collab/deck-ydoc.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';

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
    scope: 'private',
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
    scope: 'workspace',
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
    assert.deepEqual([...list.items.get('items').textKeys].sort(), ['text', 'title']);

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
    assert.equal(projected.i18n.versions['en-GB'].slides[0].content.subheading, '');
    assert.equal(projected.i18n.versions.nl.slides[0].content.subheading, 'onderkop');
  });

  it('preserves a translation that only exists in a non-dominant version', () => {
    const pres = normalizeTopLevel(twoLangDeck());
    delete pres.i18n.versions.nl.slides[0].content.subheading;
    pres.slides = pres.i18n.versions.nl.slides;
    const { projected } = roundTrip(pres);
    assert.equal(projected.i18n.versions['en-GB'].slides[0].content.subheading, 'subheading');
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
            slides: [{
              id: 's1',
              type: 'text-blocks-slide',
              content: {
                title: 'Aanpak',
                rows: [{
                  title: 'Fase 1',
                  color: 'yellow',
                  arrow: 'down',
                  blocks: [
                    { title: 'Onderzoek', body: 'We kijken rond' },
                    { title: 'Bouw', body: 'We bouwen' },
                  ],
                }],
              },
              notes: '',
            }],
          },
          'en-GB': {
            title: 'Blocks',
            slides: [{
              id: 's1',
              type: 'text-blocks-slide',
              content: {
                title: 'Approach',
                rows: [{
                  title: 'Phase 1',
                  color: 'yellow',
                  arrow: 'down',
                  blocks: [
                    { title: 'Research', body: 'We look around' },
                    { title: 'Build', body: 'We build' },
                  ],
                }],
              },
              notes: '',
            }],
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
    assert.equal(blocks.get(0).get('body').get('en-GB').toString(), 'We look around');
    assert.equal(rows.get(0).get('color'), 'yellow', 'enum stays a single plain value');
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

  it('warns when a plain (e.g. hidden/deprecated) field diverges between versions', () => {
    const pres = normalizeTopLevel(twoLangDeck());
    // `variant` is an enum (plain LWW); legacy decks can have diverged here,
    // as can deprecated `hidden` fields, which are also kept plain.
    pres.i18n.versions['en-GB'].slides[0].content.variant = 'bullets';
    const { projected, warnings } = roundTrip(pres);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /plain field 'variant' differs in version 'en-GB'/);
    assert.equal(projected.i18n.versions['en-GB'].slides[0].content.variant, 'numbers', 'dominant wins');
  });

  it('lets the dominant type win on a type mismatch, with a warning', () => {
    const pres = normalizeTopLevel(twoLangDeck());
    pres.i18n.versions['en-GB'].slides[1].type = 'content-slide';
    const { projected, warnings } = roundTrip(pres);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /type 'content-slide' in version 'en-GB' differs/);
    assert.equal(projected.i18n.versions['en-GB'].slides[1].type, 'quote-slide');
  });
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
    docA.getArray('slides').get(0).get('content').get('title').get('nl').insert(0, 'Belangrijke ');
    docB.getArray('slides').get(0).get('content').get('title').get('en-GB').insert(0, 'Key ');
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const projA = codec.projectDocToPresentation(docA);
    const projB = codec.projectDocToPresentation(docB);
    assert.deepStrictEqual(projA, projB);
    assert.equal(projA.i18n.versions.nl.slides[0].content.title, 'Belangrijke Punten');
    assert.equal(projA.i18n.versions['en-GB'].slides[0].content.title, 'Key Points');
  });
});

describe('round-trip: every registered slide type with real defaults', () => {
  // Builds one bilingual deck containing every slide type's realistic
  // default content (nl structure; en-GB texts overlaid per the same
  // classification the editor's language-sync uses). Catches content shapes
  // the hand-written fixtures miss (charts, tables, freeform, images…).
  function overlayTexts(content, spec, fn) {
    for (const k of spec.textKeys) {
      if (typeof content[k] === 'string') content[k] = fn(content[k]);
    }
    for (const [k, sub] of spec.items) {
      if (!Array.isArray(content[k])) continue;
      for (const item of content[k]) {
        if (item && typeof item === 'object' && !Array.isArray(item)) overlayTexts(item, sub, fn);
      }
    }
  }

  it('round-trips a deck containing all slide types losslessly', () => {
    const types = Object.keys(SLIDE_TYPES);
    assert.ok(types.length >= 30, `expected the full registry, got ${types.length}`);

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
      overlayTexts(clone.content, textFieldSpecForType(s.type), (v) => (v ? `EN: ${v}` : v));
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
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

  function stripVolatile(pres) {
    const p = JSON.parse(JSON.stringify(pres));
    if (p.i18n) delete p.i18n.progress;
    // `active` is per-client editor state: the codec deliberately does not
    // round-trip it (projection emits active = dominant).
    if (p.i18n) delete p.i18n.active;
    return p;
  }

  it(`round-trips ${files.length} local deck(s)`, { skip: files.length === 0 }, () => {
    for (const f of files) {
      const pres = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const { projected } = roundTrip(pres);
      assert.deepStrictEqual(
        stripVolatile(projected),
        stripVolatile(pres),
        `round-trip mismatch for ${f}`
      );
    }
  });
});
