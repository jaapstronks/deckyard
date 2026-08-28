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
  for (const pres of [undefined, null, {}, { lang: '' }, { lang: 'klingon' }]) {
    assert.equal(resolveDeckLang(pres), null);
  }
  // …but a language *on the axis* is an answer, not a guess. Before D61 this
  // list held `{ lang: 'de' }`, because the axis was `nl`/`en-GB` and German
  // was as unreadable as Klingon.
  assert.equal(resolveDeckLang({ lang: 'de' }), 'de');
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

// The three functions a render surface can enter through, and the module each
// one must be imported from for a call to be *that* function. The import check
// is what keeps the scan honest about shadowing: the editor hands its render
// modules a `renderSlideElement` of its own — a wrapper that injects
// `resolveDeckLang(pres)` — and those modules would otherwise read as call
// sites that forgot the language while being the ones that cannot.
const RENDER_ENTRYPOINTS = [
  { name: 'renderSlideHtml', from: /slide-types(\/presentation)?\.js'/ },
  { name: 'mountSlideInto', from: /slide-runtime\/slide-render\.js'/ },
  { name: 'renderSlideElement', from: /slide-runtime\/slide-render\.js'/ },
];

/** Blank out comments, keeping every byte's line and column. */
function stripComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:\\])\/\/[^\n]*/g,
      (m, lead) => lead + blank(m.slice(lead.length)),
    );
}

/**
 * The arguments of the call that starts at `from` (just past its `(`), split on
 * top-level commas. A trailing comma yields no extra argument.
 */
function callArgs(src, from) {
  const args = [];
  let depth = 1;
  let nested = 0;
  let start = from;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (!depth) {
        args.push(src.slice(start, i));
        break;
      }
    } else if (c === '[' || c === '{') nested++;
    else if (c === ']' || c === '}') nested--;
    else if (c === ',' && depth === 1 && nested === 0) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return args.map((a) => a.trim()).filter(Boolean);
}

/** The `{ … }` an identifier was declared with in the same file, or null. */
function declaredObject(src, name) {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`).exec(src);
  if (!decl) return null;
  let i = src.indexOf('{', decl.index);
  let depth = 0;
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && !--depth) break;
  }
  // Properties assigned after the literal count too (`opts.lang = …`).
  const assigned = [
    ...src.matchAll(new RegExp(`${name}\\.(\\w+)\\s*=[^=]`, 'g')),
  ].map((m) => `${m[1]},`);
  return src.slice(open, i + 1) + '\n' + assigned.join('\n');
}

const jsFilesUnder = (dir, acc = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') jsFilesUnder(p, acc);
    } else if (entry.name.endsWith('.js')) acc.push(p);
  }
  return acc;
};

/** Every call site of `entry` under client/, server/ and shared/. */
function callSitesOf(entry) {
  const sites = [];
  for (const root of ['client', 'server', 'shared']) {
    for (const file of jsFilesUnder(join(repoRoot, root))) {
      const raw = readFileSync(file, 'utf8');
      if (!entry.from.test(raw)) continue;
      const src = stripComments(raw);
      const call = new RegExp(`(?<![\\w.$])${entry.name}\\(`, 'g');
      for (const m of src.matchAll(call)) {
        // The declaration itself is not a call.
        if (/\bfunction\s+$/.test(src.slice(0, m.index))) continue;
        const args = callArgs(src, m.index + m[0].length);
        const where = `${file.slice(repoRoot.length + 1)}:${
          src.slice(0, m.index).split('\n').length
        }`;
        sites.push({ where, options: args[args.length - 1] || '', src });
      }
    }
  }
  return sites;
}

test('every render entrypoint is handed a language, explicitly', () => {
  // The other half of the same defect: a type that reads only ctx.lang is
  // correct precisely as long as every caller SETS it. Removing the per-type
  // `|| 'nl'` turns a missed call site from "wrong language" into "always the
  // default", which is quieter and therefore worse — the MCP preview tools
  // were exactly that, rendering en-GB copy under a Dutch deck, and the
  // audience view, the notes companion and the viewer panel were the same
  // thing one layer up, through `mountSlideInto`.
  //
  // The rule is *presence*, not truthiness, and there is deliberately no
  // allowlist for the sample surfaces. A theme preview or a slide-type
  // specimen has no deck, and its honest answer is `lang: NO_DECK_LANG` —
  // written out, at the call site. Exempting those files in the test would
  // move the decision here, where the next surface added to one of them
  // inherits an exemption nobody chose.
  //
  // Source scan rather than a runtime probe: the call sites are spread over
  // client, server and the export paths, and half of them need a browser or a
  // live deck to reach.
  const offenders = [];
  for (const entry of RENDER_ENTRYPOINTS) {
    for (const site of callSitesOf(entry)) {
      let options = site.options;
      if (/^[A-Za-z_$][\w$]*$/.test(options)) {
        const declared = declaredObject(site.src, options);
        if (declared === null) {
          offenders.push(
            `${site.where} (${entry.name}: options object \`${options}\` is not declared in this file — inline it or set lang where it is built)`,
          );
          continue;
        }
        options = declared;
      }
      if (!/(^|[\s,{])lang\s*[:,}\n]/.test(options)) {
        offenders.push(`${site.where} (${entry.name})`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `every render entrypoint must be passed a lang — the deck's, via resolveDeckLang(pres), or NO_DECK_LANG when there is no deck:\n${offenders.join('\n')}`,
  );
});

test('the scan actually reaches the surfaces it claims to', () => {
  // A source scan that silently matches nothing is a green test that pins
  // nothing — the import filter above is one typo away from that. Each
  // entrypoint must be found, and these four named surfaces (the ones this
  // guard was written for) must be among the sites it sees.
  const seen = new Map();
  for (const entry of RENDER_ENTRYPOINTS) {
    const sites = callSitesOf(entry);
    assert.ok(sites.length > 0, `${entry.name}: the scan found no call sites`);
    for (const s of sites) seen.set(s.where.split(':')[0], entry.name);
  }
  for (const file of [
    'client/views/follow/render-slide.js',
    'client/views/notes/index.js',
    'client/views/viewer/viewer-preview.js',
    'client/views/presenter/console.js',
    'server/mcp/preview.js',
  ]) {
    assert.ok(seen.has(file), `${file} should be scanned, but was not seen`);
  }
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
