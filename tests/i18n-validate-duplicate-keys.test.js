/**
 * i18n duplicate-key gate — within a file, and across the files of one locale.
 *
 * `scripts/i18n-validate.js` used to validate the *parsed* object, so a repeated
 * key was invisible: `JSON.parse` keeps the last occurrence and silently drops
 * the rest. A fork-merge once pasted 22 keys twice into editor.json; the files
 * were quietly corrupt (last-wins), yet the validator reported PASSED.
 *
 * `findDuplicateKeys` scans the raw lines instead — the one place a duplicate
 * still exists — and reports each with its file line and the line it first
 * appeared on. This pins that behaviour and guards the live locale files so a
 * future merge can't reintroduce the same silent corruption.
 *
 * The same defect has a second shape one level up: `ui-i18n.js` merges every
 * module file into one dictionary, so a key filed in *two* module files of one
 * locale is last-wins in exactly the same way — one of the two copies is dead,
 * and editing it changes nothing. `common.close` sat in both `common.json` and
 * `editor.json` in all twelve locales until B137; the second block here keeps
 * it from growing back, and pins that every key lives in the module `en/`
 * files it in.
 *
 * Run with: node --test tests/i18n-validate-duplicate-keys.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findDuplicateKeys } from '../scripts/i18n-validate.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const i18nDir = path.join(repoRoot, 'client', 'i18n');

describe('findDuplicateKeys', () => {
  it('flags a repeated key with both line numbers', () => {
    const content = ['{', '  "a": "1",', '  "b": "2",', '  "a": "3"', '}'].join(
      '\n',
    );
    const dups = findDuplicateKeys(content);
    assert.deepStrictEqual(dups, [{ key: 'a', line: 4, firstLine: 2 }]);
  });

  it('reports every repeat when a key appears three times', () => {
    const content = ['{', '  "x": "1",', '  "x": "2",', '  "x": "3"', '}'].join(
      '\n',
    );
    const dups = findDuplicateKeys(content);
    assert.deepStrictEqual(
      dups.map((d) => d.line),
      [3, 4],
    );
    assert.ok(dups.every((d) => d.firstLine === 2));
  });

  it('returns nothing for a clean flat map', () => {
    const content = ['{', '  "a": "1",', '  "b": "2"', '}'].join('\n');
    assert.deepStrictEqual(findDuplicateKeys(content), []);
  });

  it('does not mistake a duplicated value for a duplicated key', () => {
    const content = ['{', '  "a": "same",', '  "b": "same"', '}'].join('\n');
    assert.deepStrictEqual(findDuplicateKeys(content), []);
  });
});

describe('live locale files', () => {
  const files = fs
    .readdirSync(i18nDir)
    .filter((entry) => fs.statSync(path.join(i18nDir, entry)).isDirectory())
    .flatMap((locale) =>
      fs
        .readdirSync(path.join(i18nDir, locale))
        .filter((name) => name.endsWith('.json'))
        .map((name) => path.join(locale, name)),
    );

  for (const rel of files) {
    it(`${rel} has no duplicate keys`, () => {
      const content = fs.readFileSync(path.join(i18nDir, rel), 'utf8');
      const dups = findDuplicateKeys(content);
      assert.deepStrictEqual(
        dups.map(
          (d) => `line ${d.line}: "${d.key}" (first at line ${d.firstLine})`,
        ),
        [],
        `${dups.length} duplicate key(s) in client/i18n/${rel} — JSON.parse keeps only ` +
          'the last, so the extras are silently dropped. Remove them.',
      );
    });
  }
});

describe('one key, one module file', () => {
  const locales = fs
    .readdirSync(i18nDir)
    .filter((entry) => fs.statSync(path.join(i18nDir, entry)).isDirectory());

  /** @param {string} locale @returns {Map<string, string>} key -> module basename */
  const homes = (locale) => {
    const map = new Map();
    const dupes = [];
    for (const name of fs.readdirSync(path.join(i18nDir, locale)).sort()) {
      if (!name.endsWith('.json')) continue;
      const mod = name.slice(0, -'.json'.length);
      const data = JSON.parse(
        fs.readFileSync(path.join(i18nDir, locale, name), 'utf8'),
      );
      for (const key of Object.keys(data)) {
        if (map.has(key))
          dupes.push(`${key} (${map.get(key)}.json + ${mod}.json)`);
        else map.set(key, mod);
      }
    }
    return { map, dupes };
  };

  for (const locale of locales) {
    it(`${locale}/ files each key in exactly one module`, () => {
      assert.deepStrictEqual(
        homes(locale).dupes,
        [],
        `client/i18n/${locale}/ files a key in two modules; ui-i18n.js merges ` +
          'them, so one copy is dead weight. Keep the one en/ uses.',
      );
    });
  }

  const reference = homes('en').map;

  for (const locale of locales) {
    if (locale === 'en') continue;
    it(`${locale}/ files every shared key where en/ does`, () => {
      const misfiled = [...homes(locale).map]
        .filter(
          ([key, mod]) => reference.has(key) && reference.get(key) !== mod,
        )
        .map(
          ([key, mod]) => `${key}: ${mod}.json → ${reference.get(key)}.json`,
        );
      assert.deepStrictEqual(
        misfiled,
        [],
        `client/i18n/${locale}/ keeps keys in a different module than en/. ` +
          'i18n-fill.js routes to the en/ file (B137); move these to match.',
      );
    });
  }
});
