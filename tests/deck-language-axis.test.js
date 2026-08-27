/**
 * B149/D61 — the deck-language axis is one open list with one definition site.
 *
 * The axis used to be a two-value enum (`['nl','en-GB']`) declared in five
 * places, with a sixth hardcode in `getLang()`, a seventh as a `Set` in the
 * deck-settings picker, and an accessor whose setter filtered its own input
 * back down to that pair. These tests pin the three gates the decision named:
 *
 *   1. the axis is defined in exactly one module;
 *   2. `?lang=` is read by exactly one client module, and it means the *deck*
 *      language — the UI locale moved to `?locale=`;
 *   3. the burndown allowlist of bare literals only shrinks.
 *
 * Run with: node --test tests/deck-language-axis.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DECK_LANG,
  DEFAULT_SUPPORTED_DECK_LANGS,
  TRANSLATION_LANGS,
  normalizeLang,
  otherLang,
} from '../shared/i18n-utils.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** Every hand-authored .js file under the given repo-relative roots. */
function sourceFiles(roots) {
  const out = [];
  const skip = new Set(['node_modules', 'vendor', 'dist', '.git']);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  for (const root of roots) walk(path.join(repoRoot, root));
  return out;
}

const APP_SOURCES = sourceFiles(['client', 'server', 'shared']);
const rel = (f) => path.relative(repoRoot, f);

test('the axis is an open list, not the legacy pair', () => {
  assert.ok(
    TRANSLATION_LANGS.length > 2,
    'the axis is the open list, not a two-value enum',
  );
  assert.equal(DEFAULT_DECK_LANG, TRANSLATION_LANGS[0]);
  // The shipped subset is narrower than the axis on purpose — an instance
  // switches the rest on — but it may only name axis languages.
  for (const code of DEFAULT_SUPPORTED_DECK_LANGS)
    assert.ok(TRANSLATION_LANGS.includes(code), `${code} is on the axis`);
});

test('normalizeLang is the one membership test, and it spans the axis', () => {
  for (const code of TRANSLATION_LANGS) assert.equal(normalizeLang(code), code);
  // The alias is normalized away, never stored.
  assert.equal(normalizeLang('en'), 'en-GB');
  for (const bogus of ['', null, undefined, 'zz', 'nl-NL', 'constructor', 42])
    assert.equal(normalizeLang(bogus), null, `${String(bogus)} is off-axis`);
});

test('otherLang answers only inside the bilingual pair', () => {
  assert.equal(otherLang('nl'), 'en-GB');
  assert.equal(otherLang('en-GB'), 'nl');
  // "The other of twelve" has no answer, so the caller must name its target
  // rather than be handed a guess (B182 widens the chrome that asks).
  for (const code of TRANSLATION_LANGS.filter(
    (c) => c !== 'nl' && c !== 'en-GB',
  ))
    assert.equal(otherLang(code), null, `otherLang(${code})`);
  assert.equal(otherLang(null), null);
});

test('the axis is declared in exactly one module', () => {
  // Any array literal pairing the two legacy codes is a re-declaration of the
  // axis — that is the shape the five old copies had.
  const pattern = /\[\s*'nl'\s*,\s*'en-GB'\s*\]|\[\s*'en-GB'\s*,\s*'nl'\s*\]/;
  const offenders = APP_SOURCES.filter((f) =>
    pattern.test(fs.readFileSync(f, 'utf8')),
  ).map(rel);
  assert.deepEqual(
    offenders,
    ['shared/i18n-utils.js'],
    'the deck-language list is spelled out in one module only — import ' +
      'TRANSLATION_LANGS or DEFAULT_SUPPORTED_DECK_LANGS instead',
  );
});

test('the client reads ?lang= in exactly one module', () => {
  const pattern = /searchParams\.get\(\s*'lang'\s*\)|get\(\s*'lang'\s*\)/;
  const offenders = APP_SOURCES.filter(
    (f) =>
      rel(f).startsWith('client/') && pattern.test(fs.readFileSync(f, 'utf8')),
  ).map(rel);
  assert.deepEqual(
    offenders,
    ['client/lib/format/i18n.js'],
    'read the deck language with readDeckLangParam()/deckLangQuery() from ' +
      'client/lib/format/i18n.js — six views used to re-validate the param ' +
      'inline, each with its own spelling of the check',
  );
});

test('?lang= is the deck language and ?locale= is the interface', () => {
  const uiI18n = fs.readFileSync(
    path.join(repoRoot, 'client/lib/ui-i18n.js'),
    'utf8',
  );
  assert.match(
    uiI18n,
    /const UI_LOCALE_PARAM_KEY = 'locale';/,
    'the UI-locale param key is `locale`: sharing `lang` with the deck axis ' +
      'is what made a shared editor link switch the recipient’s interface',
  );
  const deckI18n = fs.readFileSync(
    path.join(repoRoot, 'client/lib/format/i18n.js'),
    'utf8',
  );
  assert.match(deckI18n, /const DECK_LANG_PARAM_KEY = 'lang';/);
});

test('every deck language resolves to a locale directory that exists', () => {
  // D62: the ten "dead" follow.json files were only dead because the resolver
  // sat on the fixed pair. Every axis language must reach a real locale dir.
  const localeDir = path.join(repoRoot, 'client/i18n');
  for (const code of TRANSLATION_LANGS) {
    const locale = code === 'en-GB' ? 'en' : code;
    assert.ok(
      fs.existsSync(path.join(localeDir, locale, 'follow.json')),
      `client/i18n/${locale}/follow.json exists for deck language ${code}`,
    );
  }
});

test('the literal burndown allowlist only shrinks', () => {
  // Mirrors `deckLangLiteralAllowlist` in eslint.config.js: a file that has
  // been cleaned up must leave the list rather than sit there as a permanent
  // exemption. The eslint rule itself proves the *unlisted* files are clean.
  const config = fs.readFileSync(
    path.join(repoRoot, 'eslint.config.js'),
    'utf8',
  );
  const block = config.match(
    /const deckLangLiteralAllowlist = \[([\s\S]*?)\n\];/,
  );
  assert.ok(block, 'eslint.config.js declares deckLangLiteralAllowlist');
  const listed = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(listed.length > 0);

  const pattern = /'nl'|'en-GB'/;
  const stale = listed.filter((f) => {
    const full = path.join(repoRoot, f);
    return !fs.existsSync(full) || !pattern.test(fs.readFileSync(full, 'utf8'));
  });
  assert.deepEqual(
    stale,
    [],
    'these files carry no bare deck-language literal any more — drop them ' +
      'from deckLangLiteralAllowlist in eslint.config.js so the list keeps ' +
      'burning down',
  );

  assert.deepEqual(
    [...listed].sort(),
    [...new Set(listed)].sort(),
    'no duplicate entries',
  );
});
