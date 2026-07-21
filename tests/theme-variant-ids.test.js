/**
 * Naming guards for theme background variants.
 *
 * `normalizeSlideBackgrounds` drops an entry whose id is unsafe, reserved or a
 * duplicate. That is right for a renderer and wrong for a form: you would name
 * a variant, save, and watch it disappear with no explanation. The editor has
 * to reject exactly what the normalizer would drop, before the save — these
 * tests pin the two against each other.
 *
 * Run with: node --test tests/theme-variant-ids.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyVariantId,
  variantIdProblem,
} from '../client/views/settings/theme-editor/variants-section.js';
import {
  normalizeSlideBackgrounds,
  RESERVED_SLIDE_BG_IDS,
} from '../shared/theme-slide-backgrounds.js';

test('a human name becomes a css-class-safe id', () => {
  assert.equal(slugifyVariantId('Calm'), 'calm');
  assert.equal(slugifyVariantId('Soft Sage'), 'soft-sage');
  assert.equal(slugifyVariantId('  Deep   Blue  '), 'deep-blue');
  assert.equal(slugifyVariantId('Café Crème'), 'caf-cr-me');
  assert.equal(slugifyVariantId('2024 brand'), '2024-brand');
});

test('slugify never produces an id the normalizer would reject', () => {
  const names = ['Calm', 'Soft Sage', '  spaced  ', 'Ünïcødé', 'a'.repeat(80), '2024'];
  for (const name of names) {
    const id = slugifyVariantId(name);
    if (!id) continue;
    const kept = normalizeSlideBackgrounds([{ id, label: name, value: '#e8f0ee' }]);
    assert.equal(kept.length, 1, `normalizer dropped "${id}" (from "${name}")`);
  }
});

test('a name with nothing usable in it is rejected, not silently dropped', () => {
  for (const name of ['', '   ', '///', '???']) {
    const id = slugifyVariantId(name);
    assert.ok(variantIdProblem(id, []), `"${name}" should be rejected`);
    // And the normalizer would indeed have dropped it.
    assert.deepEqual(normalizeSlideBackgrounds([{ id, label: name, value: '#fff' }]), []);
  }
});

test('every reserved id is rejected by the form', () => {
  for (const id of RESERVED_SLIDE_BG_IDS) {
    assert.ok(
      variantIdProblem(id, []),
      `${id} is reserved but the form would have accepted it`
    );
    // The normalizer drops it, which is what the form is protecting you from.
    assert.deepEqual(normalizeSlideBackgrounds([{ id, label: id, value: '#fff' }]), []);
  }
});

test('a duplicate is rejected before it can shadow the existing one', () => {
  assert.ok(variantIdProblem('calm', ['calm']));
  assert.equal(variantIdProblem('calm', ['other']), '');

  // The normalizer keeps only the first of a duplicate pair — so without the
  // form check, adding "Calm" twice would silently discard the second.
  const kept = normalizeSlideBackgrounds([
    { id: 'calm', label: 'First', value: '#111111' },
    { id: 'calm', label: 'Second', value: '#222222' },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].label, 'First');
});

test('an acceptable name reports no problem', () => {
  assert.equal(variantIdProblem('calm', []), '');
  assert.equal(variantIdProblem('soft-sage', ['calm']), '');
});
