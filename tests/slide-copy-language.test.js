/**
 * The language of a slide type's built-in copy.
 *
 * Three things are pinned here, because all three were broken at once and each
 * one hid the other two:
 *
 *   1. `getSlideCopy()` has ONE documented fallback, and it is English.
 *   2. `resolveDeckLang()` is the only thing that decides a deck's language;
 *      no slide type may re-derive one (the `ctx?.lang || 'nl'` pattern).
 *   3. Both copy tables carry the same keys, so switching language can never
 *      produce `undefined` in the markup.
 *
 * Run with: node --test tests/slide-copy-language.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SLIDE_COPY,
  SLIDE_COPY_LANGS,
  DEFAULT_SLIDE_COPY_LANG,
  getSlideCopy,
  slideCopyLang,
} from '../shared/slide-types/slide-copy.js';
import { resolveDeckLang } from '../shared/i18n-utils.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- 1. The fallback is one named decision ---------------------------------

test('the documented fallback language is English', () => {
  assert.equal(DEFAULT_SLIDE_COPY_LANG, 'en-GB');
});

test('a known language resolves to its own table', () => {
  assert.equal(slideCopyLang('nl'), 'nl');
  assert.equal(slideCopyLang('en-GB'), 'en-GB');
  // `en` is the accepted alias for the canonical tag.
  assert.equal(slideCopyLang('en'), 'en-GB');
});

test('an unknown locale falls back to the default, not to Dutch', () => {
  // A German deck must not be told it is Dutch. This is the case the old
  // `else return SLIDE_COPY.nl` got wrong.
  for (const unknown of ['de', 'fr', 'pt-BR', 'xx', 'nl-BE']) {
    assert.equal(
      slideCopyLang(unknown),
      DEFAULT_SLIDE_COPY_LANG,
      `${unknown} should fall back to ${DEFAULT_SLIDE_COPY_LANG}`,
    );
  }
});

test('an absent language falls back to the default', () => {
  for (const empty of [undefined, null, '', '   ', 0, false]) {
    assert.equal(slideCopyLang(empty), DEFAULT_SLIDE_COPY_LANG);
  }
  assert.equal(getSlideCopy(undefined), SLIDE_COPY[DEFAULT_SLIDE_COPY_LANG]);
});

test('a prototype key cannot masquerade as a language', () => {
  // `slideCopyLang` looks the tag up in an object literal; `toString` and
  // `constructor` are on its prototype and must not resolve to a copy table.
  for (const key of [
    'constructor',
    'toString',
    '__proto__',
    'hasOwnProperty',
  ]) {
    assert.equal(slideCopyLang(key), DEFAULT_SLIDE_COPY_LANG);
  }
});

// --- 2. One place decides a deck's language --------------------------------

test('resolveDeckLang reads the deck, in the documented order', () => {
  // The one that matters: a bilingual deck created in Dutch and currently being
  // read in English. `lang` never moves; `active` is what is on screen. Reading
  // `lang` first put Dutch poll copy under English slides — the defect itself,
  // caught in the browser after the plumbing was already in place.
  assert.equal(
    resolveDeckLang({ lang: 'nl', i18n: { dominant: 'nl', active: 'en-GB' } }),
    'en-GB',
    'the active language is the one on screen',
  );
  assert.equal(resolveDeckLang({ i18n: { active: 'nl' } }), 'nl');
  assert.equal(
    resolveDeckLang({ lang: 'nl', i18n: { dominant: 'en-GB' } }),
    'en-GB',
    'dominant answers when no active choice was made',
  );
  // A deck with no i18n block at all is the legacy single-language case.
  assert.equal(resolveDeckLang({ lang: 'en-GB' }), 'en-GB');
});

test('resolveDeckLang answers null rather than guessing', () => {
  // Null is the point: a caller cannot mistake "the deck says nothing" for a
  // real language, and getSlideCopy applies the documented default instead.
  for (const pres of [undefined, null, {}, { lang: '' }, { lang: 'de' }]) {
    assert.equal(resolveDeckLang(pres), null);
  }
});

test('no slide type carries its own language fallback', () => {
  // The `ctx?.lang || 'nl'` pattern in six type files is what made an English
  // deck render Dutch poll copy even after the deck language was plumbed
  // through. A type reads ctx.lang and nothing else.
  const typesDir = join(repoRoot, 'shared/slide-types/types');
  const offenders = [];
  for (const file of readdirSync(typesDir)) {
    if (!file.endsWith('.js')) continue;
    const src = readFileSync(join(typesDir, file), 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (/ctx\??\.?\s*\?\.\s*lang\s*\|\|/.test(line)) {
        offenders.push(`${file}:${i + 1}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `slide types must not re-derive a language: ${offenders.join(', ')}`,
  );
});

test('every renderSlideHtml call site passes a language', () => {
  // The other half of the same defect: a type that reads only ctx.lang is
  // correct precisely as long as every caller SETS it. Removing the per-type
  // `|| 'nl'` turns a missed call site from "wrong language" into "always the
  // default", which is quieter and therefore worse — the MCP preview tools
  // were exactly that, rendering en-GB copy under a Dutch deck.
  //
  // Source scan rather than a runtime probe: the call sites are spread over
  // client, server and the export paths, and half of them need a browser or a
  // live deck to reach.
  const roots = ['client', 'server', 'shared'];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(p);
      } else if (entry.name.endsWith('.js')) {
        const src = readFileSync(p, 'utf8');
        // Match the call and its options object, across lines.
        for (const m of src.matchAll(
          /renderSlideHtml\(\s*[^,)]+,\s*\{([^}]*)\}/g,
        )) {
          if (!/\blang\b/.test(m[1])) {
            const line = src.slice(0, m.index).split('\n').length;
            offenders.push(`${p.slice(repoRoot.length + 1)}:${line}`);
          }
        }
      }
    }
  };
  for (const r of roots) walk(join(repoRoot, r));
  assert.deepEqual(
    offenders,
    [],
    `every renderSlideHtml caller must pass ctx.lang (from resolveDeckLang):\n${offenders.join('\n')}`,
  );
});

// --- 3. The tables agree ---------------------------------------------------

test('every copy table carries exactly the same keys', () => {
  const [first, ...rest] = SLIDE_COPY_LANGS;
  const expected = Object.keys(SLIDE_COPY[first]).sort();
  for (const lang of rest) {
    const actual = Object.keys(SLIDE_COPY[lang]).sort();
    assert.deepEqual(
      actual,
      expected,
      `${lang} and ${first} must carry the same keys`,
    );
  }
});

test('no copy value is empty', () => {
  for (const lang of SLIDE_COPY_LANGS) {
    for (const [key, value] of Object.entries(SLIDE_COPY[lang])) {
      assert.equal(typeof value, 'string', `${lang}.${key} must be a string`);
      assert.ok(value.trim(), `${lang}.${key} must not be empty`);
    }
  }
});

// --- The end-to-end claim --------------------------------------------------

const COPY_TYPES = [
  'poll-slide',
  'likert-slide',
  'likert-slider-slide',
  'feedback-slide',
  'timeline-slide',
  'chart-slide',
];

test('an en-GB deck shows no Dutch copy on any interactive type', () => {
  for (const type of COPY_TYPES) {
    const def = SLIDE_TYPES[type];
    assert.ok(def, `${type} should exist`);
    const html = def.renderHtml(
      def.defaults || {},
      { type },
      { lang: 'en-GB' },
    );
    for (const [key, dutch] of Object.entries(SLIDE_COPY.nl)) {
      const english = SLIDE_COPY['en-GB'][key];
      // Only Dutch strings that actually differ from their English twin can
      // betray the wrong table (e.g. 'Logo' is the same in both).
      if (dutch === english) continue;
      assert.ok(
        !html.includes(dutch),
        `${type} rendered Dutch copy "${dutch}" (${key}) for an en-GB deck`,
      );
    }
  }
});

test('a deck with no language gets the default, not Dutch', () => {
  for (const type of COPY_TYPES) {
    const def = SLIDE_TYPES[type];
    const html = def.renderHtml(def.defaults || {}, { type }, {});
    const fallback = SLIDE_COPY[DEFAULT_SLIDE_COPY_LANG];
    for (const [key, dutch] of Object.entries(SLIDE_COPY.nl)) {
      if (dutch === fallback[key]) continue;
      assert.ok(
        !html.includes(dutch),
        `${type} fell back to Dutch copy "${dutch}" (${key})`,
      );
    }
  }
});
