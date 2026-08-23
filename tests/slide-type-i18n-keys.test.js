/**
 * The i18n key walker's coverage contract (B128).
 *
 * `slideTypeUiKeys()` decides which `slideType.*` locale keys are *live*;
 * `i18n:sync` deletes every translation whose key it does not return. A blind
 * spot in the walk therefore does not fail loudly — it proposes deleting copy
 * the editor still asks for. That happened twice: #938 needed a review fix
 * restoring twelve text-blocks keys, and #939 needed a hand-audited prune.
 *
 * Both misses were the same shape: the walk stopped at the outer `fields[]`
 * level. Item fields declare options like any other field, and an `items` field
 * can sit inside an item (text-blocks' `rows[].blocks[]`). These tests pin the
 * recursion at both the synthetic seam and against the live registry, so a new
 * declaration shape cannot silently fall out of the valid set again.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { slideTypeUiKeys } from '../scripts/lib/slide-type-i18n-keys.js';

// ---------------------------------------------------------------------------
// Synthetic seam — a registry of one type carrying every shape at once.
// ---------------------------------------------------------------------------

const NESTED_REGISTRY = {
  'acme-nest-slide': {
    label: 'Nest',
    fields: [
      {
        key: 'rows',
        type: 'items',
        label: 'Rows',
        itemFields: [
          {
            key: 'tone',
            type: 'select',
            label: 'Tone',
            placeholder: 'Pick a tone',
            helpText: 'Colours the row',
            options: [
              {
                value: 'warm',
                label: 'Warm',
                labelKey:
                  'slideType.acme-nest-slide.field.rows.item.tone.option.warm.label',
                titleKey:
                  'slideType.acme-nest-slide.field.rows.item.tone.option.warm.title',
                ariaLabelKey:
                  'slideType.acme-nest-slide.field.rows.item.tone.option.warm.ariaLabel',
              },
            ],
          },
          {
            key: 'blocks',
            type: 'items',
            label: 'Blocks',
            itemFields: [{ key: 'title', type: 'string', label: 'Title' }],
          },
        ],
      },
    ],
  },
};

test('item fields contribute their label, placeholder and help keys', () => {
  const keys = slideTypeUiKeys(NESTED_REGISTRY);
  const base = 'slideType.acme-nest-slide.field.rows.item.tone';
  assert.ok(keys.has(`${base}.label`), 'item field label');
  assert.ok(keys.has(`${base}.placeholder`), 'item field placeholder');
  assert.ok(keys.has(`${base}.help`), 'item field help');
});

test('options on an item field contribute their explicit keys', () => {
  const keys = slideTypeUiKeys(NESTED_REGISTRY);
  const base = 'slideType.acme-nest-slide.field.rows.item.tone.option.warm';
  assert.ok(keys.has(`${base}.label`), 'item option label');
  assert.ok(keys.has(`${base}.title`), 'item option title');
  assert.ok(keys.has(`${base}.ariaLabel`), 'item option ariaLabel');
});

test('itemFields nested inside an item keep contributing keys', () => {
  const keys = slideTypeUiKeys(NESTED_REGISTRY);
  assert.ok(
    keys.has(
      'slideType.acme-nest-slide.field.rows.item.blocks.item.title.label',
    ),
    'a second level of itemFields is walked',
  );
});

// ---------------------------------------------------------------------------
// Live registry — the audit that would have caught #938/#939 up front. Every
// declaration the registry actually carries must appear in the valid set, at
// any nesting depth.
// ---------------------------------------------------------------------------

/**
 * Every key a level of field declarations owes, derived independently of the
 * module under test so the two derivations have to agree.
 * @param {string} base - key prefix, e.g. `slideType.<type>.field`
 * @param {Array<Object>} fields - `fields[]` or `itemFields[]`
 * @param {(key: string) => void} emit
 */
function expectedFieldKeys(base, fields, emit) {
  for (const f of Array.isArray(fields) ? fields : []) {
    const fk = String(f?.key || '').trim();
    if (!fk) continue;
    const fbase = `${base}.${fk}`;
    emit(f.labelKey || `${fbase}.label`);
    if (typeof f?.placeholder === 'string')
      emit(f.placeholderKey || `${fbase}.placeholder`);
    if (typeof f?.helpText === 'string') emit(f.helpTextKey || `${fbase}.help`);
    for (const opt of Array.isArray(f?.options) ? f.options : []) {
      if (!opt || typeof opt !== 'object') continue;
      for (const k of [opt.labelKey, opt.titleKey, opt.ariaLabelKey])
        if (k) emit(k);
    }
    if (Array.isArray(f?.itemFields))
      expectedFieldKeys(`${fbase}.item`, f.itemFields, emit);
  }
}

test('the live registry declares no key the walker misses', () => {
  const keys = slideTypeUiKeys(SLIDE_TYPES);
  const missing = [];
  for (const [type, def] of Object.entries(SLIDE_TYPES)) {
    const emit = (k) => {
      if (k && !keys.has(k)) missing.push(k);
    };
    emit(def?.labelKey || `slideType.${type}.label`);
    expectedFieldKeys(`slideType.${type}.field`, def?.fields, emit);
  }
  assert.deepEqual(
    missing,
    [],
    'keys the registry declares but the walker would prune',
  );
});

test('a nested items field and an item-level enum exist to exercise the walk', () => {
  // A tripwire, not a rule: if the registry ever loses both shapes, the audit
  // above passes vacuously and the synthetic seam is all that is left.
  let nested = 0;
  let itemOptions = 0;
  const scan = (fields, depth) => {
    for (const f of Array.isArray(fields) ? fields : []) {
      if (depth > 0 && Array.isArray(f?.options) && f.options.length)
        itemOptions += 1;
      if (Array.isArray(f?.itemFields)) {
        if (depth > 0) nested += 1;
        scan(f.itemFields, depth + 1);
      }
    }
  };
  for (const def of Object.values(SLIDE_TYPES)) scan(def?.fields, 0);
  assert.ok(nested > 0, 'a core type nests itemFields inside an item');
  assert.ok(itemOptions > 0, 'a core type declares options on an item field');
});
