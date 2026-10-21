/**
 * The derived background keys are machine values, not translatable text
 * (B818).
 *
 * The contrast verdict over `slideBgImage` (`DERIVED_SLIDE_CONTENT_KEYS`:
 * `slideBgAutoFor`, `slideBgTextAuto`, `slideBgNeedsScrim`) is written into
 * `slide.content` by the system, not by an author, and no field declares it.
 * The text spec used to leave it undeclared, so the value rule (D79) read an
 * image path and `light` as prose: the translate view offered them as rows and
 * the missing scan counted them. The spec now declares them, from the same
 * list strict validation reads (`nonFieldContentKeys`), on every type and on
 * an unknown one.
 *
 * Run with: node --test tests/derived-keys-machine-values.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types.js';
import { DERIVED_SLIDE_CONTENT_KEYS } from '../shared/slide-types/compose.js';
import {
  applyContentTranslation,
  contentTranslation,
  perLanguageKeys,
  textFieldSpecForType,
} from '../shared/slide-types/text-fields.js';
import {
  computeMissingTranslation,
  slideTextRows,
} from '../shared/i18n-progress.js';
import { translateViewModel } from '../client/views/editor/translate-view/model.js';

const DERIVED = new Set(DERIVED_SLIDE_CONTENT_KEYS);

const bgContent = (title) => ({
  title,
  slideBgImage: '/uploads/p1/hero.jpg',
  slideBgAutoFor: '/uploads/p1/hero.jpg',
  slideBgTextAuto: 'light',
  slideBgNeedsScrim: true,
});

const titleSlide = (title, type = 'title-slide') => ({
  id: 's1',
  type,
  notes: '',
  content: bgContent(title),
});

/** Source NL filled, target EN with the verdict but no translated title. */
function versions(type) {
  const nl = { title: 'Deck', slides: [titleSlide('Welkom', type)] };
  const en = { title: 'Deck', slides: [titleSlide('', type)] };
  // The target carries the verdict without a title: a machine copy, not a
  // translation.
  en.slides[0].content.slideBgAutoFor = '';
  en.slides[0].content.slideBgTextAuto = '';
  return { nl, en };
}

const derivedRows = (rows) => rows.filter((r) => DERIVED.has(r.key));

test('the title slide fixture is a registered type', () => {
  assert.ok(SLIDE_TYPES['title-slide'], 'title-slide is registered');
});

for (const [label, type] of [
  ['title-slide', 'title-slide'],
  ['an unknown type', 'retired-fork-slide'],
]) {
  test(`${label}: slideTextRows has no row for a derived key`, () => {
    const { nl, en } = versions(type);
    const rows = slideTextRows(nl, en, { slideTypes: SLIDE_TYPES });
    assert.deepEqual(derivedRows(rows), []);
    assert.ok(
      rows.some((r) => r.key === 'title' && r.kind === 'slide'),
      'the title is still a row',
    );
  });

  test(`${label}: computeMissingTranslation counts only the title`, () => {
    const { nl, en } = versions(type);
    const { missing } = computeMissingTranslation({
      source: nl,
      target: en,
      slideTypes: SLIDE_TYPES,
    });
    assert.deepEqual(
      missing.map((m) => m.key),
      ['title'],
    );
  });

  test(`${label}: perLanguageKeys does not name a derived key`, () => {
    const spec = textFieldSpecForType(type, SLIDE_TYPES);
    const keys = perLanguageKeys(spec, bgContent('Welkom'), bgContent('Hi'));
    for (const k of DERIVED) assert.ok(!keys.has(k), `${k} is per deck`);
    assert.ok(keys.has('title'));
  });

  test(`${label}: a translation leaves the verdict out and takes the base's`, () => {
    const spec = textFieldSpecForType(type, SLIDE_TYPES);
    const base = bgContent('Welkom');
    const tr = contentTranslation(spec, base, {
      ...bgContent('Welcome'),
      slideBgTextAuto: 'dark',
    });
    assert.equal(tr.title, 'Welcome');
    for (const k of DERIVED) assert.ok(!(k in tr), `${k} is not translated`);

    const applied = applyContentTranslation(spec, base, {
      title: 'Welcome',
      slideBgAutoFor: '/uploads/p1/other.jpg',
      slideBgTextAuto: 'dark',
    });
    assert.equal(applied.title, 'Welcome');
    assert.equal(applied.slideBgAutoFor, base.slideBgAutoFor);
    assert.equal(applied.slideBgTextAuto, base.slideBgTextAuto);
    assert.equal(applied.slideBgNeedsScrim, base.slideBgNeedsScrim);
  });
}

test('translate view: no row for a derived key on a title slide', () => {
  const { nl, en } = versions('title-slide');
  const pres = {
    id: 'p1',
    title: 'Deck',
    revision: 1,
    slides: nl.slides,
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: { nl, 'en-GB': en },
    },
  };
  const model = translateViewModel({
    pres,
    source: 'nl',
    target: 'en-GB',
    activeLang: 'nl',
    slideTypes: SLIDE_TYPES,
  });
  const rows = model.slides.flatMap((s) => s.rows);
  assert.deepEqual(derivedRows(rows), []);
  assert.ok(rows.some((r) => r.key === 'title'));
});
