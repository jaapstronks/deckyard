/**
 * The portable deck carries no slide ids, so its export writes every in-deck
 * jump (`#slide:<id>` in a declared `url` field) as the positional `#N` on the
 * exported slide order (B494). These tests run the real round-trip
 * (`presentationToDeck` → `deckToPresentationParts` → `presentationToDeck`)
 * and check that each jump still lands on the slide it named, in every
 * language version and with slides filtered out of the export; a target that
 * is not in the export leaves no link that points nowhere.
 *
 * Run with: node --test tests/deck-export-slide-jumps.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deckImportLang,
  deckToPresentationParts,
  presentationToDeck,
} from '../shared/slide-types/deck.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { slideJumpTarget } from '../shared/slide-types/helpers.js';
import { assertValidImportedDeck } from '../server/services/slide-field-validation.js';

/** A stored deck in `nl` with an `en-GB` version whose prose differs. */
function storedDeck(slides, enText = (s) => `EN ${s}`) {
  const nl = slides;
  const en = nl.map((s) => ({
    ...s,
    content: translateStrings(s.content, enText),
  }));
  return {
    title: 'Sprongen',
    theme: 'default',
    lang: 'nl',
    slides: nl,
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: {
        nl: { title: 'Sprongen', slides: nl },
        'en-GB': { title: 'Jumps', slides: en },
      },
    },
  };
}

/** Prose strings translated; url and enum values kept, as an editor would. */
function translateStrings(value, enText, key = '') {
  if (typeof value === 'string')
    return value && !['link', 'url', 'contactUrl', 'style'].includes(key)
      ? enText(value)
      : value;
  if (Array.isArray(value))
    return value.map((v) => translateStrings(v, enText));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        translateStrings(v, enText, k),
      ]),
    );
  }
  return value;
}

/** What the import routes store from parts (import-json.js, import-deck.js). */
function storedFromParts(parts, lang) {
  return {
    title: parts.title,
    theme: parts.theme,
    lang,
    slides: parts.slides,
    i18n: {
      dominant: lang,
      active: lang,
      versions: {
        ...parts.translations,
        [lang]: { title: parts.title, slides: parts.slides },
      },
    },
  };
}

function importDeck(deck) {
  const resolved = deckImportLang(deck);
  assert.ok(resolved.ok, resolved.message);
  const parts = deckToPresentationParts(deck, {
    slideTypes: SLIDE_TYPES,
    lang: resolved.lang,
  });
  // The import routes refuse a deck the field validator rejects (B693).
  assertValidImportedDeck(parts, SLIDE_TYPES, { lang: resolved.lang });
  return storedFromParts(parts, resolved.lang);
}

/** The slide a jump lands on in `slides`, or `null`. */
function landsOn(value, slides) {
  const jump = slideJumpTarget(value);
  if (!jump) return null;
  if ('id' in jump) return slides.find((s) => s.id === jump.id) || null;
  return slides[jump.index - 1] || null;
}

/** Every `#…` jump and its path in a portable deck, translations included. */
function jumpsIn(value, path = '') {
  if (typeof value === 'string')
    return value.startsWith('#') ? [[path, value]] : [];
  if (Array.isArray(value))
    return value.flatMap((v, i) => jumpsIn(v, `${path}[${i}]`));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) =>
      jumpsIn(v, `${path}.${k}`),
    );
  return [];
}

/**
 * Re-exporting the imported deck writes the same jumps, and one more trip
 * changes nothing (the first import fills type defaults, so the fixpoint is
 * reached after one normalization).
 */
function assertStableJumps(portable, imported) {
  const again = presentationToDeck(imported);
  assert.deepEqual(jumpsIn(again.slides), jumpsIn(portable.slides));
  assert.deepEqual(presentationToDeck(importDeck(again)), again);
}

const cardsSlide = (id, items) => ({
  id,
  type: 'icon-card-grid-slide',
  content: { title: `Kaarten ${id}`, items },
});
const titleSlide = (id) => ({
  id,
  type: 'title-slide',
  content: { title: `Titel ${id}` },
});

test('the brief fragment: a card jump survives export → import → export', () => {
  const pres = {
    title: 'Test',
    theme: 'default',
    lang: 'nl',
    slides: [
      cardsSlide('a', [{ title: 'Next', link: '#slide:b' }]),
      titleSlide('b'),
    ],
  };

  const portable = presentationToDeck(pres);
  assert.equal(portable.slides[0].content.items[0].link, '#2');
  assert.equal(
    pres.slides[0].content.items[0].link,
    '#slide:b',
    'stored deck untouched',
  );

  const imported = importDeck(portable);
  const target = landsOn(
    imported.slides[0].content.items[0].link,
    imported.slides,
  );
  assert.equal(target?.content.title, 'Titel b');

  assertStableJumps(portable, imported);
});

test('every language version lands on the same target', () => {
  const pres = storedDeck([
    titleSlide('intro'),
    {
      id: 'menu',
      type: 'content-slide',
      content: {
        title: 'Menu',
        body: 'Kies een onderdeel.',
        actions: [
          { label: 'Naar het einde', url: '#slide:end' },
          { label: 'Website', url: 'https://example.com' },
        ],
      },
    },
    cardsSlide('cards', [{ title: 'Terug', link: '#slide:intro' }]),
    {
      id: 'end',
      type: 'end-slide',
      content: { title: 'Einde', contactUrl: '#slide:menu' },
    },
  ]);

  const portable = presentationToDeck(pres);
  assert.equal(portable.slides[1].content.actions[0].url, '#4');
  assert.equal(
    portable.slides[1].content.actions[1].url,
    'https://example.com',
  );
  assert.equal(portable.slides[2].content.items[0].link, '#1');
  assert.equal(portable.slides[3].content.contactUrl, '#2');
  assert.equal(
    portable.slides[1].translations['en-GB'].actions[0].label,
    'EN Naar het einde',
  );

  const imported = importDeck(portable);
  for (const lang of ['nl', 'en-GB']) {
    const slides = imported.i18n.versions[lang].slides;
    assert.equal(
      landsOn(slides[1].content.actions[0].url, slides)?.id,
      slides[3].id,
      `${lang}: the action reaches the end slide`,
    );
    assert.equal(
      landsOn(slides[2].content.items[0].link, slides)?.id,
      slides[0].id,
    );
    assert.equal(
      landsOn(slides[3].content.contactUrl, slides)?.id,
      slides[1].id,
    );
  }
  assert.equal(
    imported.i18n.versions['en-GB'].slides[1].content.actions[0].label,
    'EN Naar het einde',
  );

  assertStableJumps(portable, imported);
});

test('a filtered export counts positions on the slides it carries', () => {
  // `live` is filtered out of every language version, as an export filter does.
  const all = storedDeck([
    {
      id: 'menu',
      type: 'content-slide',
      content: {
        title: 'Menu',
        body: 'Kies.',
        actions: [
          { label: 'Naar de poll', url: '#slide:live' },
          { label: 'Naar het einde', url: '#slide:end' },
        ],
      },
    },
    titleSlide('live'),
    cardsSlide('cards', [
      { title: 'Poll', link: '#slide:live' },
      { title: 'Einde', link: '#slide:end' },
    ]),
    titleSlide('end'),
  ]);
  const drop = (slides) => slides.filter((s) => s.id !== 'live');
  const pres = {
    ...all,
    slides: drop(all.slides),
    i18n: {
      ...all.i18n,
      versions: Object.fromEntries(
        Object.entries(all.i18n.versions).map(([l, v]) => [
          l,
          { ...v, slides: drop(v.slides) },
        ]),
      ),
    },
  };

  const portable = presentationToDeck(pres);
  const [menu, cards] = portable.slides;
  // The required action url has no target left: the button goes, in every
  // language, so the remaining translation stays on the remaining button.
  assert.deepEqual(
    menu.content.actions.map((a) => a.url),
    ['#3'],
  );
  assert.deepEqual(
    menu.translations['en-GB'].actions.map((a) => a.label),
    ['EN Naar het einde'],
  );
  // An optional card link loses its dead target; the card stays.
  assert.deepEqual(
    cards.content.items.map((i) => i.link),
    ['', '#3'],
  );
  assert.deepEqual(
    cards.translations['en-GB'].items.map((i) => i.title),
    ['EN Poll', 'EN Einde'],
  );

  const imported = importDeck(portable);
  for (const lang of ['nl', 'en-GB']) {
    const slides = imported.i18n.versions[lang].slides;
    assert.equal(
      landsOn(slides[0].content.actions[0].url, slides)?.content.title,
      lang === 'nl' ? 'Titel end' : 'EN Titel end',
    );
    assert.equal(
      landsOn(slides[1].content.items[1].link, slides)?.id,
      slides[2].id,
    );
  }
  assertStableJumps(portable, imported);
});

test('a jump to a slide that no longer exists is not exported as a link', () => {
  const pres = {
    title: 'Dangling',
    theme: 'default',
    lang: 'nl',
    slides: [
      {
        id: 'end',
        type: 'end-slide',
        content: { title: 'Einde', contactUrl: '#slide:deleted' },
      },
      cardsSlide('cards', [{ title: 'Weg', link: '#slide:deleted' }]),
    ],
  };
  const portable = presentationToDeck(pres);
  assert.equal(portable.slides[0].content.contactUrl, '');
  assert.equal(portable.slides[1].content.items[0].link, '');
  importDeck(portable);
});

test('a #N jump and a web address travel as written', () => {
  const pres = {
    title: 'As written',
    theme: 'default',
    lang: 'nl',
    slides: [
      cardsSlide('cards', [
        { title: 'Twee', link: '#2' },
        { title: 'Web', link: 'https://example.com' },
      ]),
      titleSlide('b'),
    ],
  };
  const portable = presentationToDeck(pres);
  assert.deepEqual(
    portable.slides[0].content.items.map((i) => i.link),
    ['#2', 'https://example.com'],
  );
});
