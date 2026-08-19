/**
 * Per-language new-item skeletons (`itemDefaultsByLang`), the item-level twin
 * of `defaultsByLang`: a collection field may declare complete per-language
 * variants of its `itemDefaults`, and both add-item surfaces resolve through
 * `resolveItemDefaults(field, lang)` so a new item in an NL deck arrives in
 * Dutch.
 *
 * Run with: node --test tests/item-defaults.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveItemDefaults } from '../shared/slide-types/item-defaults.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

test('a declared language wins over the neutral skeleton', () => {
  const field = {
    itemDefaults: { title: 'New step', text: '' },
    itemDefaultsByLang: { nl: { title: 'Nieuwe stap', text: '' } },
  };
  assert.deepEqual(resolveItemDefaults(field, 'nl'), {
    title: 'Nieuwe stap',
    text: '',
  });
});

test('an undeclared language falls back to the neutral skeleton', () => {
  const field = {
    itemDefaults: { title: 'New step', text: '' },
    itemDefaultsByLang: { nl: { title: 'Nieuwe stap', text: '' } },
  };
  assert.deepEqual(resolveItemDefaults(field, 'en-GB'), {
    title: 'New step',
    text: '',
  });
  assert.deepEqual(resolveItemDefaults(field, null), {
    title: 'New step',
    text: '',
  });
});

test('malformed declarations degrade to the neutral skeleton, never break', () => {
  assert.deepEqual(
    resolveItemDefaults(
      { itemDefaults: { a: 1 }, itemDefaultsByLang: 'nope' },
      'nl',
    ),
    { a: 1 },
  );
  assert.deepEqual(
    resolveItemDefaults(
      { itemDefaults: { a: 1 }, itemDefaultsByLang: { nl: 'nope' } },
      'nl',
    ),
    { a: 1 },
  );
  assert.deepEqual(resolveItemDefaults({}, 'nl'), {});
  assert.deepEqual(resolveItemDefaults(null, 'nl'), {});
});

/**
 * Every collection field of every built-in type, one nesting level deep —
 * the same walk the editors make.
 */
function* collectionFields() {
  for (const [typeName, def] of Object.entries(SLIDE_TYPES)) {
    const fields = Array.isArray(def?.fields) ? def.fields : [];
    for (const field of fields) {
      if (field?.type !== 'items') continue;
      yield { where: `${typeName}.${field.key}`, field };
      for (const sub of Array.isArray(field.itemFields)
        ? field.itemFields
        : []) {
        if (sub?.type !== 'items') continue;
        yield { where: `${typeName}.${field.key}.${sub.key}`, field: sub };
      }
    }
  }
}

test('every itemDefaultsByLang variant is a complete skeleton (same keys as itemDefaults)', () => {
  for (const { where, field } of collectionFields()) {
    if (!field.itemDefaultsByLang) continue;
    const baseKeys = Object.keys(field.itemDefaults || {}).sort();
    for (const [lang, variant] of Object.entries(field.itemDefaultsByLang)) {
      assert.deepEqual(
        Object.keys(variant || {}).sort(),
        baseKeys,
        `${where} itemDefaultsByLang.${lang} must mirror itemDefaults' keys`,
      );
    }
  }
});

test('visible collection fields with placeholder copy declare an NL skeleton', () => {
  // The invariant behind the mechanism: if the neutral skeleton seeds real
  // (English) placeholder text into a field the user sees, an NL deck must
  // not receive it verbatim. Empty-string skeletons (gallery, list,
  // logo-wall) carry no language and are exempt.
  for (const { where, field } of collectionFields()) {
    if (field.hidden) continue; // legacy read-only mirrors never add items
    const hasCopy = Object.values(field.itemDefaults || {}).some(
      (v) => typeof v === 'string' && /[A-Za-z]{3,}/.test(v),
    );
    if (!hasCopy) continue;
    // Icon names (icon-card-grid's 'lightbulb') are data, not copy — but that
    // field also carries real copy (title/body), so the check stands.
    assert.ok(
      field.itemDefaultsByLang?.nl,
      `${where} seeds English placeholder copy but declares no NL skeleton`,
    );
  }
});
