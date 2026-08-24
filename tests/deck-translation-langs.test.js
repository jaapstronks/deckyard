/**
 * B135 — one list of deck translation targets, everything else derives from it.
 *
 * `shared/i18n-utils.js` owns `TRANSLATION_LANGS` and `TRANSLATION_LANG_LABELS`.
 * Four places used to spell that list out by hand (the shared normalizer set, the
 * storage facade, the public API's label map, the LLM prompt's label map); these
 * tests pin that they now all read the one source, and that the OpenAPI enum and
 * the alias table stay in step with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import {
  TRANSLATION_LANGS,
  TRANSLATION_LANG_LABELS,
  normalizeTranslationLang,
} from '../shared/i18n-utils.js';
import * as storageI18n from '../server/storage/presentations/i18n.js';
import { labelForLang } from '../server/utils/openai/lang.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('the shared list is the one the storage facade hands out', () => {
  assert.equal(storageI18n.TRANSLATION_LANGS, TRANSLATION_LANGS);
  assert.equal(storageI18n.TRANSLATION_LANG_LABELS, TRANSLATION_LANG_LABELS);
});

test('the list is canonical: en-GB, never the interface spelling en', () => {
  assert.ok(TRANSLATION_LANGS.includes('en-GB'));
  assert.ok(!TRANSLATION_LANGS.includes('en'));
  assert.ok(Object.isFrozen(TRANSLATION_LANGS));
});

test('every target normalizes to itself and carries exactly one label', () => {
  assert.deepEqual(
    Object.keys(TRANSLATION_LANG_LABELS).sort(),
    [...TRANSLATION_LANGS].sort(),
  );
  for (const code of TRANSLATION_LANGS) {
    assert.equal(normalizeTranslationLang(code), code);
    assert.ok(TRANSLATION_LANG_LABELS[code], `${code} has an English label`);
    assert.equal(
      labelForLang(code),
      TRANSLATION_LANG_LABELS[code].toUpperCase(),
      `${code}'s prompt label derives from the shared label`,
    );
  }
});

test('en is the only alias, and it resolves to the canonical spelling', () => {
  assert.equal(normalizeTranslationLang('en'), 'en-GB');
  assert.equal(labelForLang('en'), 'BRITISH ENGLISH');
  for (const bogus of ['EN', 'en-US', 'nl-NL', 'xx', '', null, undefined, 42]) {
    assert.equal(
      normalizeTranslationLang(bogus),
      null,
      `${String(bogus)} is not a translation target`,
    );
  }
  assert.equal(labelForLang('xx'), 'UNKNOWN');
});

test('docs/openapi.yaml documents the same targets', () => {
  const spec = YAML.parse(
    fs.readFileSync(path.join(repoRoot, 'docs/openapi.yaml'), 'utf8'),
  );
  const enums = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.targetLang?.enum) enums.push(node.targetLang.enum);
    Object.values(node).forEach(walk);
  };
  walk(spec);
  assert.ok(enums.length, 'the spec documents a targetLang enum');
  for (const values of enums) {
    assert.deepEqual(
      values.map(String),
      [...TRANSLATION_LANGS],
      'targetLang enum matches TRANSLATION_LANGS, in order',
    );
  }
});
